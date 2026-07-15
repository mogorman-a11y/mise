-- Atomic AI-menu-import: upserts every new dish, upserts the menu, and
-- replaces its menu_dishes relationships in ONE transaction. Previously
-- (menus.js handleMagicImport) these were three separate unawaited client
-- calls that always reported success regardless of outcome — could leave
-- a menu saved with zero dish relationships. Called from the client via
-- Mise.sync.importMenu() (sync.js).
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
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if v_menu_id is null or v_menu_id = '' then
    raise exception 'menu id is required';
  end if;

  for v_dish in select * from jsonb_array_elements(coalesce(p_dishes, '[]'::jsonb))
  loop
    insert into public.dishes (id, user_id, name, category, allergens, updated_at)
    values (
      v_dish->>'id', v_user_id, v_dish->>'name', nullif(v_dish->>'category',''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_dish->'allergens','[]'::jsonb)) x), array[]::text[]),
      now()
    )
    on conflict (id) do update set
      name = excluded.name, category = excluded.category, allergens = excluded.allergens, updated_at = now()
    where public.dishes.user_id = v_user_id;
  end loop;

  insert into public.menus (id, user_id, name, updated_at)
  values (v_menu_id, v_user_id, p_menu->>'name', now())
  on conflict (id) do update set
    name = excluded.name, updated_at = now()
  where public.menus.user_id = v_user_id;

  delete from public.menu_dishes md where md.menu_id = v_menu_id and md.user_id = v_user_id;

  insert into public.menu_dishes (user_id, menu_id, dish_id, dish_name, category, allergens, sort_order)
  select v_user_id, v_menu_id, d.id, d.name, d.category, d.allergens, ord.ordinality - 1
  from unnest(coalesce(p_menu_dish_ids, array[]::text[])) with ordinality as ord(dish_id, ordinality)
  join public.dishes d on d.id = ord.dish_id and d.user_id = v_user_id;

  return query select v_menu_id, coalesce(array_length(p_menu_dish_ids, 1), 0);
end;
$$;

revoke all on function public.menu_import_upsert(jsonb, jsonb, text[]) from public;
grant execute on function public.menu_import_upsert(jsonb, jsonb, text[]) to authenticated;
