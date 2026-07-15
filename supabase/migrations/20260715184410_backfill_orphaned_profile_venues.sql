-- One-time backfill for the 4 profiles that predate bootstrap_new_account_rpc
-- and were created with venue_id = NULL (the active-lockout bug fixed by
-- that migration). Each was confirmed live (owner_user_id = profile id on
-- their kitchen row, no invited_by) to be an independent kitchen owner, not
-- a shared/invited account — so each gets its own new venue rather than
-- being linked to an existing one. Guards against re-running against a
-- profile that isn't actually a kitchen owner (would need manual review
-- instead of an automatic venue synthesis).
do $$
declare
  r record;
  v_venue_id uuid;
  v_count int := 0;
begin
  for r in
    select p.id as profile_id, p.kitchen_id, k.name as kitchen_name, p.business_name, p.chef_name, k.owner_user_id
    from public.profiles p
    left join public.kitchens k on k.id = p.kitchen_id
    where p.venue_id is null
  loop
    if r.owner_user_id is distinct from r.profile_id then
      raise exception 'profile % is not the owner of kitchen % — needs manual review, not auto-backfilled', r.profile_id, r.kitchen_id;
    end if;

    insert into public.venues (name)
    values (coalesce(nullif(r.business_name,''), r.kitchen_name, 'My Kitchen'))
    returning id into v_venue_id;

    update public.profiles set venue_id = v_venue_id, role = case when role = 'staff' then 'owner' else role end
    where id = r.profile_id;

    if r.kitchen_id is not null then
      update public.kitchens set venue_id = v_venue_id where id = r.kitchen_id;
    end if;

    v_count := v_count + 1;
  end loop;

  raise notice 'Backfilled % orphaned profile(s) with new venues', v_count;
end $$;
