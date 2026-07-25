-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

CREATE OR REPLACE FUNCTION get_job_for_freelancer(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row        RECORD;
  v_job        RECORD;
  v_client     RECORD;
  v_client_name TEXT;
BEGIN
  SELECT * INTO v_row FROM freelancer_access
  WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_job FROM jobs WHERE id = v_row.job_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_client_name := v_job.metadata->>'client_name';
  IF v_client_name IS NOT NULL AND v_client_name <> '' THEN
    SELECT * INTO v_client FROM clients
    WHERE user_id = v_row.owner_user_id AND name = v_client_name
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'job',      row_to_json(v_job)::jsonb,
    'can_edit', v_row.can_edit,
    'client',   CASE WHEN v_client.id IS NOT NULL THEN row_to_json(v_client)::jsonb ELSE NULL END
  );
END;
$$;
