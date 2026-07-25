-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

-- Add prep_tasks to dishes: array of {id, description, section}
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS prep_tasks jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Add menu reference and date to prep_lists
ALTER TABLE prep_lists
  ADD COLUMN IF NOT EXISTS menu_id text REFERENCES menus(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date date;

-- Index for fetching prep lists by date
CREATE INDEX IF NOT EXISTS prep_lists_date_idx ON prep_lists (venue_id, date);
