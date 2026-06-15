-- =====================================================================
-- Veriqo — Multi-user (one shared account per business) migration
-- Tenant boundary = VENUE. All members of a venue share one data pool.
-- Staff can log HACCP by default; jobs can be scoped per staff member.
-- Idempotent. SAFE TO RUN ON A SUPABASE BRANCH FIRST.
-- =====================================================================
-- WHAT THIS FIXES
--   Today ~20 tables (jobs, clients, dishes, menus, invoices, ...) use
--   RLS `auth.uid() = user_id`. An invited teammate authenticates as a
--   different user id, matches none of the owner's rows, and sees an
--   empty app. This migration moves every shared table onto the venue
--   model, so all members of a venue share one data pool, with
--   owner/admin vs staff access, and per-job scoping for HACCP.
-- ---------------------------------------------------------------------
-- PRE-FLIGHT (do this first, it is the #1 silent failure):
--   Dashboard > Authentication > Hooks > Customize Access Token must be
--   ENABLED and pointed at public.custom_access_token_hook. If it is off,
--   the venue_id / user_role JWT claims are never minted and NOTHING below
--   shares data. The function already exists and is correct.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Helper functions. SECURITY DEFINER => they bypass RLS internally,
--    so no recursion when used inside policies that also touch profiles.
-- ---------------------------------------------------------------------
create or replace function public.auth_venue_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(auth.jwt() ->> 'venue_id', '')::uuid,
    (select venue_id from public.profiles where id = auth.uid())
  );
$$;

create or replace function public.auth_user_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(auth.jwt() ->> 'user_role', ''),
    (select role from public.profiles where id = auth.uid()),
    'staff'
  );
$$;

create or replace function public.is_venue_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_user_role() in ('owner', 'admin');
$$;

-- ---------------------------------------------------------------------
-- 2. Add venue_id to every shared table, backfill, index, and set a
--    DEFAULT so app inserts no longer need to send venue_id at all.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  shared_tables text[] := array[
    'jobs','clients','dishes','menus','menu_dishes','job_menus',
    'haccp_records','mise_records','prep_lists','attachments',
    'invoice_items','invoices','payments','expenses','mileage',
    'quotes','costings','tax_categories','business_settings','staff'
  ];
begin
  foreach t in array shared_tables loop
    execute format('alter table public.%I add column if not exists venue_id uuid references public.venues(id)', t);

    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=t and column_name='kitchen_id') then
      execute format($f$update public.%I x set venue_id = k.venue_id
                        from public.kitchens k
                        where x.kitchen_id = k.id and x.kitchen_id is not null and x.venue_id is null$f$, t);
    end if;

    execute format($f$update public.%I x set venue_id = p.venue_id
                      from public.profiles p
                      where x.user_id = p.id and x.venue_id is null$f$, t);

    execute format('create index if not exists %I on public.%I (venue_id)', t||'_venue_idx', t);
    execute format('alter table public.%I alter column venue_id set default public.auth_venue_id()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Per-job HACCP + per-staff job scoping.
--    - haccp_records.job_id: log against a specific gig (nullable = general log)
--    - job_assignments: owner/admin assign a member to specific jobs
--    - profiles.all_jobs_access: owner toggle giving a member every job
-- ---------------------------------------------------------------------
alter table public.haccp_records add column if not exists job_id text references public.jobs(id);
create index if not exists haccp_records_job_idx on public.haccp_records (job_id);
alter table public.haccp_records alter column created_by set default auth.uid();

alter table public.profiles add column if not exists all_jobs_access boolean not null default false;

create table if not exists public.job_assignments (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade default public.auth_venue_id(),
  job_id      text not null references public.jobs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (job_id, user_id)
);
create index if not exists job_assignments_user_idx on public.job_assignments (user_id);
create index if not exists job_assignments_job_idx  on public.job_assignments (job_id);
alter table public.job_assignments enable row level security;

-- can the current user touch HACCP for this job?
-- true for: general (null) logs, managers, all-jobs members, and assigned members.
create or replace function public.can_access_job(p_job_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_job_id is null
    or public.is_venue_manager()
    or coalesce((select all_jobs_access from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.job_assignments ja
               where ja.job_id = p_job_id and ja.user_id = auth.uid());
$$;

grant execute on function
  public.auth_venue_id(), public.auth_user_role(),
  public.is_venue_manager(), public.can_access_job(text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 4. Replace legacy per-user policies with venue policies.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  -- everyone in the venue can read AND write
  full_access text[] := array[
    'clients','dishes','menus','menu_dishes','job_menus',
    'mise_records','prep_lists','attachments','expenses','mileage','staff'
  ];
  -- everyone reads, only owner/admin writes (money & business identity)
  manager_write text[] := array[
    'invoices','invoice_items','payments','quotes','costings',
    'tax_categories','business_settings'
  ];
  -- jobs + haccp_records are handled explicitly below (job-scoped)
  scoped text[] := array['jobs','haccp_records'];
  t text;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname='public' and tablename = any(full_access || manager_write || scoped)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  foreach t in array full_access loop
    execute format($p$
      create policy venue_rw on public.%I for all to authenticated
        using (venue_id = public.auth_venue_id())
        with check (venue_id = public.auth_venue_id())$p$, t);
  end loop;

  foreach t in array manager_write loop
    execute format($p$
      create policy venue_read on public.%I for select to authenticated
        using (venue_id = public.auth_venue_id())$p$, t);
    execute format($p$
      create policy venue_manage on public.%I for all to authenticated
        using (venue_id = public.auth_venue_id() and public.is_venue_manager())
        with check (venue_id = public.auth_venue_id() and public.is_venue_manager())$p$, t);
  end loop;
end $$;

-- 4a. JOBS: owner/admin create & edit jobs; members see only the jobs
--     they can access (manager / all-jobs / assigned).
create policy jobs_read on public.jobs for select to authenticated
  using (venue_id = public.auth_venue_id() and public.can_access_job(id));
create policy jobs_manage on public.jobs for all to authenticated
  using (venue_id = public.auth_venue_id() and public.is_venue_manager())
  with check (venue_id = public.auth_venue_id() and public.is_venue_manager());

-- 4b. HACCP_RECORDS: staff log by default; job-linked rows require access
--     to that job. Creators can always see their own rows.
create policy haccp_read on public.haccp_records for select to authenticated
  using (venue_id = public.auth_venue_id()
         and (public.can_access_job(job_id) or created_by = auth.uid()));
create policy haccp_write on public.haccp_records for insert to authenticated
  with check (venue_id = public.auth_venue_id() and public.can_access_job(job_id));
create policy haccp_modify on public.haccp_records for update to authenticated
  using (venue_id = public.auth_venue_id() and public.can_access_job(job_id))
  with check (venue_id = public.auth_venue_id() and public.can_access_job(job_id));
create policy haccp_delete on public.haccp_records for delete to authenticated
  using (venue_id = public.auth_venue_id()
         and (public.is_venue_manager() or created_by = auth.uid()));

-- 4c. JOB_ASSIGNMENTS: managers assign/unassign; a member can see their own.
create policy ja_read on public.job_assignments for select to authenticated
  using (venue_id = public.auth_venue_id()
         and (public.is_venue_manager() or user_id = auth.uid()));
create policy ja_manage on public.job_assignments for all to authenticated
  using (venue_id = public.auth_venue_id() and public.is_venue_manager())
  with check (venue_id = public.auth_venue_id() and public.is_venue_manager());

-- ---------------------------------------------------------------------
-- 5. Invitations: owner/admin invite, accept handled by an edge function
--    running with the service role (which bypasses RLS).
-- ---------------------------------------------------------------------
create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  email       text not null,
  role        text not null default 'staff' check (role in ('owner','admin','staff')),
  token       text not null unique default gen_random_uuid()::text,
  invited_by  uuid references auth.users(id),
  status      text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);
create index if not exists invitations_venue_idx on public.invitations (venue_id);
create index if not exists invitations_email_idx on public.invitations (lower(email));
alter table public.invitations enable row level security;

drop policy if exists inv_manage on public.invitations;
create policy inv_manage on public.invitations for all to authenticated
  using (venue_id = public.auth_venue_id() and public.is_venue_manager())
  with check (venue_id = public.auth_venue_id() and public.is_venue_manager());

commit;

-- =====================================================================
-- FOLLOW-UPS — review before running, these change app behaviour:
-- ---------------------------------------------------------------------
-- (A) mise_records primary key is (user_id, date). With shared logging two
--     teammates cannot both have a row for the same day. Move to a surrogate
--     key (coordinate with the app's upsert logic before running):
--       alter table public.mise_records add column if not exists id uuid default gen_random_uuid();
--       -- then rebuild PK as (id) and add unique (venue_id, user_id, date) if desired.
--
-- (B) haccp upserts: app currently keys on (user_id, date). For per-job logs,
--     key on (job_id) when a job is selected, else (kitchen_id, date).
--
-- (C) settings & mise_settings are keyed id = user (per-user). If the HACCP
--     checklist template should be shared venue-wide, migrate their config
--     to a venue-keyed row in a later phase.
--
-- (D) DEFAULT: a staff member with no assignment and all_jobs_access=false can
--     only create GENERAL (null job_id) HACCP logs. Assign them to a job, or
--     set profiles.all_jobs_access=true, to log against a specific gig.
--     To instead let every staff member see every job by default, change
--     can_access_job() to `select true` for the assignment branch.
-- =====================================================================
