-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

-- Table
CREATE TABLE IF NOT EXISTS freelancer_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id),
  can_edit      BOOLEAN NOT NULL DEFAULT false,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE freelancer_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chef_own" ON freelancer_access FOR ALL USING (owner_user_id = auth.uid());

-- RPC 1: read job by token
CREATE OR REPLACE FUNCTION get_job_for_freelancer(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row RECORD;
  v_job RECORD;
BEGIN
  SELECT * INTO v_row FROM freelancer_access
  WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_job FROM jobs WHERE id = v_row.job_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'job',      row_to_json(v_job)::jsonb,
    'can_edit', v_row.can_edit
  );
END;
$$;

-- RPC 2: append a HACCP record to the chef's haccp_records
CREATE OR REPLACE FUNCTION log_freelancer_haccp(
  p_token  TEXT,
  p_date   TEXT,
  p_record JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_owner UUID;
BEGIN
  SELECT owner_user_id INTO v_owner
  FROM freelancer_access WHERE token = p_token AND expires_at > now();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  INSERT INTO haccp_records (user_id, date, records)
  VALUES (v_owner, p_date, jsonb_build_array(p_record))
  ON CONFLICT (user_id, date)
  DO UPDATE SET records = haccp_records.records || jsonb_build_array(p_record);
END;
$$;

-- RPC 3: update job covers/notes (only when can_edit = true)
CREATE OR REPLACE FUNCTION update_job_for_freelancer(
  p_token  TEXT,
  p_covers TEXT,
  p_notes  TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_job_id TEXT; v_owner UUID; v_can_edit BOOLEAN;
BEGIN
  SELECT job_id, owner_user_id, can_edit INTO v_job_id, v_owner, v_can_edit
  FROM freelancer_access WHERE token = p_token AND expires_at > now();
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF NOT v_can_edit THEN RAISE EXCEPTION 'edit_not_permitted'; END IF;

  UPDATE jobs
  SET headcount  = CASE WHEN p_covers IS NOT NULL AND p_covers <> ''
                        THEN p_covers::INTEGER ELSE headcount END,
      notes      = COALESCE(NULLIF(p_notes, ''), notes),
      updated_at = now()
  WHERE id = v_job_id AND user_id = v_owner;
END;
$$;
