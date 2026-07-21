-- Costing rebuild Phase 4: actual-cost reconciliation (manual/quick-total only).
-- One row per job: the Phase 3 estimated total at the time of reconciling vs
-- what the chef actually spent, plus the variance. Additive — FKs to jobs(id),
-- doesn't touch dishes/menus/jobs/recipe_ingredients/ingredient_prices.
--
-- Scope note: this is the "quick total" reconciliation path only (mirrors
-- veriqo-job-costing's quickReconcile()), not itemized per-ingredient
-- reconciliation — that would need a receipt-scan or per-ingredient entry UI
-- to be worth the complexity, deferred. `method` is still a text column
-- (not an enum) so an 'itemized' value can be added later without a migration.

CREATE TABLE public.job_cost_reconciliations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                  text        NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  venue_id                uuid        NOT NULL DEFAULT public.auth_venue_id(),
  method                  text        NOT NULL DEFAULT 'quick_total',
  estimated_total_pence   integer     NOT NULL,
  actual_total_pence      integer     NOT NULL CHECK (actual_total_pence >= 0),
  variance_pence          integer     NOT NULL,
  variance_percentage     integer     NOT NULL,
  notes                   text,
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_cost_reconciliations_venue_id_idx ON public.job_cost_reconciliations (venue_id);

ALTER TABLE public.job_cost_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_rw ON public.job_cost_reconciliations FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
