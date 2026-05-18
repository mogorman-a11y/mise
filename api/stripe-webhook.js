// api/stripe-webhook.js — Vercel serverless function
// ────────────────────────────────────────────────────
// Handles Stripe webhook events and provisions subscriptions in Supabase.
//
// Register this URL in Stripe Dashboard → Webhooks:
//   https://www.getveriqo.co.uk/api/stripe-webhook
//
// Events handled:
//   checkout.session.completed     → activate subscription, set plan
//   customer.subscription.updated  → sync status/plan changes (upgrades, renewals)
//   customer.subscription.deleted  → set subscription_status = 'cancelled'
//   invoice.payment_failed         → set subscription_status = 'past_due'
//   invoice.paid                   → keep active, refresh current_period_end
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET          — whsec_... from Stripe Dashboard webhook settings
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Plan price IDs (all must be set in Vercel env vars):
//   STRIPE_VERIQO_MONTHLY_PRICE_ID    STRIPE_VERIQO_ANNUAL_PRICE_ID
//   STRIPE_CARTE_MONTHLY_PRICE_ID     STRIPE_CARTE_ANNUAL_PRICE_ID
//   STRIPE_SUITE_MONTHLY_PRICE_ID     STRIPE_SUITE_ANNUAL_PRICE_ID
//   STRIPE_YIELD_MONTHLY_PRICE_ID     STRIPE_YIELD_ANNUAL_PRICE_ID
//   STRIPE_SUITE_ALL_MONTHLY_PRICE_ID STRIPE_SUITE_ALL_ANNUAL_PRICE_ID

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Price ID → subscription_plan map ──────────────────────────────────────────
// Built at request time so env vars are always fresh.
function buildPriceMap() {
  const pairs = [
    ['STRIPE_VERIQO_MONTHLY_PRICE_ID',    'veriqo'],
    ['STRIPE_VERIQO_ANNUAL_PRICE_ID',     'veriqo'],
    ['STRIPE_CARTE_MONTHLY_PRICE_ID',     'carte'],
    ['STRIPE_CARTE_ANNUAL_PRICE_ID',      'carte'],
    ['STRIPE_SUITE_MONTHLY_PRICE_ID',     'suite'],
    ['STRIPE_SUITE_ANNUAL_PRICE_ID',      'suite'],
    ['STRIPE_YIELD_MONTHLY_PRICE_ID',     'yield'],
    ['STRIPE_YIELD_ANNUAL_PRICE_ID',      'yield'],
    ['STRIPE_SUITE_ALL_MONTHLY_PRICE_ID', 'suite-all'],
    ['STRIPE_SUITE_ALL_ANNUAL_PRICE_ID',  'suite-all'],
  ];
  const map = {};
  for (const [env, plan] of pairs) {
    if (process.env[env]) map[process.env[env]] = plan;
  }
  return map;
}

// Extract plan from a Stripe subscription object's items.
function planFromSubscription(sub) {
  const priceMap = buildPriceMap();
  for (const item of (sub.items?.data || [])) {
    const priceId = item.price?.id;
    if (priceId && priceMap[priceId]) return priceMap[priceId];
  }
  return null;
}

// Read the raw request body as a Buffer (needed for Stripe signature verification).
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── updateProfile ──────────────────────────────────────────────────────────────
// Write fields to profiles matching a Stripe customer ID.
// Falls back to email lookup if stripe_customer_id hasn't been stored yet.
async function updateProfile(stripeCustomerId, updates) {
  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('stripe_customer_id', stripeCustomerId);

  if (!error) return;

  // Customer ID not yet stored — look up by email via Stripe + auth.users
  console.warn('[Stripe] stripe_customer_id not found, falling back to email lookup:', error.message);
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (!customer.email) return;

    const { data: { users } } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = users?.find((u) => u.email === customer.email);
    if (user) {
      updates.stripe_customer_id = stripeCustomerId; // store it for future lookups
      await supabase.from('profiles').update(updates).eq('id', user.id);
    }
  } catch (e) {
    console.error('[Stripe] Email fallback failed:', e.message);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Stripe signature — rejects forged/replayed requests
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  console.log('[Stripe] Event:', event.type, event.id);

  try {
    switch (event.type) {

      // ── checkout.session.completed ─────────────────────────────────────────
      // Fires when the customer completes Stripe Checkout. Set subscription active.
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Plan comes from checkout session metadata set by create-checkout edge fn.
        // Field may be 'app' or 'plan' depending on how create-checkout was built.
        let plan = session.metadata?.app || session.metadata?.plan || null;

        // Fetch the subscription to get price ID (plan fallback) + period end
        let periodEnd = null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price'],
          });
          if (!plan) plan = planFromSubscription(sub);
          if (sub.current_period_end) {
            periodEnd = new Date(sub.current_period_end * 1000).toISOString();
          }
        }

        const updates = {
          subscription_status: 'active',
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          current_period_end: periodEnd,
        };
        if (plan) updates.subscription_plan = plan;

        await updateProfile(customerId, updates);
        console.log('[Stripe] Activated:', customerId, '→ plan:', plan);
        break;
      }

      // ── customer.subscription.updated ──────────────────────────────────────
      // Fires on upgrades, downgrades, renewals, and status changes.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const plan = planFromSubscription(sub);
        const stripeStatus = sub.status;

        const status =
          stripeStatus === 'active'   ? 'active'   :
          stripeStatus === 'trialing' ? 'trial'    :
          stripeStatus === 'past_due' ? 'past_due' :
          stripeStatus === 'canceled' ? 'cancelled' :
          stripeStatus;

        const updates = {
          subscription_status: status,
          stripe_subscription_id: sub.id,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        };
        if (plan) updates.subscription_plan = plan;

        await updateProfile(sub.customer, updates);
        console.log('[Stripe] Updated:', sub.customer, '→ status:', status, 'plan:', plan);
        break;
      }

      // ── customer.subscription.deleted ──────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await updateProfile(sub.customer, { subscription_status: 'cancelled' });
        console.log('[Stripe] Cancelled:', sub.customer);
        break;
      }

      // ── invoice.payment_failed ─────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        await updateProfile(inv.customer, { subscription_status: 'past_due' });
        console.log('[Stripe] Payment failed:', inv.customer);
        break;
      }

      // ── invoice.paid ───────────────────────────────────────────────────────
      // Successful renewal — refresh period end date.
      case 'invoice.paid': {
        const inv = event.data.object;
        if (!inv.subscription) break;
        const sub = await stripe.subscriptions.retrieve(inv.subscription);
        await updateProfile(inv.customer, {
          subscription_status: 'active',
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        });
        console.log('[Stripe] Renewal paid:', inv.customer);
        break;
      }

      default:
        console.log('[Stripe] Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('[Stripe] Handler error:', err.message, err.stack);
    return res.status(500).json({ error: 'Internal error processing webhook event' });
  }

  return res.status(200).json({ received: true });
};
