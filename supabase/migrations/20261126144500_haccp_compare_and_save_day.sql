-- Conditionally write the exact version read by the client. Existing RLS
-- applies and an in-flight request cannot move records to another account.
create function public.haccp_compare_and_save_day(
  p_user_id uuid,
  p_date text,
  p_exists boolean,
  p_expected jsonb,
  p_records jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is distinct from p_user_id or p_user_id is null then
    raise exception 'HACCP account changed' using errcode = '42501';
  end if;

  if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Invalid HACCP day' using errcode = '22023';
  end if;

  if p_exists then
    update public.haccp_records
      set records = p_records, updated_at = now()
      where user_id = p_user_id and date = p_date
        and records is not distinct from p_expected;
  else
    insert into public.haccp_records (user_id, date, records)
      values (p_user_id, p_date, p_records)
      on conflict (user_id, date) do nothing;
  end if;
  return found;
end;
$$;

revoke all on function public.haccp_compare_and_save_day(uuid, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.haccp_compare_and_save_day(uuid, text, boolean, jsonb, jsonb) to authenticated;
