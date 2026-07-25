-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

CREATE TABLE IF NOT EXISTS public.client_intake_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT        UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  owner_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         TEXT,
  expires_at    TIMESTAMPTZ,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_intake_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY chef_own ON public.client_intake_tokens
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_intake_config(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok  client_intake_tokens%ROWTYPE;
  v_prof profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_tok FROM public.client_intake_tokens WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false, 'reason', 'not_found');
  END IF;

  IF v_tok.expires_at IS NOT NULL AND v_tok.expires_at < NOW() THEN
    RETURN jsonb_build_object('is_valid', false, 'reason', 'expired');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('is_valid', false, 'reason', 'already_used');
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_tok.owner_user_id;

  RETURN jsonb_build_object(
    'is_valid',       true,
    'chef_name',      COALESCE(v_prof.chef_name,      ''),
    'business_name',  COALESCE(v_prof.business_name,  ''),
    'logo',           COALESCE(v_prof.logo,            ''),
    'label',          COALESCE(v_tok.label,            '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_intake_config(TEXT) TO anon;

CREATE OR REPLACE FUNCTION public.submit_intake_form(p_token TEXT, p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok       client_intake_tokens%ROWTYPE;
  v_client_id UUID;
BEGIN
  SELECT * INTO v_tok
  FROM public.client_intake_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF v_tok.expires_at IS NOT NULL AND v_tok.expires_at < NOW() THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  INSERT INTO public.clients (
    user_id, name, email, phone, address,
    notes, preferences, source, created_at, updated_at
  ) VALUES (
    v_tok.owner_user_id,
    p_data->>'name',
    p_data->>'email',
    p_data->>'phone',
    p_data->>'address',
    p_data->>'dietary',
    p_data->>'preferences',
    'intake',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_client_id;

  UPDATE public.client_intake_tokens
  SET used_at = NOW()
  WHERE token = p_token;

  RETURN jsonb_build_object('success', true, 'client_id', v_client_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_intake_form(TEXT, JSONB) TO anon;
