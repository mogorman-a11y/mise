-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

DO $$
DECLARE
  rec          RECORD;
  v_venue_id   UUID;
  v_kitchen_id UUID;
BEGIN
  -- Loop every profile that has no venue yet.
  -- Each existing solo user becomes the owner of their own venue.
  FOR rec IN
    SELECT
      p.id            AS profile_id,
      p.kitchen_id    AS existing_kitchen_id,
      p.subscription_status,
      COALESCE(NULLIF(TRIM(p.business_name), ''), split_part(u.email, '@', 1)) AS venue_name
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.venue_id IS NULL
    ORDER BY u.created_at
  LOOP
    -- 1. Create a venue for this user
    v_venue_id := gen_random_uuid();
    INSERT INTO public.venues (id, name, subscription_status)
    VALUES (
      v_venue_id,
      rec.venue_name,
      CASE WHEN rec.subscription_status = 'active' THEN 'active' ELSE 'trialing' END
    );

    -- 2. Kitchen handling
    IF rec.existing_kitchen_id IS NOT NULL THEN
      -- User already has a kitchen — just link it to their new venue
      v_kitchen_id := rec.existing_kitchen_id;
      UPDATE public.kitchens
        SET venue_id = v_venue_id
      WHERE id = v_kitchen_id;
    ELSE
      -- User has no kitchen — create one
      v_kitchen_id := gen_random_uuid();
      INSERT INTO public.kitchens (id, name, owner_user_id, venue_id)
      VALUES (v_kitchen_id, rec.venue_name, rec.profile_id, v_venue_id);

      -- Write the new kitchen back onto their profile
      UPDATE public.profiles
        SET kitchen_id = v_kitchen_id
      WHERE id = rec.profile_id;
    END IF;

    -- 3. Backfill kitchen_id on existing haccp_records that belong to this user
    --    but have no kitchen set (records saved before the unification migration)
    UPDATE public.haccp_records
      SET kitchen_id = v_kitchen_id
    WHERE user_id = rec.profile_id
      AND kitchen_id IS NULL;

    -- 4. Backfill kitchen_id on existing menus the same way
    UPDATE public.menus
      SET kitchen_id = v_kitchen_id
    WHERE user_id = rec.profile_id
      AND kitchen_id IS NULL;

    -- 5. Backfill created_by where missing (self-authored records)
    UPDATE public.haccp_records
      SET created_by = rec.profile_id
    WHERE user_id = rec.profile_id
      AND created_by IS NULL;

    UPDATE public.menus
      SET created_by = rec.profile_id
    WHERE user_id = rec.profile_id
      AND created_by IS NULL;

    -- 6. Stamp the profile: venue_id + promote to owner
    UPDATE public.profiles
      SET venue_id = v_venue_id,
          role     = 'owner'
    WHERE id = rec.profile_id;

  END LOOP;
END;
$$;
