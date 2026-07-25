-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

CREATE TABLE IF NOT EXISTS public.email_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_email_id text NOT NULL,          -- Resend's email ID (e.g. re_abc123)
  profile_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email         text,                     -- recipient address
  event_type    text NOT NULL,            -- email.opened, email.clicked, email.bounced, etc.
  click_url     text,                     -- populated for email.clicked events
  days_left     int,                      -- 1 or 3 — which reminder triggered this
  raw           jsonb NOT NULL DEFAULT '{}', -- full Resend webhook payload
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_events_profile_id_idx   ON public.email_events (profile_id);
CREATE INDEX email_events_resend_email_id  ON public.email_events (resend_email_id);
CREATE INDEX email_events_event_type_idx   ON public.email_events (event_type);
CREATE INDEX email_events_created_at_idx   ON public.email_events (created_at DESC);

-- No RLS needed — only the service role writes to this table via the webhook function
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
