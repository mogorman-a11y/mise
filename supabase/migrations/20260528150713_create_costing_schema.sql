-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

CREATE SCHEMA IF NOT EXISTS costing;

CREATE TABLE IF NOT EXISTS costing.jobs (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT         NOT NULL,
  dish_name             TEXT         NOT NULL,
  serves                INTEGER      NOT NULL CHECK (serves > 0),
  service_style         TEXT         NOT NULL,
  reconciliation_status TEXT         NOT NULL,
  reconciliation_method TEXT,
  vat_registered        BOOLEAN      NOT NULL,
  quoted_price_pence    INTEGER,
  post_job_actuals      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  financials            JSONB,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id
  ON costing.jobs (user_id);

CREATE TABLE IF NOT EXISTS costing.ingredient_history (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    TEXT        NOT NULL,
  ingredient_name_normalised TEXT        NOT NULL,
  ingredient_name_raw        TEXT        NOT NULL,
  unit_cost_pence_per_100g   INTEGER     NOT NULL CHECK (unit_cost_pence_per_100g >= 0),
  vat_rate                   SMALLINT    NOT NULL CHECK (vat_rate IN (0, 20)),
  source                     TEXT        NOT NULL,
  job_id                     TEXT        NOT NULL,
  recorded_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_ingredient_history
    UNIQUE (user_id, ingredient_name_normalised, job_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_history_lookup
  ON costing.ingredient_history (user_id, ingredient_name_normalised, recorded_at DESC);

CREATE TABLE IF NOT EXISTS costing.normalised_ingredient_mappings (
  raw_name        TEXT        PRIMARY KEY,
  normalised_name TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
