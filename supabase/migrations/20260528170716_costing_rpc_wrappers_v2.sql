-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

CREATE OR REPLACE FUNCTION public.costing_get_ingredient_prices(
  p_user_id text,
  p_names    text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, costing
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('name', src.raw_name, 'wprice', src.weighted))
  INTO result
  FROM (
    SELECT
      n.raw_name,
      ROUND(
        SUM(
          h.unit_cost_pence_per_100g *
          CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - h.recorded_at)) / 86400 <= 30  THEN 1.0
            WHEN EXTRACT(EPOCH FROM (NOW() - h.recorded_at)) / 86400 <= 60  THEN 0.6
            ELSE 0.3
          END
        ) / NULLIF(SUM(
          CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - h.recorded_at)) / 86400 <= 30  THEN 1.0
            WHEN EXTRACT(EPOCH FROM (NOW() - h.recorded_at)) / 86400 <= 60  THEN 0.6
            ELSE 0.3
          END
        ), 0)
      ) AS weighted
    FROM unnest(p_names) AS n(raw_name)
    LEFT JOIN costing.normalised_ingredient_mappings m
           ON m.raw_name = lower(trim(n.raw_name))
    LEFT JOIN costing.ingredient_history h
           ON h.ingredient_name_normalised = COALESCE(m.normalised_name, lower(trim(n.raw_name)))
          AND h.user_id = p_user_id
          AND h.recorded_at >= NOW() - INTERVAL '90 days'
    GROUP BY n.raw_name
  ) src;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.costing_insert_job(
  p_id              text,
  p_user_id         text,
  p_dish_name       text,
  p_serves          int,
  p_service_style   text,
  p_vat_registered  boolean,
  p_post_job_actuals jsonb,
  p_ts              timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, costing
AS $$
  INSERT INTO costing.jobs (
    id, user_id, dish_name, serves, service_style,
    reconciliation_status, reconciliation_method, vat_registered,
    quoted_price_pence, post_job_actuals, financials, created_at, updated_at
  )
  VALUES (
    p_id::uuid, p_user_id, p_dish_name, p_serves, p_service_style,
    'estimated', NULL, p_vat_registered,
    NULL, p_post_job_actuals, NULL, p_ts, p_ts
  )
  RETURNING to_jsonb(costing.jobs.*);
$$;

CREATE OR REPLACE FUNCTION public.costing_get_job(
  p_id      text,
  p_user_id text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, costing
AS $$
  SELECT to_jsonb(j)
  FROM costing.jobs j
  WHERE j.id = p_id::uuid AND j.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.costing_list_jobs(
  p_user_id text,
  p_limit   int  DEFAULT 20,
  p_offset  int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, costing
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM costing.jobs
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) j;
$$;

CREATE OR REPLACE FUNCTION public.costing_set_quoted_price(
  p_id                 text,
  p_user_id            text,
  p_quoted_price_pence int,
  p_updated_at         timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, costing
AS $$
  UPDATE costing.jobs
  SET quoted_price_pence = p_quoted_price_pence,
      updated_at         = p_updated_at
  WHERE id = p_id::uuid AND user_id = p_user_id
  RETURNING to_jsonb(costing.jobs.*);
$$;

CREATE OR REPLACE FUNCTION public.costing_reconcile_job(
  p_id         text,
  p_user_id    text,
  p_status     text,
  p_method     text,
  p_actuals    jsonb,
  p_financials jsonb,
  p_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, costing
AS $$
  UPDATE costing.jobs
  SET reconciliation_status = p_status,
      reconciliation_method = p_method,
      post_job_actuals      = p_actuals,
      financials            = p_financials,
      updated_at            = p_updated_at
  WHERE id = p_id::uuid AND user_id = p_user_id
  RETURNING to_jsonb(costing.jobs.*);
$$;

CREATE OR REPLACE FUNCTION public.costing_update_scan(
  p_id         text,
  p_status     text,
  p_method     text,
  p_actuals    jsonb,
  p_updated_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, costing
AS $$
  UPDATE costing.jobs
  SET reconciliation_status = p_status,
      reconciliation_method = p_method,
      post_job_actuals      = p_actuals,
      updated_at            = p_updated_at
  WHERE id = p_id::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.costing_get_ingredient_prices(text, text[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.costing_insert_job(text, text, text, int, text, boolean, jsonb, timestamptz) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.costing_get_job(text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.costing_list_jobs(text, int, int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.costing_set_quoted_price(text, text, int, timestamptz) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.costing_reconcile_job(text, text, text, text, jsonb, jsonb, timestamptz) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.costing_update_scan(text, text, text, jsonb, timestamptz) TO authenticated, anon;
