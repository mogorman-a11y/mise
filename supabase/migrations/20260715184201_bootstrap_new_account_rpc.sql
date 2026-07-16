-- Atomic account bootstrap. Previously auth.js ran three sequential
-- client-side inserts (kitchens, profiles, kitchen_members) and only
-- warn()'d if the venue-linking step failed. Since venue-scoped RLS has
-- no null-venue_id fallback for most policies, any partial failure left
-- an account permanently locked out of its own data — confirmed live:
-- every signup for ~3 weeks had profiles.venue_id = NULL.
--
-- This creates venue + kitchen + profile (role=owner) + kitchen_members
-- in one transaction, deriving the user id from auth.uid() server-side
-- (never trust a client-supplied id). auth.js:createProfile now calls
-- this single RPC instead.
create or replace function public.bootstrap_new_account(p_business_name text, p_chef_name text)
returns table (kitchen_id uuid, venue_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_kitchen_name text;
  v_kitchen_id uuid;
  v_venue_id uuid;
  v_trial_ends timestamptz := now() + interval '14 days';
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'profile already exists for this user';
  end if;

  v_kitchen_name := coalesce(
    nullif(p_business_name, ''),
    case when p_chef_name is not null and p_chef_name <> '' then p_chef_name || '''s Kitchen' else 'My Kitchen' end
  );

  insert into public.venues (name) values (v_kitchen_name) returning id into v_venue_id;
  insert into public.kitchens (name, owner_user_id, venue_id) values (v_kitchen_name, v_user_id, v_venue_id) returning id into v_kitchen_id;

  insert into public.profiles (id, business_name, chef_name, subscription_status, trial_ends_at, kitchen_id, venue_id, role)
  values (v_user_id, coalesce(p_business_name, ''), coalesce(p_chef_name, ''), 'trial', v_trial_ends, v_kitchen_id, v_venue_id, 'owner');

  insert into public.kitchen_members (kitchen_id, user_id, role) values (v_kitchen_id, v_user_id, 'owner');

  return query select v_kitchen_id, v_venue_id;
end;
$$;

revoke all on function public.bootstrap_new_account(text, text) from public;
grant execute on function public.bootstrap_new_account(text, text) to authenticated;
