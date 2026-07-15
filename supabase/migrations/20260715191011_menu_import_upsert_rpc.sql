-- Atomic AI-menu-import: upserts every new dish, upserts the menu, and
-- replaces its menu_dishes relationships in ONE transaction. Previously
-- (menus.js handleMagicImport) these were three separate unawaited client
-- calls that always reported success regardless of outcome — could leave
-- a menu saved with zero dish relationships. Called from the client via
-- Mise.sync.importMenu() (sync.js).
--
-- Revised after review: the ON CONFLICT ... WHERE user_id = v_user_id guards
-- silently no-op instead of erroring when a supplied id already belongs to
-- another account (client-generated ids can collide), so success/counts
-- were not actually verified — this version explicitly checks ownership of
-- every dish/menu row after writing it and raises (rather than returning a
-- misleadingly "successful" partial result) on any mismatch, so the client
-- retry queue correctly retains the item instead of treating it as done.
create or replace function public.menu_import_upsert(p_dishes jsonb, p_menu jsonb, p_menu_dish_ids text[])
returns table (out_menu_id text, out_dish_count int)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_menu_id text := p_menu->>'id';
  v_dish jsonb;
  v_dish_id text;
  v_requested_count int;
  v_distinct_count int;
  v_inserted_count int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if v_menu_id is null or v_menu_id = '' then
    raise exception 'menu id is required';
  end if;

  v_requested_count := coalesce(array_length(p_menu_dish_ids, 1), 0);
  select count(distinct x) into v_distinct_count from unnest(coalesce(p_menu_dish_ids, array[]::text[])) x;
  if v_requested_count <> v_distinct_count then
    raise exception 'duplicate dish ids in p_menu_dish_ids';
  end if;

  for v_dish in select * from jsonb_array_elements(coalesce(p_dishes, '[]'::jsonb))
  loop
    v_dish_id := v_dish->>'id';
    insert into public.dishes (id, user_id, name, category, allergens, updated_at)
    values (
      v_dish_id, v_user_id, v_dish->>'name', nullif(v_dish->>'category',''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_dish->'allergens','[]'::jsonb)) x), array[]::text[]),
      now()
    )
    on conflict (id) do update set
      name = excluded.name, category = excluded.category, allergens = excluded.allergens, updated_at = now()
    where public.dishes.user_id = v_user_id;

    if not exists (select 1 from public.dishes where id = v_dish_id and user_id = v_user_id) then
      raise exception 'dish % could not be saved — id may already belong to another account', v_dish_id;
    end if;
  end loop;

  insert into public.menus (id, user_id, name, updated_at)
  values (v_menu_id, v_user_id, p_menu->>'name', now())
  on conflict (id) do update set
    name = excluded.name, updated_at = now()
  where public.menus.user_id = v_user_id;

  if not exists (select 1 from public.menus where id = v_menu_id and user_id = v_user_id) then
    raise exception 'menu % could not be saved — id may already belong to another account', v_menu_id;
  end if;

  -- Every requested dish id must exist for this user (whether it was just
  -- upserted above, or is a pre-existing dish being reused) before wiring
  -- up relationships — otherwise a bad id would just be silently dropped
  -- from the join below with no signal.
  if v_requested_count > 0 then
    perform 1 from unnest(p_menu_dish_ids) as req(id)
      where not exists (select 1 from public.dishes d where d.id = req.id and d.user_id = v_user_id)
      limit 1;
    if found then
      raise exception 'one or more requested dish ids do not exist for this account';
    end if;
  end if;

  delete from public.menu_dishes md where md.menu_id = v_menu_id and md.user_id = v_user_id;

  insert into public.menu_dishes (user_id, menu_id, dish_id, dish_name, category, allergens, sort_order)
  select v_user_id, v_menu_id, d.id, d.name, d.category, d.allergens, ord.ordinality - 1
  from unnest(p_menu_dish_ids) with ordinality as ord(dish_id, ordinality)
  join public.dishes d on d.id = ord.dish_id and d.user_id = v_user_id;

  get diagnostics v_inserted_count = row_count;

  if v_inserted_count <> v_requested_count then
    raise exception 'expected % menu_dishes relationship(s), only % were created', v_requested_count, v_inserted_count;
  end if;

  return query select v_menu_id, v_inserted_count;
end;
$$;

revoke all on function public.menu_import_upsert(jsonb, jsonb, text[]) from public;
revoke execute on function public.menu_import_upsert(jsonb, jsonb, text[]) from anon;
grant execute on function public.menu_import_upsert(jsonb, jsonb, text[]) to authenticated;
