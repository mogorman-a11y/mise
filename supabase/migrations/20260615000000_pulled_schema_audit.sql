-- =============================================================================
-- PULLED SCHEMA AUDIT — 2026-06-15
-- Source: supabase db pull (via MCP execute_sql) against project yixrwyfodipfcbhjcszp
-- =============================================================================
--
-- Purpose: authoritative snapshot of the multi-user objects as they exist in
-- the live database on 2026-06-15. Captured because Docker was unavailable
-- for `supabase db dump`, so definitions were extracted via pg_get_functiondef()
-- and information_schema queries through the Supabase MCP tool.
--
-- DO NOT RUN against a fresh database — this is a reference snapshot, not an
-- idempotent migration. To recreate the schema from scratch use the two
-- authored migration files in this directory instead.
--
-- Remote migration history on this date (13 applied migrations):
--   20260515161154  20260515163237  20260517085423  20260517181024
--   20260519090844  20260528150713  20260528170716  20260605162925
--   20260605165655  20260605171140  20260606065912  20260611183250
--   20260611184806
-- =============================================================================


-- =============================================================================
-- 1. custom_access_token_hook  (full body confirmed via pg_get_functiondef)
-- =============================================================================
-- Embeds venue_id and user_role as top-level JWT claims so RLS policies can
-- read them cheaply without a per-row database call.
-- Granted to: supabase_auth_admin, service_role, postgres.
-- Bound in Supabase Dashboard → Authentication → Hooks → Custom Access Token.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_venue_id  UUID;
  v_role      TEXT;
  claims      JSONB;
BEGIN
  SELECT venue_id, role
    INTO v_venue_id, v_role
    FROM public.profiles
   WHERE id = (event ->> 'user_id')::UUID;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{venue_id}',
              CASE WHEN v_venue_id IS NULL THEN 'null'::jsonb
                   ELSE to_jsonb(v_venue_id::TEXT) END, true);
  claims := jsonb_set(claims, '{user_role}',
              to_jsonb(COALESCE(v_role, 'staff')), true);

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;


-- =============================================================================
-- 2. Helper functions  (all confirmed present via pg_get_functiondef)
-- =============================================================================

-- Returns the calling user's venue_id: JWT claim first, DB fallback.
CREATE OR REPLACE FUNCTION public.auth_venue_id()
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT coalesce(
    nullif(auth.jwt() ->> 'venue_id', '')::uuid,
    (SELECT venue_id FROM public.profiles WHERE id = auth.uid())
  );
$$;

-- Returns the calling user's role: JWT claim first, DB fallback, then 'staff'.
CREATE OR REPLACE FUNCTION public.auth_user_role()
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT coalesce(
    nullif(auth.jwt() ->> 'user_role', ''),
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    'staff'
  );
$$;

-- Returns true if the calling user is owner or admin.
CREATE OR REPLACE FUNCTION public.is_venue_manager()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT public.auth_user_role() IN ('owner', 'admin');
$$;

-- Returns true if the calling user may access HACCP records for a given job.
-- true for: null job_id (general log), managers, all_jobs_access members,
-- and members explicitly assigned to the job via job_assignments.
CREATE OR REPLACE FUNCTION public.can_access_job(p_job_id text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT
    p_job_id IS NULL
    OR public.is_venue_manager()
    OR coalesce((SELECT all_jobs_access FROM public.profiles WHERE id = auth.uid()), false)
    OR EXISTS (SELECT 1 FROM public.job_assignments ja
               WHERE ja.job_id = p_job_id AND ja.user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION
  public.auth_venue_id(),
  public.auth_user_role(),
  public.is_venue_manager(),
  public.can_access_job(text)
  TO authenticated;


-- =============================================================================
-- 3. venues table  (confirmed via information_schema.columns)
-- =============================================================================
-- Columns: id uuid PK, name text NOT NULL, stripe_customer_id text,
--          stripe_price_id text, subscription_status text DEFAULT 'trialing',
--          created_at timestamptz DEFAULT now()

CREATE TABLE IF NOT EXISTS public.venues (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  stripe_customer_id  TEXT,
  stripe_price_id     TEXT,
  subscription_status TEXT        NOT NULL DEFAULT 'trialing',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 4. profiles column additions  (confirmed via information_schema.columns)
-- =============================================================================
-- role        text NOT NULL DEFAULT 'staff'
-- venue_id    uuid (nullable FK to venues)
-- status      text NOT NULL DEFAULT 'active'
-- invited_by  uuid (nullable)
-- all_jobs_access boolean NOT NULL DEFAULT false

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS venue_id        UUID    REFERENCES public.venues(id),
  ADD COLUMN IF NOT EXISTS role            TEXT    NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS status          TEXT    NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS invited_by      UUID    REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS all_jobs_access BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_venue_id ON public.profiles (venue_id);


-- =============================================================================
-- 5. venue_id added to all 20 shared tables  (DEFAULT auth_venue_id())
-- =============================================================================
-- Confirmed present on: attachments, business_settings, clients, costings,
-- dishes, expenses, haccp_records, invoice_items, invoices, job_assignments,
-- job_menus, jobs, menu_dishes, menus, mileage, mise_records, payments,
-- prep_lists, quotes, staff, tax_categories
-- Note: invitations.venue_id has no DEFAULT (set explicitly on insert).

DO $$
DECLARE
  t text;
  shared_tables text[] := ARRAY[
    'jobs','clients','dishes','menus','menu_dishes','job_menus',
    'haccp_records','mise_records','prep_lists','attachments',
    'invoice_items','invoices','payments','expenses','mileage',
    'quotes','costings','tax_categories','business_settings','staff'
  ];
BEGIN
  FOREACH t IN ARRAY shared_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id)', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (venue_id)', t||'_venue_idx', t);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN venue_id SET DEFAULT public.auth_venue_id()', t);
  END LOOP;
END $$;


-- =============================================================================
-- 6. haccp_records.job_id  (per-job HACCP log scoping)
-- =============================================================================

ALTER TABLE public.haccp_records
  ADD COLUMN IF NOT EXISTS job_id     TEXT REFERENCES public.jobs(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS haccp_records_job_idx ON public.haccp_records (job_id);


-- =============================================================================
-- 7. job_assignments table  (confirmed via information_schema.columns)
-- =============================================================================
-- id uuid PK, venue_id uuid NOT NULL DEFAULT auth_venue_id(),
-- job_id text NOT NULL, user_id uuid NOT NULL,
-- assigned_by uuid DEFAULT auth.uid(), created_at timestamptz

CREATE TABLE IF NOT EXISTS public.job_assignments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE
                                   DEFAULT public.auth_venue_id(),
  job_id      TEXT        NOT NULL REFERENCES public.jobs(id)   ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  assigned_by UUID        REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS job_assignments_user_idx ON public.job_assignments (user_id);
CREATE INDEX IF NOT EXISTS job_assignments_job_idx  ON public.job_assignments (job_id);
ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 8. invitations table  (confirmed via information_schema.columns)
-- =============================================================================
-- id uuid PK, venue_id uuid NOT NULL, email text, role text DEFAULT 'staff',
-- token text UNIQUE DEFAULT gen_random_uuid()::text, invited_by uuid,
-- status text DEFAULT 'pending', created_at timestamptz,
-- expires_at timestamptz DEFAULT now()+14days, accepted_at timestamptz

CREATE TABLE IF NOT EXISTS public.invitations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'staff'
                          CHECK (role IN ('owner','admin','staff')),
  token       TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  invited_by  UUID        REFERENCES auth.users(id),
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','revoked','expired')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS invitations_venue_idx ON public.invitations (venue_id);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON public.invitations (lower(email));
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 9. RLS policies  (all confirmed present via pg_policies)
-- =============================================================================

-- ── venues ───────────────────────────────────────────────────────────────────
CREATE POLICY venues_insert ON public.venues
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY venues_select ON public.venues
  FOR SELECT TO authenticated
  USING (id = (auth.jwt() ->> 'venue_id')::uuid);

CREATE POLICY venues_update ON public.venues
  FOR UPDATE TO authenticated
  USING (id = (auth.jwt() ->> 'venue_id')::uuid
         AND (auth.jwt() ->> 'user_role') = ANY (ARRAY['owner','admin']))
  WITH CHECK (id = (auth.jwt() ->> 'venue_id')::uuid
              AND (auth.jwt() ->> 'user_role') = ANY (ARRAY['owner','admin']));

-- ── profiles ─────────────────────────────────────────────────────────────────
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (venue_id = ((auth.jwt() ->> 'venue_id'))::uuid
         OR (((auth.jwt() ->> 'venue_id') IS NULL) AND id = auth.uid()));

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()
         OR (venue_id = ((auth.jwt() ->> 'venue_id'))::uuid
             AND (auth.jwt() ->> 'user_role') = ANY (ARRAY['owner','admin'])))
  WITH CHECK (id = auth.uid()
              OR (venue_id = ((auth.jwt() ->> 'venue_id'))::uuid
                  AND (auth.jwt() ->> 'user_role') = ANY (ARRAY['owner','admin'])));

-- ── Full venue read+write (clients, dishes, menus, menu_dishes, job_menus,
--    mise_records, prep_lists, attachments, expenses, mileage, staff) ─────────
-- Pattern: venue_rw — ALL commands, venue_id = auth_venue_id()
CREATE POLICY venue_rw ON public.clients     FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.dishes      FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.menus       FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.menu_dishes FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.job_menus   FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.mise_records FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.prep_lists  FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.attachments FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.expenses    FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.mileage     FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.staff       FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());

-- ── Manager-write tables (invoices, payments, quotes, costings,
--    invoice_items, tax_categories, business_settings) ─────────────────────────
-- Pattern: venue_read (SELECT all) + venue_manage (ALL, manager only)
CREATE POLICY venue_read   ON public.invoices       FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.invoices       FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

CREATE POLICY venue_read   ON public.payments       FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.payments       FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

CREATE POLICY venue_read   ON public.quotes         FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.quotes         FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

CREATE POLICY venue_read   ON public.costings       FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.costings       FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

CREATE POLICY venue_read   ON public.invoice_items  FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.invoice_items  FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

CREATE POLICY venue_read   ON public.tax_categories FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.tax_categories FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

CREATE POLICY venue_read   ON public.business_settings FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id());
CREATE POLICY venue_manage ON public.business_settings FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

-- ── jobs (job-scoped) ─────────────────────────────────────────────────────────
CREATE POLICY jobs_read   ON public.jobs FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.can_access_job(id));
CREATE POLICY jobs_manage ON public.jobs FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

-- ── haccp_records (job-scoped, 4 separate command policies) ──────────────────
CREATE POLICY haccp_read   ON public.haccp_records FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id()
         AND (public.can_access_job(job_id) OR created_by = auth.uid()));
CREATE POLICY haccp_write  ON public.haccp_records FOR INSERT TO authenticated
  WITH CHECK (venue_id = public.auth_venue_id() AND public.can_access_job(job_id));
CREATE POLICY haccp_modify ON public.haccp_records FOR UPDATE TO authenticated
  USING      (venue_id = public.auth_venue_id() AND public.can_access_job(job_id))
  WITH CHECK (venue_id = public.auth_venue_id() AND public.can_access_job(job_id));
CREATE POLICY haccp_delete ON public.haccp_records FOR DELETE TO authenticated
  USING (venue_id = public.auth_venue_id()
         AND (public.is_venue_manager() OR created_by = auth.uid()));

-- ── job_assignments ───────────────────────────────────────────────────────────
CREATE POLICY ja_read   ON public.job_assignments FOR SELECT TO authenticated
  USING (venue_id = public.auth_venue_id()
         AND (public.is_venue_manager() OR user_id = auth.uid()));
CREATE POLICY ja_manage ON public.job_assignments FOR ALL    TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());

-- ── invitations ───────────────────────────────────────────────────────────────
CREATE POLICY inv_manage ON public.invitations FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id() AND public.is_venue_manager())
  WITH CHECK (venue_id = public.auth_venue_id() AND public.is_venue_manager());
