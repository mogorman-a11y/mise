// supabase/functions/create-checkout/index.ts v1
// ─────────────────────────────────────────────
// Creates a Stripe Checkout Session and returns { url }.
// Called by js/core/subscription.js startCheckout().
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
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  let customerId: string = (profile as { stripe_customer_id?: string } | null)?.stripe_customer_id || '';

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

  const session = await stripe.checkout.sessions.create({
    customer:              customerId,
    payment_method_types:  ['card'],
    mode:                  'subscription',
    line_items:            [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: {
      trial_period_days: 14,
      metadata,
    },
    metadata,
    success_url: `${appUrl}/app?checkout=success`,
    cancel_url:  `${appUrl}/app?checkout=cancelled`,
  });

  return json({ url: session.url });
});
