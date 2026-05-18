-- 2026-05-14 — Yield Stripe Connect (Express + Direct charges)
--
-- Adds chef-Connect account tracking on profiles so client payments
-- (deposit + balance via Stripe Checkout) charge the chef's own Stripe
-- account directly. Platform never holds funds; no application fee.
--
-- Run in Supabase SQL Editor against project yixrwyfodipfcbhjcszp.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_status TEXT;

-- Status values: NULL (never connected), 'pending' (onboarding started),
-- 'active' (charges_enabled + payouts_enabled both true), 'restricted'
-- (Stripe disabled charges or payouts), 'rejected'.
COMMENT ON COLUMN profiles.stripe_account_id IS 'Stripe Express connected account ID for Yield client payments (acct_...).';
COMMENT ON COLUMN profiles.stripe_account_status IS 'NULL | pending | active | restricted | rejected — derived from Stripe account.charges_enabled + payouts_enabled.';

-- Optional index for webhook lookups by stripe_account_id when
-- account.updated events fire (no user_id in those events).
CREATE INDEX IF NOT EXISTS profiles_stripe_account_id_idx
  ON profiles (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
