// supabase/functions/create-checkout/index.ts v2
// ─────────────────────────────────────────────
// Creates a Stripe Checkout Session and returns { url }.
// Called by js/core/subscription.js startCheckout().
//
// v2: carries over the user's existing trial_ends_at instead of granting a
// fresh 14-day trial on every checkout — closes the stack-a-trial /
// cancel-and-resubscribe loop. No trial_ends_at (or one too close to now)
// means no Stripe trial at all: the card is charged immediately, which is
// the deliberate failure mode (charging, not free access).
//
// Required Supabase edge function secrets:
//   STRIPE_SECRET_KEY           — sk_live_... (or sk_test_... for testing)
//   STRIPE_PRICE_PRO_MONTHLY    — price_... for £15/month Pro
//   STRIPE_PRICE_PRO_ANNUAL     — price_... for £150/year Pro
//   STRIPE_PRICE_STARTER_MONTHLY — price_... for £7/month Veriqo HACCP
//   STRIPE_PRICE_STARTER_ANNUAL  — price_... for £70/year Veriqo HACCP
//   SUPABASE_URL                — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected by Supabase
//   APP_URL                     — https://getveriqo.co.uk

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  // ── 1. Verify JWT ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return json({ error: 'Invalid or expired session' }, 401);

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let plan = 'pro', period = 'monthly', starter_module = '';
  try {
    const body = await req.json();
    plan           = body.plan           || 'pro';
    period         = body.period         || 'monthly';
    starter_module = body.starter_module || '';
  } catch (_) { /* keep defaults */ }

  if (!['pro', 'starter'].includes(plan))       return json({ error: 'Invalid plan' }, 400);
  if (!['monthly', 'annual'].includes(period))  return json({ error: 'Invalid period' }, 400);
  if (plan === 'starter') starter_module = 'haccp';

  // ── 3. Resolve price ID ───────────────────────────────────────────────────
  const PRICES: Record<string, string | undefined> = {
    'pro:monthly':      Deno.env.get('STRIPE_PRICE_PRO_MONTHLY'),
    'pro:annual':       Deno.env.get('STRIPE_PRICE_PRO_ANNUAL'),
    'starter:monthly':  Deno.env.get('STRIPE_PRICE_STARTER_MONTHLY'),
    'starter:annual':   Deno.env.get('STRIPE_PRICE_STARTER_ANNUAL'),
  };
  const priceId = PRICES[`${plan}:${period}`];
  if (!priceId) return json({ error: `Price not configured for ${plan}/${period} — check Supabase secrets` }, 400);

  // ── 4. Look up or create Stripe customer ──────────────────────────────────
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion:  '2024-04-10',
    httpClient:  Stripe.createFetchHttpClient(),
  });

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, trial_ends_at')
    .eq('id', user.id)
    .single();

  const profileRow = profile as { stripe_customer_id?: string; trial_ends_at?: string } | null;
  let customerId: string = profileRow?.stripe_customer_id || '';

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email!,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  // ── 5. Create Checkout Session ────────────────────────────────────────────
  const appUrl = Deno.env.get('APP_URL') || 'https://getveriqo.co.uk';

  const metadata: Record<string, string> = { userId: user.id, plan };
  if (plan === 'starter' && starter_module) metadata.starter_module = starter_module;

  // Carry over the signup trial. Never grant a second one.
  // Stripe requires trial_end to be at least 48h in the future.
  const MIN_LEAD_MS = 48 * 60 * 60 * 1000;
  const trialEndsAt = profileRow?.trial_ends_at ? new Date(profileRow.trial_ends_at) : null;

  const subscriptionData: Record<string, unknown> = { metadata };
  if (trialEndsAt && trialEndsAt.getTime() - Date.now() >= MIN_LEAD_MS) {
    subscriptionData.trial_end = Math.floor(trialEndsAt.getTime() / 1000);
  }
  // otherwise: no trial, card is charged at checkout

  const session = await stripe.checkout.sessions.create({
    customer:              customerId,
    payment_method_types:  ['card'],
    mode:                  'subscription',
    line_items:            [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data:     subscriptionData,
    metadata,
    success_url: `${appUrl}/app?checkout=success`,
    cancel_url:  `${appUrl}/app?checkout=cancelled`,
  });

  return json({ url: session.url });
});
