// supabase/functions/stripe-webhook/index.ts v21
// ────────────────────────────────────────────
// Receives Stripe webhook events and updates Supabase.
//
// Handles:
//   - Subscription lifecycle (checkout.session.completed, subscription.updated/deleted,
//     invoice.paid, invoice.payment_failed)
//   - Client payments via /pay portal (checkout.session.completed with kind='yield_pay')
//
// Plan normalisation: legacy plan names (veriqo, suite, suite-all, carte, yield) → 'pro'.
//
// v20: checkout.session.completed no longer hardcodes subscription_status: 'active' —
// it uses the real Stripe subscription status (trialing/active/etc, via mapStatus()),
// since create-checkout attaches a trial to every session. Added invoice.paid as the
// positive record of money actually arriving (guarded on a non-zero amount so the £0
// invoice Stripe issues at trial start doesn't flip a trialing user to active). Added
// a stripe_events insert immediately after signature verification, doubling as an
// idempotency guard against Stripe retries (primary-key conflict = duplicate, skip).
//
// v21: invoice.paid now also refreshes current_period_end (previously only
// customer.subscription.updated did). Both fire on a trial's first real charge
// and Stripe doesn't guarantee ordering, so active could otherwise land next to
// a stale period end.

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function normalisePlan(raw: string | null | undefined): string {
  if (!raw) return 'pro';
  const legacy = ['veriqo', 'suite', 'suite-all', 'carte', 'yield'];
  if (legacy.includes(raw.toLowerCase())) return 'pro';
  if (raw === 'starter') return 'starter';
  return 'pro';
}

// active/trialing/past_due/unpaid pass through as-is; Stripe's 'canceled' is
// normalised to this app's 'cancelled' spelling (matches the rest of the codebase).
function mapStatus(s: string): string {
  return s === 'canceled' ? 'cancelled' : s;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');
  if (!sig) return new Response('Missing stripe-signature header', { status: 400 });

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion:  '2024-04-10',
    httpClient:  Stripe.createFetchHttpClient(),
  });

  // Try all registered webhook secrets — platform, thin, and Connect
  const secrets = [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_WEBHOOK_SECRET_THIN'),
    Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT'),
  ].filter(Boolean) as string[];

  let event: Stripe.Event | undefined;
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, secret, undefined, Stripe.createSubtleCryptoProvider());
      break;
    } catch (_) { /* try next */ }
  }

  if (!event) {
    console.error('[Veriqo] Webhook signature verification failed with all secrets');
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Idempotency guard ────────────────────────────────────────────────────
  // Primary-key conflict on event.id means Stripe already sent this one.
  const { error: dupErr } = await supabase.from('stripe_events').insert({
    id:          event.id,
    type:        event.type,
    customer_id: (event.data.object as any)?.customer ?? null,
    payload:     event.data.object,
  });
  if (dupErr?.code === '23505') {
    console.log(`[Veriqo] Duplicate event ${event.id}, skipping`);
    return new Response('duplicate', { status: 200 });
  }
  if (dupErr) {
    console.error('[Veriqo] stripe_events insert error (non-duplicate):', dupErr.message);
  }

  async function setStatusByCustomer(customerId: string, status: string, extra: Record<string, unknown> = {}) {
    const { error } = await supabase
      .from('profiles')
      .update({ subscription_status: status, ...extra })
      .eq('stripe_customer_id', customerId);
    if (error) console.error('[Veriqo] DB update error:', error.message);
  }

  // ── Handle client payment (yield_pay) ───────────────────────────────────────
  async function handleYieldPay(session: Stripe.CheckoutSession) {
    const quoteId  = session.metadata?.quoteId;
    const type     = session.metadata?.type;   // 'deposit' | 'balance' | 'other'
    const userId   = session.metadata?.user_id;
    const amountPence = session.amount_total || 0;
    const amountPounds = amountPence / 100;
    const paymentRef = typeof session.payment_intent === 'string' ? session.payment_intent : null;

    if (!quoteId || !userId) {
      console.warn('[Veriqo] yield_pay missing quoteId or user_id in metadata');
      return;
    }

    console.log(`[Veriqo] yield_pay: quoteId=${quoteId} type=${type} amount=£${amountPounds}`);

    // 1. Fetch current quote
    const { data: row, error: qErr } = await supabase
      .from('quotes')
      .select('quote_data, status')
      .eq('id', quoteId)
      .single();

    if (qErr || !row) {
      console.error('[Veriqo] yield_pay: quote not found', quoteId);
      return;
    }

    const quoteData: Record<string, unknown> = { ...(row.quote_data || {}) };

    // 2. Update paid flags for preset payment types
    if (type === 'deposit') quoteData.depositPaid = true;
    if (type === 'balance') quoteData.balancePaid = true;
    // 'other' — record the payment but don't flip flags automatically

    // 3. Determine new quote status
    let newStatus = row.status;
    if (quoteData.depositPaid && quoteData.balancePaid) {
      newStatus = 'paid';
    } else if (quoteData.depositPaid && row.status === 'sent') {
      newStatus = 'accepted'; // deposit payment implicitly accepts the quote
    }

    // 4. Write updated quote back
    const { error: uErr } = await supabase
      .from('quotes')
      .update({ quote_data: quoteData, status: newStatus })
      .eq('id', quoteId);
    if (uErr) console.error('[Veriqo] yield_pay: quote update failed', uErr.message);
    else console.log(`[Veriqo] yield_pay: quote ${quoteId} updated — depositPaid=${quoteData.depositPaid} balancePaid=${quoteData.balancePaid} status=${newStatus}`);

    // 5. Find matching invoice (deposit or balance type) and mark paid
    if (type === 'deposit' || type === 'balance') {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, total')
        .eq('user_id', userId)
        .eq('quote_id', quoteId)
        .eq('type', type)
        .limit(1);

      if (invoices && invoices.length > 0) {
        const inv = invoices[0];
        await supabase
          .from('invoices')
          .update({ paid_total: inv.total, status: 'paid' })
          .eq('id', inv.id);
        console.log(`[Veriqo] yield_pay: invoice ${inv.id} marked paid`);
      }
    }

    // 6. Record the payment
    const paymentId = paymentRef ? 'yp_' + paymentRef : 'yp_' + quoteId + '_' + type + '_' + Date.now();
    await supabase.from('payments').upsert({
      id:         paymentId,
      user_id:    userId,
      invoice_id: null,
      job_id:     null,
      amount:     amountPounds,
      paid_at:    new Date().toISOString(),
      method:     'card',
      ref:        paymentRef || quoteId,
    }, { onConflict: 'id' });
    console.log(`[Veriqo] yield_pay: payment recorded £${amountPounds}`);
  }

  // ── Event router ─────────────────────────────────────────────────────────────
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.CheckoutSession;

      // Client payment via /pay portal
      if (session.metadata?.kind === 'yield_pay') {
        await handleYieldPay(session);
        break;
      }

      // Subscription purchase
      const userId     = session.metadata?.userId;
      const plan       = normalisePlan(session.metadata?.plan);
      const customerId = session.customer as string;
      const subId      = session.subscription as string;
      const starterModule = plan === 'starter' ? 'haccp' : (session.metadata?.starter_module || null);

      const updateData: Record<string, unknown> = {
        subscription_plan: plan,
        ...(plan === 'starter' && starterModule ? { starter_module: starterModule } : {}),
      };

      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          updateData.stripe_subscription_id = subId;
          updateData.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
          updateData.subscription_status = mapStatus(sub.status);
        } catch (e) {
          console.warn('[Veriqo] Could not retrieve subscription:', e);
          updateData.subscription_status = session.payment_status === 'paid' ? 'active' : 'trialing';
        }
      } else {
        updateData.subscription_status = session.payment_status === 'paid' ? 'active' : 'trialing';
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
      const status = sub.status === 'active'  ? 'active'
                   : sub.status === 'past_due' ? 'past_due'
                   : sub.status === 'canceled' ? 'cancelled'
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

    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      // Guard on a non-zero amount: Stripe issues a £0 invoice at trial start,
      // which must not flip a still-trialing user to active.
      if ((inv.amount_paid ?? 0) > 0) {
        const extra: Record<string, unknown> = {};
        const subId = typeof inv.subscription === 'string' ? inv.subscription : null;
        if (subId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            extra.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
          } catch (e) {
            console.warn('[Veriqo] invoice.paid: could not retrieve subscription for period end:', e);
          }
        }
        await setStatusByCustomer(inv.customer as string, 'active', extra);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      await setStatusByCustomer(inv.customer as string, 'past_due');
      break;
    }

    default:
      console.log(`[Veriqo] Unhandled Stripe event: ${event.type}`);
  }

  return new Response('ok', { status: 200 });
});
