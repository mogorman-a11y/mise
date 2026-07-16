-- bootstrap_new_account and menu_import_upsert both inherited EXECUTE for
-- `anon` via Supabase's schema-level default privileges (REVOKE ALL FROM
-- PUBLIC in their own migrations doesn't undo a role-specific default
-- grant). Both functions fail safely for unauthenticated callers regardless
-- (auth.uid() IS NULL is checked first), so this was not exploitable, but
-- it violated minimal-grants. Found during the security review pass for
-- this PR — see PR #3 discussion.
revoke execute on function public.bootstrap_new_account(text, text) from anon;
revoke execute on function public.menu_import_upsert(jsonb, jsonb, text[]) from anon;
