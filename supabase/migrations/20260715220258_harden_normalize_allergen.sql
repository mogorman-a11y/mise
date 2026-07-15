-- normalize_allergen (from 20260715185637) was created with no fixed
-- search_path and was publicly executable (PUBLIC + anon both had EXECUTE).
-- The function is pure string comparison with no table/DB access, so this
-- wasn't exploitable, but it's still not minimal-grants. Found during PR #3
-- review.
create or replace function public.normalize_allergen(a text)
returns text
language sql
immutable
set search_path = public, pg_catalog
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

revoke all on function public.normalize_allergen(text) from public;
revoke execute on function public.normalize_allergen(text) from anon;
grant execute on function public.normalize_allergen(text) to authenticated;
