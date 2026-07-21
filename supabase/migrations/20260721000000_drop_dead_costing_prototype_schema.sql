-- Drops the parked veriqo-job-costing prototype schema, deployed to prod on
-- 2026-05-28 (create_costing_schema, costing_rpc_wrappers_v2) but never wired
-- into the live app. Confirmed dead: sync.js/costing.js only touch
-- public.costings (the JSONB per-job costing store actually in use).
--
-- Removed because it was a live IDOR: costing.jobs/ingredient_history/
-- normalised_ingredient_mappings had RLS disabled, and all seven
-- public.costing_* wrapper RPCs were SECURITY DEFINER, executable by anon,
-- and trusted a caller-supplied p_user_id with no session check
-- (costing_update_scan didn't even filter by user). Anyone could read or
-- write any user's job-costing data via PostgREST.

DROP FUNCTION IF EXISTS public.costing_get_ingredient_prices(text, text[]);
DROP FUNCTION IF EXISTS public.costing_get_job(text, text);
DROP FUNCTION IF EXISTS public.costing_insert_job(text, text, text, integer, text, boolean, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.costing_list_jobs(text, integer, integer);
DROP FUNCTION IF EXISTS public.costing_reconcile_job(text, text, text, text, jsonb, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.costing_set_quoted_price(text, text, integer, timestamptz);
DROP FUNCTION IF EXISTS public.costing_update_scan(text, text, text, jsonb, timestamptz);

DROP SCHEMA IF EXISTS costing CASCADE;
