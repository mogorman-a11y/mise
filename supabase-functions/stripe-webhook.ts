// supabase/functions/stripe-webhook/index.ts
// ────────────────────────────────────────────
// Receives Stripe webhook events.
//
// Handles both platform-account events (subscriptions) and Connect events
// (Yield client payments + chef account updates).
//
// Register this URL in Stripe Dashboard → Developers → Webhooks (TWO destinations):
//   1. Account events:    https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/stripe-webhook
//      Events: checkout.session.completed, customer.subscription.updated,
//              customer.subscription.deleted, invoice.payment_failed
//   2. Connect events:    https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/stripe-webhook
//      Events: checkout.session.completed (delivered with event.account set),
//              account.updated
//
// Secrets required (set via Supabase Dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY              — sk_live_... (or sk_test_...)
//   STRIPE_WEBHOOK_SECRET          — whsec_... for the Account-events destination
//   STRIPE_WEBHOOK_SECRET_THIN     — optional; legacy "thin payload" destination
//   STRIPE_WEBHOOK_SECRET_CONNECT  — whsec_... for the Connect-events destination

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
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

  // Try the primary, thin, and Connect secrets in turn — Stripe sends Connect
  // events signed with a different secret than the platform account.
  const secrets = [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_WEBHOOK_SECRET_THIN'),
    Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT'),
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

  // Connect direct charges arrive with event.account set to the chef's acct_id.
  const connectAccount = (event as any).account as string | undefined;

  // ── Yield client payment (Connect direct charge) ────────────────────────
  if (
    event.type === 'checkout.session.completed' &&
    (event.data.object as any).metadata?.kind === 'yield_pay'
  ) {
    const session = event.data.object as Stripe.CheckoutSession;
    const md = session.metadata || {};
    const quoteId = md.quoteId;
    const type    = md.type as 'deposit' | 'balance';
    const userId  = md.user_id;

    if (!quoteId || !type || !userId) {
      console.error('[Yield] client-pay session missing metadata:', md);
      return new Response('ok', { status: 200 });
    }

    try {
      // 1) Mark the flag inside quotes.quote_data
      const { data: qRow, error: qErr } = await supabase
        .from('quotes')
        .select('quote_data')
        .eq('id', quoteId)
        .eq('user_id', userId)
        .single();

      if (qErr || !qRow) {
        console.error('[Yield] client-pay quote not found:', quoteId, qErr?.message);
      } else {
        const qd = (qRow.quote_data || {}) as Record<string, unknown>;
        if (type === 'deposit') qd.depositPaid = true;
        if (type === 'balance') qd.balancePaid = true;
        qd[`${type}PaidVia`] = 'stripe';
        qd[`${type}PaidAt`] = new Date().toISOString();
        qd[`${type}StripeSessionId`] = session.id;

        const { error: upErr } = await supabase
          .from('quotes')
          .update({ quote_data: qd })
          .eq('id', quoteId)
          .eq('user_id', userId);
        if (upErr) console.error('[Yield] client-pay quote update error:', upErr.message);
      }

      // 2) Mark the matching invoice row as paid
      const amountReceived = ((session.amount_total ?? 0) as number) / 100;

      const { data: inv, error: invErr } = await supabase
        .from('invoices')
        .select('id, total')
        .eq('quote_id', quoteId)
        .eq('user_id', userId)
        .eq('type', type)
        .single();

      if (invErr || !inv) {
        console.warn('[Yield] client-pay invoice not found for quote:', quoteId, type);
      } else {
        const { error: invUpErr } = await supabase
          .from('invoices')
          .update({
            status: 'paid',
            paid_total: amountReceived || inv.total,
          })
          .eq('id', inv.id);
        if (invUpErr) console.error('[Yield] client-pay invoice update error:', invUpErr.message);

        // 3) Insert a payment row for the chef's audit trail
        const { error: payErr } = await supabase
          .from('payments')
          .insert({
            user_id: userId,
            invoice_id: inv.id,
            amount: amountReceived,
            paid_at: new Date().toISOString(),
            method: 'card_stripe',
            ref: session.id,
          });
        if (payErr) console.warn('[Yield] client-pay payment insert error:', payErr.message);
      }

      console.log('[Yield] client-pay processed:', { quoteId, type, amount: amountReceived });
    } catch (err) {
      console.error('[Yield] client-pay handler error:', (err as Error).message);
    }

    return new Response('ok', { status: 200 });
  }

  // ── Chef Connect account status update ─────────────────────────────────
  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account;
    const acctId = acct.id;

    let status: string;
    if (acct.charges_enabled && acct.payouts_enabled) status = 'active';
    else if (!acct.details_submitted) status = 'pending';
    else if (acct.requirements?.disabled_reason) status = 'restricted';
    else status = 'pending';

    const { error } = await supabase
      .from('profiles')
      .update({ stripe_account_status: status })
      .eq('stripe_account_id', acctId);
    if (error) console.error('[Yield] account.updated update error:', error.message);

    console.log('[Yield] account.updated:', acctId, '→', status);
    return new Response('ok', { status: 200 });
  }

  // ── Connect events that we don't handle: ignore (do NOT touch subscription state) ──
  if (connectAccount) {
    console.log('[Yield] Unhandled Connect event:', event.type, 'on', connectAccount);
    return new Response('ok', { status: 200 });
  }

  // ── Subscription events (existing platform-account logic) ──────────────
  switch (event.type) {

    // ── Checkout completed → subscription now active ────────────────────────
    case 'checkout.session.completed': {
      const session    = event.data.object as Stripe.CheckoutSession;
      const userId     = session.metadata?.userId;
      const plan       = session.metadata?.plan || 'veriqo';
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

      // Primary: update by userId from metadata (snapshot payload)
      // Fallback: update by stripe_customer_id (thin payload / missing metadata)
      if (userId) {
        const { error } = await supabase.from('profiles').update(updateData).eq('id', userId);
        if (error) console.error('[Veriqo] checkout update by userId error:', error.message);
      } else if (customerId) {
        const { error } = await supabase.from('profiles').update(updateData).eq('stripe_customer_id', customerId);
        if (error) console.error('[Veriqo] checkout update by customerId error:', error.message);
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
