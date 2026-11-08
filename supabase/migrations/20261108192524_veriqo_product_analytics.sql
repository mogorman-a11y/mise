-- Confirmed account/job/dish creation; no browser dependency or historical backfill.
-- Existing pg_net and pg_cron extensions are prerequisites.
create schema veriqo_analytics;
revoke all on schema veriqo_analytics from public, anon, authenticated;

create table veriqo_analytics.config (
  singleton boolean primary key default true check (singleton),
  project_token text not null,
  capture_host text not null check (capture_host = 'https://eu.i.posthog.com')
);
create table veriqo_analytics.outbox (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  distinct_id uuid not null,
  entity_id text not null,
  occurred_at timestamptz not null default now(),
  properties jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  request_id bigint,
  requested_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  unique (event, entity_id)
);
alter table veriqo_analytics.config enable row level security;
alter table veriqo_analytics.outbox enable row level security;
revoke all on all tables in schema veriqo_analytics from public, anon, authenticated;
create index outbox_pending on veriqo_analytics.outbox(next_attempt_at)
  where delivered_at is null;

create function veriqo_analytics.enqueue_creation() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid;
  event_name text;
begin
  if tg_table_schema = 'auth' then
    if coalesce(new.is_anonymous, false) or new.invited_at is not null then return new; end if;
    actor := new.id;
    event_name := 'signup_completed';
  else
    actor := coalesce(auth.uid(), new.user_id);
    event_name := case tg_table_name when 'jobs' then 'job_created' else 'dish_created' end;
  end if;
  if actor is null then return new; end if;
  insert into veriqo_analytics.outbox(event, distinct_id, entity_id, properties)
  values (event_name, actor, new.id::text,
    jsonb_build_object('source', 'supabase', 'tracking_version', 2,
      'entity_id', new.id::text, '$process_person_profile', true))
  on conflict (event, entity_id) do nothing;
  return new;
exception when others then
  -- Analytics failure cannot block a signup or a customer's business write.
  raise warning 'Veriqo analytics enqueue failed: %', sqlstate;
  return new;
end;
$$;
revoke all on function veriqo_analytics.enqueue_creation() from public, anon, authenticated;

create trigger veriqo_analytics_signup after insert on auth.users
for each row execute function veriqo_analytics.enqueue_creation();
create trigger veriqo_analytics_job after insert on public.jobs
for each row execute function veriqo_analytics.enqueue_creation();
create trigger veriqo_analytics_dish after insert on public.dishes
for each row execute function veriqo_analytics.enqueue_creation();

create function veriqo_analytics.flush() returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare
  cfg veriqo_analytics.config%rowtype;
  entry veriqo_analytics.outbox%rowtype;
  response record;
  queued integer := 0;
begin
  -- Serialize cron/manual runs; never send the same row concurrently.
  if not pg_try_advisory_xact_lock(8631920261108::bigint) then return 0; end if;
  select * into cfg from veriqo_analytics.config where singleton;
  if not found then return 0; end if;

  for entry in select * from veriqo_analytics.outbox
    where delivered_at is null and request_id is not null
    order by requested_at limit 100
  loop
    select status_code, error_msg, timed_out into response
      from net._http_response where id = entry.request_id;
    if found then
      if response.status_code between 200 and 299
        and response.error_msg is null and not coalesce(response.timed_out, false) then
        update veriqo_analytics.outbox set delivered_at = now(), last_error = null where id = entry.id;
      else
        update veriqo_analytics.outbox set request_id = null,
          last_error = coalesce(response.error_msg, 'HTTP ' || response.status_code::text, 'HTTP timeout'),
          next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, least(attempts, 6)))::integer)
          where id = entry.id;
      end if;
    elsif entry.requested_at < now() - interval '10 minutes' then
      -- pg_net queues/responses are unlogged; recover after restart or expiry.
      update veriqo_analytics.outbox set request_id = null, next_attempt_at = now(),
        last_error = 'Response missing after 10 minutes' where id = entry.id;
    end if;
  end loop;

  for entry in select * from veriqo_analytics.outbox
    where delivered_at is null and request_id is null and next_attempt_at <= now()
    order by next_attempt_at limit 100 for update skip locked
  loop
    begin
      update veriqo_analytics.outbox set request_id = net.http_post(
        url := cfg.capture_host || '/i/v0/e/',
        body := jsonb_build_object('api_key', cfg.project_token, 'event', entry.event,
          'uuid', entry.id, 'distinct_id', entry.distinct_id::text,
          'timestamp', entry.occurred_at, 'properties', entry.properties),
        headers := '{"Content-Type":"application/json"}'::jsonb,
        timeout_milliseconds := 5000), requested_at = now(), attempts = attempts + 1
        where id = entry.id;
      queued := queued + 1;
    exception when others then
      update veriqo_analytics.outbox set last_error = sqlstate,
        next_attempt_at = now() + interval '5 minutes' where id = entry.id;
    end;
  end loop;
  delete from veriqo_analytics.outbox where delivered_at < now() - interval '30 days';
  return queued;
end;
$$;
revoke all on function veriqo_analytics.flush() from public, anon, authenticated;
select cron.schedule('veriqo-posthog-outbox', '* * * * *', 'select veriqo_analytics.flush()');
