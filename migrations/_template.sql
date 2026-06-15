-- Migration: YYYY-MM-DD-description.sql
-- Run in Supabase SQL Editor against project yixrwyfodipfcbhjcszp.
--
-- ⚠️  GRANT REMINDER (Supabase change effective 2026-10-30)
-- After October 30 2026, new tables in existing projects require explicit
-- GRANT statements to be accessible via PostgREST / GraphQL / supabase-js.
-- Copy the GRANT block at the bottom of this file for every new table.
-- RLS policies control what each role can read/write; the GRANT just opens the door.

-- ------------------------------------------------------------
-- 1. Schema changes
-- ------------------------------------------------------------

create table if not exists public.example_table (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- ... your columns ...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists example_table_user_id_idx on public.example_table(user_id);

-- ------------------------------------------------------------
-- 2. Row Level Security
-- ------------------------------------------------------------

alter table public.example_table enable row level security;

create policy "example_table_owner_all" on public.example_table
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. Data API access — REQUIRED for every new table
-- ------------------------------------------------------------

grant select, insert, update, delete on table public.example_table to anon, authenticated;

-- If the table should only be accessible to signed-in users (most cases):
--   grant select, insert, update, delete on table public.example_table to authenticated;
--
-- If anon access is needed (e.g. public-facing lookup via token):
--   grant select on table public.example_table to anon;
--   grant select, insert, update, delete on table public.example_table to authenticated;
