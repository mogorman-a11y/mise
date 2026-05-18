// supabase/functions/stripe-webhook/index.ts v18
// ────────────────────────────────────────────
// Receives Stripe webhook events and updates subscription_status in Supabase.
//
// Plan normalisation: legacy plan names (veriqo, suite, suite-all, carte, yield)
// are mapped to 'pro'. New values: 'pro', 'starter'.

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Plan name normaliser ──────────────────────────────────────────────────────
function normalisePlan(raw: string | null | undefined): string {
  if (!raw) return 'pro';
  const legacy = ['veriqo', 'suite', 'suite-all', 'carte', 'yield'];
  if (legacy.includes(raw.toLowerCase())) return 'pro';
  if (raw === 'starter') return 'starter';
  return 'pro'; // safe default
}

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

  const secrets = [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_WEBHOOK_SECRET_THIN'),
  ].filter(Boolean) as string[];

  let verified = false;
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, secret, undefined, Stripe.createSubtleCryptoProvider());
      verified = true;
      break;
    } catch (_) { /* try next */ }
  }

  if (!verified!) {
    console.error('[Veriqo] Webhook signature verification failed with all secrets');
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  // ── 2. Handle events ──────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

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

    case 'checkout.session.completed': {
      const session    = event.data.object as Stripe.CheckoutSession;
      const userId     = session.metadata?.userId;
      const plan       = normalisePlan(session.metadata?.plan);
      const customerId = session.customer as string;
      const subId      = session.subscription as string;

      const updateData: Record<string, unknown> = {
        subscription_status: 'active',
        subscription_plan:   plan,
      };

      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          updateData.stripe_subscription_id = subId;
          updateData.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
        } catch (e) { console.warn('[Veriqo] Could not retrieve subscription:', e); }
      }

      if (userId) {
        const { error } = await supabase.from('profiles').update(updateData).eq('id', userId);
        if (error) console.error('[Veriqo] checkout update by userId error:', error.message);
      } else if (customerId) {
        const { error } = await supabase.from('profiles').update(updateData).eq('stripe_customer_id', customerId);
        if (error) console.error('[Veriqo] checkout update by customerId error:', error.message);
      }
      break;
    }

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

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await setStatusByCustomer(sub.customer as string, 'cancelled');
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await setStatusByCustomer(invoice.customer as string, 'past_due');
      break;
    }

    default:
      console.log(`[Veriqo] Unhandled Stripe event: ${event.type}`);
  }

  return new Response('ok', { status: 200 });
});
