-- Normalizes existing dishes.allergens / menu_dishes.allergens rows to the
-- canonical spelling (see js/core/allergens.js — same file the client and
-- api/*.js now share). Fixes a live bug: HACCP used 'Cereals containing
-- gluten'/'Sulphur dioxide' while Menus + both AI endpoints used 'Cereals
-- with gluten'/'Sulphites', so guest-conflict matching (exact string
-- comparison) silently missed real gluten/sulphite allergy conflicts.
-- Confirmed live on 9 dishes + 9 menu_dishes rows before this ran.
--
-- Idempotent (only updates rows where old != new, so rerunning is a no-op);
-- deduplicates per-array; preserves any value it doesn't recognize instead
-- of dropping it.
create or replace function public.normalize_allergen(a text)
returns text
language sql
immutable
as $$
  select case
    when a is null then null
    when trim(a) = '' then trim(a)
    when lower(trim(a)) like '%cereal%' or lower(trim(a)) like '%gluten%' then 'Cereals containing gluten'
    when lower(trim(a)) like '%sulph%' or lower(trim(a)) like '%sulf%' then 'Sulphur dioxide'
    else coalesce(
      (select e from unnest(array['Celery','Cereals containing gluten','Crustaceans','Eggs','Fish','Lupin','Milk','Molluscs','Mustard','Nuts','Peanuts','Sesame','Soya','Sulphur dioxide']) e where lower(e) = lower(trim(a))),
      trim(a)
    )
  end;
$$;

do $$
declare
  v_dishes_changed int := 0;
  v_menu_dishes_changed int := 0;
  v_dishes_total int;
  v_menu_dishes_total int;
begin
  with computed as (
    select id, allergens as old_allergens,
           (select array_agg(distinct public.normalize_allergen(x) order by public.normalize_allergen(x)) from unnest(allergens) x) as new_allergens
    from public.dishes
    where allergens is not null and array_length(allergens, 1) > 0
  )
  update public.dishes d
  set allergens = c.new_allergens, updated_at = now()
  from computed c
  where c.id = d.id and c.old_allergens is distinct from c.new_allergens;
  get diagnostics v_dishes_changed = row_count;

  select count(*) into v_dishes_total from public.dishes where allergens is not null and array_length(allergens,1) > 0;

  with computed as (
    select id, allergens as old_allergens,
           (select array_agg(distinct public.normalize_allergen(x) order by public.normalize_allergen(x)) from unnest(allergens) x) as new_allergens
    from public.menu_dishes
    where allergens is not null and array_length(allergens, 1) > 0
  )
  update public.menu_dishes m
  set allergens = c.new_allergens, updated_at = now()
  from computed c
  where c.id = m.id and c.old_allergens is distinct from c.new_allergens;
  get diagnostics v_menu_dishes_changed = row_count;

  select count(*) into v_menu_dishes_total from public.menu_dishes where allergens is not null and array_length(allergens,1) > 0;

  raise notice 'Allergen normalization: dishes changed=% of % total; menu_dishes changed=% of % total', v_dishes_changed, v_dishes_total, v_menu_dishes_changed, v_menu_dishes_total;
end $$;
