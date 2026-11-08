-- Run AFTER the migration, inside BEGIN/ROLLBACK. No HTTP is sent until commit.
do $$
declare
  test_user uuid := gen_random_uuid();
  signup_id uuid;
  request bigint;
  count_events integer;
begin
  if has_schema_privilege('anon', 'veriqo_analytics', 'USAGE')
    or has_schema_privilege('authenticated', 'veriqo_analytics', 'USAGE') then
    raise exception 'Analytics schema must not be exposed to app roles';
  end if;
  insert into auth.users(id,email,aud,role)
    values(test_user,'tracking-rollback-test@example.invalid','authenticated','authenticated');
  select id into signup_id from veriqo_analytics.outbox
    where distinct_id=test_user and event='signup_completed';
  if signup_id is null then raise exception 'Signup missing'; end if;
  insert into auth.users(id,email,is_anonymous) values(gen_random_uuid(),'anonymous-test@example.invalid',true);
  insert into auth.users(id,email,invited_at) values(gen_random_uuid(),'invite-test@example.invalid',now());
  if (select count(*) from veriqo_analytics.outbox where event='signup_completed') <> 1 then
    raise exception 'Invited/anonymous accounts counted as self-serve signups';
  end if;
  insert into public.jobs
    select (jsonb_populate_record(null::public.jobs, to_jsonb(j) || jsonb_build_object('id','tracking-rollback-job'))).*
    from public.jobs j limit 1;
  insert into public.dishes
    select (jsonb_populate_record(null::public.dishes, to_jsonb(d) || jsonb_build_object('id','tracking-rollback-dish'))).*
    from public.dishes d limit 1;
  if not exists(select 1 from veriqo_analytics.outbox where event='job_created' and entity_id='tracking-rollback-job')
    or not exists(select 1 from veriqo_analytics.outbox where event='dish_created' and entity_id='tracking-rollback-dish') then
    raise exception 'Business creation events missing';
  end if;
  update public.jobs set title=title where id='tracking-rollback-job';
  update public.dishes set name=name where id='tracking-rollback-dish';
  select count(*) into count_events from veriqo_analytics.outbox;
  if count_events <> 3 then raise exception 'Updates duplicated creation events'; end if;
  insert into veriqo_analytics.config values(true,'test-token','https://eu.i.posthog.com');
  perform veriqo_analytics.flush();
  select request_id into request from veriqo_analytics.outbox where id=signup_id;
  if request is null then raise exception 'Event not queued'; end if;
  insert into net._http_response(id,status_code) values(request,503);
  perform veriqo_analytics.flush();
  if not exists(select 1 from veriqo_analytics.outbox where id=signup_id and request_id is null
      and delivered_at is null and next_attempt_at>now()) then raise exception 'Failure not retried'; end if;
  update veriqo_analytics.outbox set next_attempt_at=now() where id=signup_id;
  perform veriqo_analytics.flush();
  select request_id into request from veriqo_analytics.outbox where id=signup_id;
  insert into net._http_response(id,status_code) values(request,200);
  perform veriqo_analytics.flush();
  if not exists(select 1 from veriqo_analytics.outbox where id=signup_id and delivered_at is not null
      and attempts=2) then raise exception 'Successful retry not acknowledged'; end if;
end;
$$;
