-- =============================================================================
-- Migration: multi_tenant  (revised — hierarchical structure)
-- Created:   2026-06-05
-- =============================================================================
--
-- HIERARCHY
-- ─────────────────────────────────────────────────────────────────────────────
--   venues          ← billing & company umbrella (Stripe lives here)
--     └── kitchens  ← operational units (existing table, gains venue_id FK)
--           ├── haccp_records   (already has kitchen_id, gains created_by)
--           ├── menus           (already has kitchen_id, gains created_by)
--           └── prep_lists      (new table, kitchen_id + created_by from day 1)
--   profiles        ← gains venue_id + role (venue-wide role, not kitchen-level)
--
-- SCHEMA AUDIT NOTES (recorded 2026-06-05)
-- ─────────────────────────────────────────────────────────────────────────────
--  1. 'haccp_logs' (spec name) does not exist — actual table is 'haccp_records'.
--     Targeted throughout.
--  2. 'prep_lists' does not exist — created in §3.
--  3. 'created_by' absent on haccp_records, menus, prep_lists — added in §3/§4.
--  4. kitchens has no indexes beyond its PK — venue_id index added in §5.
--  5. haccp_records has a UNIQUE constraint on (user_id, date) — preserved.
--     The UPDATE policy is compatible: it restricts by user_id + today's date.
--  6. Existing kitchens policies (owner_user_id + kitchen_members) are preserved
--     and a new venue-member SELECT policy is added alongside them.
--  7. 5 overlapping legacy policies on haccp_records are dropped and replaced.
--  8. menus_owner_all (ALL on own rows) is dropped; staff lose DELETE access —
--     DELETE becomes owner/admin only.
--  9. Existing profiles policies (uid = id only) dropped and replaced with
--     venue-aware equivalents. Null-JWT fallback keeps solo users accessible
--     until venue_id is backfilled (see POST-APPLY CHECKLIST §B).
--
-- POST-APPLY CHECKLIST
-- ─────────────────────────────────────────────────────────────────────────────
-- A. BIND THE HOOK — this is required before any venue-based policy works:
--    Supabase Dashboard → Authentication → Hooks → Custom Access Token Hook
--    Function: public.custom_access_token_hook
--
-- B. BACKFILL venue_id on kitchens rows, then uncomment NOT NULL statements:
--    UPDATE kitchens SET venue_id = '<venue_uuid>' WHERE venue_id IS NULL;
--    Then uncomment: ALTER TABLE public.kitchens ALTER COLUMN venue_id SET NOT NULL;
--
-- C. BACKFILL profiles.role for existing owners:
--    UPDATE profiles p SET role = 'owner'
--      FROM kitchens k WHERE k.owner_user_id = p.id;
--
-- D. BACKFILL created_by on existing haccp_records and menus rows:
--    UPDATE haccp_records SET created_by = user_id WHERE created_by IS NULL;
--    UPDATE menus         SET created_by = user_id WHERE created_by IS NULL;
--
-- E. After all backfills, remove the null-JWT fallback clauses marked
--    "-- remove after backfill" in the RLS policies below.
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CREATE public.venues
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.venues (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  stripe_customer_id  TEXT,
  stripe_price_id     TEXT,
  subscription_status TEXT        NOT NULL DEFAULT 'trialing',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- 2. UPDATE public.kitchens — add venue_id FK
-- =============================================================================

ALTER TABLE public.kitchens
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues (id);

-- Run after backfill (§B above):
-- ALTER TABLE public.kitchens ALTER COLUMN venue_id SET NOT NULL;


-- =============================================================================
-- 3. UPDATE public.profiles — add venue_id, role, invited_by
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS venue_id   UUID REFERENCES public.venues  (id),
  ADD COLUMN IF NOT EXISTS role       TEXT NOT NULL DEFAULT 'staff'
                                        CHECK (role IN ('owner', 'admin', 'staff')),
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles (id);


-- =============================================================================
-- 4. CREATE public.prep_lists  (did not previously exist)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.prep_lists (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kitchen_id  UUID        REFERENCES public.kitchens  (id),
  user_id     UUID        NOT NULL REFERENCES auth.users (id),
  created_by  UUID        REFERENCES auth.users (id),
  name        TEXT        NOT NULL,
  items       JSONB       NOT NULL DEFAULT '[]',
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Run after backfill:
-- ALTER TABLE public.prep_lists ALTER COLUMN kitchen_id SET NOT NULL;


-- =============================================================================
-- 5. ADD created_by to haccp_records and menus
--    (kitchen_id already exists on both — no change needed there)
-- =============================================================================

ALTER TABLE public.haccp_records
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users (id);

ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users (id);


-- =============================================================================
-- 6. INDEXES
-- =============================================================================

-- kitchens: index on venue_id so the RLS subquery is fast
CREATE INDEX IF NOT EXISTS idx_kitchens_venue_id       ON public.kitchens      (venue_id);

-- profiles: index on venue_id for team-listing queries
CREATE INDEX IF NOT EXISTS idx_profiles_venue_id       ON public.profiles      (venue_id);

-- prep_lists: covering indexes for the two most common access patterns
CREATE INDEX IF NOT EXISTS idx_prep_lists_kitchen_id   ON public.prep_lists    (kitchen_id);
CREATE INDEX IF NOT EXISTS idx_prep_lists_user_id      ON public.prep_lists    (user_id);

-- venues: index on subscription_status for billing queries / cron checks
CREATE INDEX IF NOT EXISTS idx_venues_sub_status       ON public.venues        (subscription_status);


-- =============================================================================
-- 7. custom_access_token_hook
--
-- Embeds venue_id and user_role as top-level JWT claims so RLS policies can
-- read them cheaply with auth.jwt() ->> 'venue_id' and ->> 'user_role'
-- without a per-row database call.
--
-- !! ACTION REQUIRED — SEE POST-APPLY CHECKLIST §A !!
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id  UUID;
  v_role      TEXT;
  claims      JSONB;
BEGIN
  SELECT venue_id, role
    INTO v_venue_id, v_role
    FROM public.profiles
   WHERE id = (event ->> 'user_id')::UUID;

  claims := event -> 'claims';

  -- Embed as top-level claims. NULL venue_id is written as JSON null so the
  -- IS NULL check in RLS fallback clauses evaluates correctly.
  claims := jsonb_set(claims, '{venue_id}',
              CASE WHEN v_venue_id IS NULL THEN 'null'::jsonb
                   ELSE to_jsonb(v_venue_id::TEXT) END,
              true);
  claims := jsonb_set(claims, '{user_role}',
              to_jsonb(COALESCE(v_role, 'staff')),
              true);

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Restrict to supabase_auth_admin only
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;


-- =============================================================================
-- 8. RLS — enable on new tables
--    (profiles, haccp_records, menus, kitchens already have RLS enabled)
-- =============================================================================

ALTER TABLE public.venues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_lists ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 9. DROP policies being replaced
-- =============================================================================

-- haccp_records — 5 overlapping legacy policies
DROP POLICY IF EXISTS "Users can insert own records"       ON public.haccp_records;
DROP POLICY IF EXISTS "Users can manage their own records" ON public.haccp_records;
DROP POLICY IF EXISTS "Users can read own records"         ON public.haccp_records;
DROP POLICY IF EXISTS "Users can update own records"       ON public.haccp_records;
DROP POLICY IF EXISTS "Users manage own haccp records"     ON public.haccp_records;

-- menus — ALL catch-all
DROP POLICY IF EXISTS "menus_owner_all"                    ON public.menus;

-- profiles — single-user policies
DROP POLICY IF EXISTS "Users can insert own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"         ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"       ON public.profiles;


-- =============================================================================
-- 10. RLS POLICIES
--
-- Access pattern for transactional tables (haccp_records, menus, prep_lists):
--   A user may access a row if its kitchen_id belongs to a kitchen whose
--   venue_id matches the venue_id embedded in the user's JWT.
--
-- Subquery used in USING/WITH CHECK:
--   kitchen_id IN (
--     SELECT id FROM public.kitchens
--     WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
--   )
--   This subquery uses idx_kitchens_venue_id and is evaluated once per query.
--
-- Fallback clause for pre-backfill / solo users:
--   OR ((auth.jwt() ->> 'venue_id') IS NULL AND user_id = auth.uid())
--   Remove this clause (§E) after kitchens.venue_id is fully backfilled.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 10a. VENUES
-- ─────────────────────────────────────────────────────────────────────────────

-- Any authenticated user may create a venue (owner does this on signup).
CREATE POLICY "venues_insert"
  ON public.venues
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Members may only see the venue their JWT claims they belong to.
CREATE POLICY "venues_select"
  ON public.venues
  FOR SELECT
  TO authenticated
  USING (id = (auth.jwt() ->> 'venue_id')::UUID);

-- Only owner or admin may update venue details (name, Stripe fields, etc.).
CREATE POLICY "venues_update"
  ON public.venues
  FOR UPDATE
  TO authenticated
  USING (
    id = (auth.jwt() ->> 'venue_id')::UUID
    AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
  )
  WITH CHECK (
    id = (auth.jwt() ->> 'venue_id')::UUID
    AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
  );

-- No DELETE on venues.


-- ─────────────────────────────────────────────────────────────────────────────
-- 10b. KITCHENS
-- Existing policies (owner_user_id ALL, kitchen_members SELECT) are kept.
-- New policy: any venue member can see all kitchens that belong to their venue.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "kitchens_venue_members_select"
  ON public.kitchens
  FOR SELECT
  TO authenticated
  USING (venue_id = (auth.jwt() ->> 'venue_id')::UUID);

-- Owner/admin may update any kitchen in their venue.
CREATE POLICY "kitchens_venue_update"
  ON public.kitchens
  FOR UPDATE
  TO authenticated
  USING (
    venue_id = (auth.jwt() ->> 'venue_id')::UUID
    AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
  )
  WITH CHECK (
    venue_id = (auth.jwt() ->> 'venue_id')::UUID
    AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 10c. PROFILES
-- ─────────────────────────────────────────────────────────────────────────────

-- Users may only INSERT their own profile row.
CREATE POLICY "profiles_insert"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Users see all profiles in their venue.
-- Fallback: solo users (no venue_id in JWT) see only their own row.
CREATE POLICY "profiles_select"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    venue_id = (auth.jwt() ->> 'venue_id')::UUID
    OR ((auth.jwt() ->> 'venue_id') IS NULL AND id = auth.uid())  -- remove after backfill
  );

-- Users may always edit their own profile.
-- Owners and admins may also edit any profile within their venue.
CREATE POLICY "profiles_update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      venue_id = (auth.jwt() ->> 'venue_id')::UUID
      AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR (
      venue_id = (auth.jwt() ->> 'venue_id')::UUID
      AND (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 10d. HACCP_RECORDS  (spec: haccp_logs)
--
-- No DELETE on any role — compliance / audit trail requirement.
-- UPDATE: any role may correct their own record on the current calendar day only.
--         haccp_records.date is stored as TEXT 'YYYY-MM-DD'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "haccp_records_select"
  ON public.haccp_records
  FOR SELECT
  TO authenticated
  USING (
    kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
    OR ((auth.jwt() ->> 'venue_id') IS NULL AND user_id = auth.uid())  -- remove after backfill
  );

-- INSERT: must be writing to a kitchen inside the user's venue, as themselves.
CREATE POLICY "haccp_records_insert"
  ON public.haccp_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
  );

-- UPDATE: own record, today only (any role — staff correct their own mistakes).
-- No venue check needed here: if you own the row you wrote it, and write
-- access already verified venue membership at INSERT time.
CREATE POLICY "haccp_records_update"
  ON public.haccp_records
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND date = TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  )
  WITH CHECK (
    user_id = auth.uid()
    AND date = TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  );

-- No DELETE policy — intentional for food safety compliance.


-- ─────────────────────────────────────────────────────────────────────────────
-- 10e. MENUS
--
-- UPDATE: owner/admin — any menu in the venue, any time.
--         staff       — only menus they created, on the day of creation.
-- DELETE: owner/admin only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "menus_select"
  ON public.menus
  FOR SELECT
  TO authenticated
  USING (
    kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
    OR ((auth.jwt() ->> 'venue_id') IS NULL AND user_id = auth.uid())  -- remove after backfill
  );

CREATE POLICY "menus_insert"
  ON public.menus
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
  );

CREATE POLICY "menus_update"
  ON public.menus
  FOR UPDATE
  TO authenticated
  USING (
    -- Owner or admin: any menu in the venue, any time
    (
      (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
    OR
    -- Staff: only their own menus, on the day they were created
    (
      user_id   = auth.uid()
      AND created_at::DATE = CURRENT_DATE
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
  )
  WITH CHECK (
    (
      (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
    OR
    (
      user_id   = auth.uid()
      AND created_at::DATE = CURRENT_DATE
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
  );

CREATE POLICY "menus_delete"
  ON public.menus
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
    AND kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 10f. PREP_LISTS  (same role-split pattern as menus)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "prep_lists_select"
  ON public.prep_lists
  FOR SELECT
  TO authenticated
  USING (
    kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
  );

CREATE POLICY "prep_lists_insert"
  ON public.prep_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
  );

CREATE POLICY "prep_lists_update"
  ON public.prep_lists
  FOR UPDATE
  TO authenticated
  USING (
    (
      (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
    OR
    (
      user_id   = auth.uid()
      AND created_at::DATE = CURRENT_DATE
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
  )
  WITH CHECK (
    (
      (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
    OR
    (
      user_id   = auth.uid()
      AND created_at::DATE = CURRENT_DATE
      AND kitchen_id IN (
        SELECT id FROM public.kitchens
        WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
      )
    )
  );

CREATE POLICY "prep_lists_delete"
  ON public.prep_lists
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() ->> 'user_role') IN ('owner', 'admin')
    AND kitchen_id IN (
      SELECT id FROM public.kitchens
      WHERE venue_id = (auth.jwt() ->> 'venue_id')::UUID
    )
  );


COMMIT;
