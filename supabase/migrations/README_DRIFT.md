# Local migration folder drift

As of 2026-07-15, `supabase list_migrations` shows **19 migrations applied**
to the live project (`yixrwyfodipfcbhjcszp`), but this folder only tracks
**8**: the 3 that predate this note plus the 5 added alongside it
(`20260715184201` through `20260715211734`, from PR #3).

The 11 migrations between `20260515161154` and `20260618163706` (freelancer
access, client intake form, the initial Carte→Veriqo unification, the
costing schema + RPC wrappers, `add_profiles_status`, `enable_pg_net_extension`,
`create_email_events_table`, `add_prep_tasks_to_dishes_and_menu_to_prep_lists`)
were applied to prod before this repo's local `supabase/migrations/` folder
was being kept in sync, and their SQL was never captured locally. Running
`supabase db pull` or `supabase db dump` to properly reconcile requires
Docker (bundles the CLI's own `pg_dump`), which wasn't available in the
session that wrote this note.

**To fully reconcile:** on a machine with Docker running, `supabase link`
to the project and run `supabase db pull` — it will detect the local/remote
mismatch and offer to write the missing migration files. Do **not** run the
"repair" commands the CLI suggests without Docker access (`supabase migration
repair --status reverted ...` for the 19 real migrations, `--status applied`
for the 3 stale local-only ones) — that marks real, already-applied
migrations as reverted in the tracking table, which is backwards and does
not actually revert anything in the live database.

Until reconciled, treat `supabase list_migrations` (or `pg_proc`/`pg_policies`
queried directly) as the source of truth for live schema state, not this
folder.
