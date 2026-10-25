-- Allow signed-in users to read and write only their own legacy settings rows.
-- These two tables remain user-keyed (`id = auth.uid()`); venue sharing for
-- templates is a separate future migration and is intentionally not broadened
-- here.

begin;

alter table if exists public.settings enable row level security;
alter table if exists public.mise_settings enable row level security;

grant select, insert, update, delete on public.settings to authenticated;
grant select, insert, update, delete on public.mise_settings to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['settings', 'mise_settings'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists "own settings row" on public.%I', table_name);
      execute format($policy$
        create policy "own settings row" on public.%I
          for all to authenticated
          using (id = auth.uid())
          with check (id = auth.uid())
      $policy$, table_name);
    end if;
  end loop;
end $$;

commit;
