# Local migration folder drift

**Reconciled 2026-07-25.** `supabase migration list --linked` now shows local
and remote in full agreement except for two intentional local-only entries
(see below). Reconciliation was done read-only, via `supabase db query
--linked` against `supabase_migrations.schema_migrations` — no Docker
required, nothing written to prod.

## What was fixed

- **13 migrations that were applied to prod but never captured locally**
  (freelancer access, client intake form, Carte→Veriqo unification phase 7,
  the original costing schema + RPC wrappers, `add_profiles_status`,
  `backfill_venues_roles_kitchen_ids`, `enable_pg_net_extension`,
  `create_email_events_table`, `add_prep_tasks_to_dishes_and_menu_to_prep_lists`,
  and `menu_import_upsert_rpc_v3_validated`) were recovered verbatim from
  `schema_migrations.statements` and added as new files under their real
  remote version numbers.
- **4 migrations that were applied correctly but tracked under
  hand-picked round-number filenames** locally
  (`20260721000000`/`20260721010000`/`20260721020000`/`20260722000000` —
  the IDOR-fix drop, the costing-rebuild phases, and the quotes portal
  token) were renamed to their real remote version numbers
  (`20260721174813`, `20260721175203`, `20260721183332`, `20260722183249`)
  after byte-for-byte content verification. No SQL content changed.

## Two intentional local-only entries (not drift)

`20260605000000_multi_tenant.sql` and
`20260605000001_multi_user_venue_sharing_v2.sql` are hand-authored,
heavily-commented versions of what actually ran on prod as `multi_tenant`
(remote version `20260605165655`) and `multi_user_venue_sharing_v2`
(remote version `20260606065912`). Verified 2026-07-25: after stripping
comments/whitespace/transaction wrappers, both are **character-for-character
identical** to the applied SQL. Left as-is (not renamed) since they predate
this reconciliation and are already the documented, referenced source in
CLAUDE.md — renaming them is a safe future cleanup if full 1:1 tracking is
ever wanted, not a correctness issue.

`pulled_schema_audit.sql` (a 2026-06-15 reference snapshot, explicitly
non-runnable) was moved to `supabase/docs/` — it never belonged in a folder
`supabase db reset` replays.

## Going forward

Keep applying schema changes as migration files + `supabase db push` (or
equivalent CLI flow) rather than the dashboard SQL editor directly — that's
what caused both classes of drift above. If a dashboard/SQL-editor change to
prod is ever unavoidable, capture it as a local migration file **immediately**
using its real applied timestamp (check `supabase migration list --linked`),
not a synthetic one.
