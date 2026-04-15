// supabase/functions/stripe-webhook/index.ts
// ────────────────────────────────────────────
// Receives Stripe webhook events and updates subscription_status in Supabase.
// Register this URL in Stripe Dashboard → Developers → Webhooks:
//   https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/stripe-webhook
//
// Events to enable in Stripe:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed
//
// Secrets required (set via: supabase secrets set KEY=value):
//   STRIPE_SECRET_KEY      — sk_live_... (or sk_test_...)
//   STRIPE_WEBHOOK_SECRET  — whsec_... from the webhook settings page

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── 1. Verify the Stripe signature ────────────────────────────────────────
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion:  '2024-04-10',
    httpClient:  Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Veriqo] Webhook signature verification failed:', msg);
    return new Response(`Webhook error: ${msg}`, { status: 400 });
  }

  // ── 2. Handle events ──────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Helper: update profiles by stripe_customer_id
  async function setStatusByCustomer(
    customerId: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    const { error } = await supabase
      .from('profiles')
      .update({ subscription_status: status, ...extra })
      .eq('stripe_customer_id', customerId);

    if (error) console.error('[Veriqo] DB update error:', error.message);
  }

  switch (event.type) {

    // ── Checkout completed → subscription now active ────────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.CheckoutSession;
      const userId  = session.metadata?.userId;
      const subId   = session.subscription as string;

      if (userId && subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_status:    'active',
            stripe_subscription_id: subId,
            current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
          })
          .eq('id', userId);

        if (error) console.error('[Veriqo] checkout.session.completed update error:', error.message);
      }
      break;
    }

    // ── Subscription renewed, upgraded, or downgraded ──────────────────────
    case 'customer.subscription.updated': {
      const sub    = event.data.object as Stripe.Subscription;
      const status = sub.status === 'active'   ? 'active'
                   : sub.status === 'past_due'  ? 'past_due'
                   : sub.status === 'canceled'  ? 'cancelled'
                   : sub.status;

      await setStatusByCustomer(sub.customer as string, status, {
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    // ── Subscription cancelled ─────────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await setStatusByCustomer(sub.customer as string, 'cancelled');
      break;
    }

    // ── Renewal payment failed ─────────────────────────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await setStatusByCustomer(invoice.customer as string, 'past_due');
      break;
    }

    default:
      console.log(`[Veriqo] Unhandled Stripe event: ${event.type}`);
  }

  // Always return 200 quickly — Stripe retries if it doesn't get a 2xx
  return new Response('ok', { status: 200 });
});
