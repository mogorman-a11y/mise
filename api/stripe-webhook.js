// api/stripe-webhook.js — Vercel serverless function
// ────────────────────────────────────────────────────
// Handles incoming webhook events from Stripe and updates Supabase.
// Register this URL in Stripe dashboard → Webhooks:
//   https://your-project.vercel.app/api/stripe-webhook
//
// Events handled:
//   checkout.session.completed     → set subscription_status = 'active'
//   customer.subscription.deleted  → set subscription_status = 'cancelled'
//   customer.subscription.updated  → sync status changes
//   invoice.payment_failed         → set subscription_status = 'past_due'
//
// Required environment variables:
//   STRIPE_SECRET_KEY             — sk_test_... or sk_live_...
//   STRIPE_WEBHOOK_SECRET         — whsec_... from Stripe dashboard webhook settings
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY     — bypasses RLS to write any user's row

// Vercel must receive the raw body to verify the Stripe signature
export const config = { api: { bodyParser: false } };

// TODO (Step 5): uncomment once packages are installed
// const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const getRawBody = require('raw-body');
// const { createClient } = require('@supabase/supabase-js');
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // TODO (Step 5): verify Stripe signature to reject forged requests
  // const sig = req.headers['stripe-signature'];
  // let event;
  // try {
  //   const rawBody = await getRawBody(req);
  //   event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  // } catch (err) {
  //   console.error('[Mise] Webhook signature error:', err.message);
  //   return res.status(400).send(`Webhook error: ${err.message}`);
  // }

  // TODO (Step 5): handle each event type
  // switch (event.type) {
  //
  //   case 'checkout.session.completed':
  //     // Payment confirmed — activate subscription
  //     await setStatus(event.data.object.customer, 'active');
  //     break;
  //
  //   case 'customer.subscription.deleted':
  //     // User cancelled or subscription ended
  //     await setStatus(event.data.object.customer, 'cancelled');
  //     break;
  //
  //   case 'customer.subscription.updated':
  //     // Covers upgrades, downgrades, and renewals
  //     const newStatus = event.data.object.status === 'active' ? 'active' : 'past_due';
  //     await setStatus(event.data.object.customer, newStatus);
  //     break;
  //
  //   case 'invoice.payment_failed':
  //     // Renewal payment failed
  //     await setStatus(event.data.object.customer, 'past_due');
  //     break;
  //
  //   default:
  //     console.log(`[Mise] Unhandled event type: ${event.type}`);
  // }

  // Always return 200 quickly so Stripe doesn't retry
  return res.status(501).json({ received: true, note: 'Not implemented yet — coming in Step 5' });
};

// ── setStatus ─────────────────────────────────────────────────────────────────
// Updates subscription_status in the profiles table for the given Stripe customer.
// async function setStatus(stripeCustomerId, status) {
//   const { error } = await supabase
//     .from('profiles')
//     .update({ subscription_status: status })
//     .eq('stripe_customer_id', stripeCustomerId);
//   if (error) console.error('[Mise] setStatus error:', error.message);
// }
