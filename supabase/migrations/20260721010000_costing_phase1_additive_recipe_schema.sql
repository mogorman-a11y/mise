-- Costing rebuild Phase 1: additive ingredient/recipe schema.
-- Adds dishes -> dish_recipes -> recipe_ingredients -> ingredients -> ingredient_prices,
-- keyed by dish_id. Does not touch dishes/menus/menu_dishes/jobs or any existing
-- column — a dish with no dish_recipes row keeps working exactly as today.
-- See Obsidian Architecture Decisions.md: "Recipe costing is additive to dishes,
-- not a rewrite of them...".
--
-- Ingredient identity: one stable ingredients row per real-world ingredient.
-- Raw supplier/receipt text is a confirmed alias pointed at that row, never the
-- identity itself (ingredient_supplier_aliases.confirmed_by_chef) -- AI may
-- propose a match, the chef confirms it.
--
-- Money is integer pence throughout (ingredient_prices.pack_price_pence), per
-- the ADR's Phase 2 success test: cost one real dish once, scale correctly
-- from 4 to 20 portions.

CREATE TABLE public.ingredients (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid        NOT NULL DEFAULT public.auth_venue_id(),
  user_id       uuid        NOT NULL,
  name          text        NOT NULL,
  default_unit  text        NOT NULL DEFAULT 'g',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ingredients_venue_name_lower_idx ON public.ingredients (venue_id, lower(name));
CREATE INDEX ingredients_venue_id_idx ON public.ingredients (venue_id);

CREATE TABLE public.ingredient_supplier_aliases (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id      uuid        NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  venue_id           uuid        NOT NULL DEFAULT public.auth_venue_id(),
  raw_text           text        NOT NULL,
  confirmed_by_chef  boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ingredient_aliases_venue_raw_idx ON public.ingredient_supplier_aliases (venue_id, raw_text);
CREATE INDEX ingredient_aliases_ingredient_id_idx ON public.ingredient_supplier_aliases (ingredient_id);

CREATE TABLE public.ingredient_prices (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id      uuid        NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  venue_id           uuid        NOT NULL DEFAULT public.auth_venue_id(),
  pack_price_pence   integer     NOT NULL CHECK (pack_price_pence >= 0),
  pack_size          numeric     NOT NULL CHECK (pack_size > 0),
  pack_unit          text        NOT NULL,
  source             text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_estimate', 'receipt_scan')),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingredient_prices_ingredient_id_recorded_at_idx ON public.ingredient_prices (ingredient_id, recorded_at DESC);
CREATE INDEX ingredient_prices_venue_id_idx ON public.ingredient_prices (venue_id);

CREATE TABLE public.dish_recipes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id         text        NOT NULL UNIQUE REFERENCES public.dishes(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL DEFAULT public.auth_venue_id(),
  yield_portions  integer     NOT NULL DEFAULT 1 CHECK (yield_portions > 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dish_recipes_venue_id_idx ON public.dish_recipes (venue_id);

CREATE TABLE public.recipe_ingredients (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_recipe_id  uuid        NOT NULL REFERENCES public.dish_recipes(id) ON DELETE CASCADE,
  ingredient_id   uuid        NOT NULL REFERENCES public.ingredients(id),
  venue_id        uuid        NOT NULL DEFAULT public.auth_venue_id(),
  quantity        numeric     NOT NULL CHECK (quantity > 0),
  unit            text        NOT NULL,
  sort_order      integer     NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipe_ingredients_dish_recipe_id_idx ON public.recipe_ingredients (dish_recipe_id);
CREATE INDEX recipe_ingredients_ingredient_id_idx ON public.recipe_ingredients (ingredient_id);
CREATE INDEX recipe_ingredients_venue_id_idx ON public.recipe_ingredients (venue_id);

ALTER TABLE public.ingredients                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_supplier_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_prices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_recipes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients          ENABLE ROW LEVEL SECURITY;

-- Pattern: venue_rw — ALL commands, venue_id = auth_venue_id() (matches
-- dishes/menus/menu_dishes/etc. in 20260615000000_pulled_schema_audit.sql).
CREATE POLICY venue_rw ON public.ingredients FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.ingredient_supplier_aliases FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.ingredient_prices FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.dish_recipes FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
CREATE POLICY venue_rw ON public.recipe_ingredients FOR ALL TO authenticated
  USING (venue_id = public.auth_venue_id()) WITH CHECK (venue_id = public.auth_venue_id());
