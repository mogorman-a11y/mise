-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

-- ── Phase 7: Veriqo Unification schema changes ────────────────

-- 1. kitchens table (multi-user prep — UI is v2)
CREATE TABLE IF NOT EXISTS kitchens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_user_id UUID REFERENCES auth.users,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. kitchen_members table
CREATE TABLE IF NOT EXISTS kitchen_members (
  kitchen_id UUID NOT NULL REFERENCES kitchens(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner', -- owner | manager | staff
  joined_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (kitchen_id, user_id)
);

-- 3. profiles: add kitchen_id FK + new plan/preference columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS kitchen_id     UUID REFERENCES kitchens(id),
  ADD COLUMN IF NOT EXISTS starter_module TEXT,   -- 'haccp' | 'menus' | 'costing' (deferred Starter tier)
  ADD COLUMN IF NOT EXISTS default_module TEXT;   -- user's preferred landing module

-- 4. Add kitchen_id FK (nullable) to all data tables
ALTER TABLE clients      ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE dishes       ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE menus        ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE menu_dishes  ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE jobs         ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE haccp_records ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE mise_records  ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE quotes       ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE costings     ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE invoices     ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);
ALTER TABLE payments     ADD COLUMN IF NOT EXISTS kitchen_id UUID REFERENCES kitchens(id);

-- 5. RLS on new tables (user-based, matching existing pattern)
ALTER TABLE kitchens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own kitchen"
  ON kitchens FOR ALL
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Members can view their kitchen"
  ON kitchens FOR SELECT
  USING (
    id IN (
      SELECT kitchen_id FROM kitchen_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their own membership"
  ON kitchen_members FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
