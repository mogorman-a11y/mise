// api/stripe-connect.js — Yield Stripe Connect (Express + Direct charges)
//
// Single endpoint, multi-action. Action selected by ?action= query string.
//
// CHEF-FACING (Yield Settings → Payment tab) — all require an
// "Authorization: Bearer <supabase access token>" header; the uid is derived
// from that verified session, never from the request:
//   POST /api/stripe-connect?action=onboard
//     Creates Stripe Express account if needed, stores acct_id on profiles,
//     returns { url } — Account Link URL for chef to complete onboarding.
//   POST /api/stripe-connect?action=refresh
//     Re-fetches Stripe account, updates profiles.stripe_account_status,
//     returns { status, charges_enabled, payouts_enabled, details_submitted }.
//   POST /api/stripe-connect?action=dashboard
//     Creates an Express Dashboard login link, returns { url }.
//
// CLIENT-FACING (/pay portal):
//   POST /api/stripe-connect?action=checkout
//     Body: { quoteId, type: 'deposit' | 'balance' }
//     Looks up quote + chef stripe_account_id, creates Stripe Checkout
//     Session as a Direct Charge on the chef's account, returns { url }.
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SITE = 'https://getveriqo.co.uk';

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function verifyUser(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

function deriveStatus(acct) {
  if (!acct) return null;
  if (acct.charges_enabled && acct.payouts_enabled) return 'active';
  if (acct.requirements && Array.isArray(acct.requirements.disabled_reason) ? false : acct.requirements?.disabled_reason) return 'restricted';
  if (!acct.details_submitted) return 'pending';
  return 'pending';
}

// ── Chef: onboard ────────────────────────────────────────────────────────────
async function handleOnboard(uid, res) {
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const supabase = sb();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, stripe_account_id, business_name, chef_name')
    .eq('id', uid)
    .single();

  if (error || !profile) return res.status(404).json({ error: 'Profile not found' });

  let accountId = profile.stripe_account_id;

  // Create Express account if chef doesn't have one yet
  if (!accountId) {
    // Look up chef email via auth.users
    const { data: u } = await supabase.auth.admin.getUserById(uid);
    const email = u?.user?.email;

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      email: email || undefined,
      business_type: 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_profile: {
        name: profile.business_name || undefined,
        product_description: 'Private chef services',
        url: SITE
      },
      metadata: { mise_user_id: uid, source: 'yield' }
    });

    accountId = account.id;
    await supabase
      .from('profiles')
      .update({ stripe_account_id: accountId, stripe_account_status: 'pending' })
      .eq('id', uid);
  }

  // Account Link — sends chef to Stripe-hosted onboarding form
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${SITE}/yield?stripe=refresh`,
    return_url: `${SITE}/yield?stripe=connected`,
    type: 'account_onboarding'
  });

  return res.status(200).json({ url: link.url });
}

// ── Chef: refresh status ─────────────────────────────────────────────────────
async function handleRefresh(uid, res) {
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const supabase = sb();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', uid)
    .single();

  if (error || !profile?.stripe_account_id) {
    return res.status(404).json({ error: 'No Stripe account on file' });
  }

  const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
  const status = deriveStatus(acct);

  await supabase
    .from('profiles')
    .update({ stripe_account_status: status })
    .eq('id', uid);

  return res.status(200).json({
    status,
    charges_enabled: !!acct.charges_enabled,
    payouts_enabled: !!acct.payouts_enabled,
    details_submitted: !!acct.details_submitted
  });
}

// ── Chef: Express Dashboard login link ───────────────────────────────────────
async function handleDashboard(uid, res) {
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const supabase = sb();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', uid)
    .single();

  if (error || !profile?.stripe_account_id) {
    return res.status(404).json({ error: 'No Stripe account on file' });
  }

  const link = await stripe.accounts.createLoginLink(profile.stripe_account_id);
  return res.status(200).json({ url: link.url });
}

// ── Client: create Checkout Session ──────────────────────────────────────────
async function handleCheckout(body, res) {
  const { quoteId, type } = body || {};
  if (!quoteId) return res.status(400).json({ error: 'quoteId required' });
  if (type !== 'deposit' && type !== 'balance') {
    return res.status(400).json({ error: 'type must be deposit or balance' });
  }

  const supabase = sb();

  const { data: row, error } = await supabase
    .from('quotes')
    .select('quote_data, user_id, status')
    .eq('id', quoteId)
    .single();

  if (error || !row) return res.status(404).json({ error: 'Quote not found' });
  if (!row.status || row.status === 'draft') {
    return res.status(403).json({ error: 'Quote not yet sent' });
  }

  const quote = row.quote_data || {};

  // Compute amount (mirrors api/get-quote.js)
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, stripe_account_id, stripe_account_status, yield_settings')
    .eq('id', row.user_id)
    .single();

  if (!profile?.stripe_account_id || profile.stripe_account_status !== 'active') {
    return res.status(503).json({ error: 'Card payments are not yet available for this quote.' });
  }

  // Idempotency — refuse double-payment
  if (type === 'deposit' && quote.depositPaid) {
    return res.status(409).json({ error: 'Deposit already paid' });
  }
  if (type === 'balance' && quote.balancePaid) {
    return res.status(409).json({ error: 'Balance already paid' });
  }
  if (type === 'balance' && !quote.depositPaid) {
    return res.status(409).json({ error: 'Deposit must be paid first' });
  }

  const ySettings = profile.yield_settings || {};
  const depositPct = parseFloat(ySettings.defaultDepositPct || 30);

  const base = parseFloat(quote.price_per_head || 0) * parseInt(quote.covers || 0);
  const extrasTotal = (quote.extras || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const subTotal = base + extrasTotal;
  const vatEnabled = quote.vatEnabled !== undefined ? !!quote.vatEnabled : !!ySettings.vatEnabled;
  const vatRate = parseFloat(quote.vatRate !== undefined ? quote.vatRate : (ySettings.vatRate || 20)) / 100;
  const vatAmount = vatEnabled ? subTotal * vatRate : 0;
  const grandTotal = subTotal + vatAmount;
  const depositAmt = grandTotal * (depositPct / 100);
  const amount = type === 'deposit' ? depositAmt : (grandTotal - depositAmt);

  const amountMinor = Math.round(amount * 100);
  if (!Number.isFinite(amountMinor) || amountMinor < 50) {
    return res.status(400).json({ error: 'Amount too small to charge' });
  }

  const currency = (ySettings.currency || 'GBP').toLowerCase();

  const businessName = profile.business_name || 'Your Chef';
  const eventLabel = quote.client_name ? `${quote.client_name} — ` : '';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        product_data: {
          name: `${eventLabel}${type === 'deposit' ? 'Deposit' : 'Balance'} — ${businessName}`
        },
        unit_amount: amountMinor
      },
      quantity: 1
    }],
    success_url: `${SITE}/pay?q=${encodeURIComponent(quoteId)}&status=success&type=${type}`,
    cancel_url:  `${SITE}/pay?q=${encodeURIComponent(quoteId)}&status=cancelled`,
    metadata: {
      kind: 'yield_pay',
      quoteId,
      type,
      user_id: row.user_id
    },
    payment_intent_data: {
      metadata: {
        kind: 'yield_pay',
        quoteId,
        type,
        user_id: row.user_id
      }
    }
  }, {
    // Direct charge on the chef's connected account
    stripeAccount: profile.stripe_account_id
  });

  return res.status(200).json({ url: session.url });
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://getveriqo.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query?.action || '').toLowerCase();

  // Chef-facing actions mutate/reveal a specific chef's Stripe state — the
  // caller must prove who they are. The uid is derived exclusively from the
  // verified session token; any uid the client sends is ignored.
  const CHEF_ACTIONS = ['onboard', 'refresh', 'dashboard'];

  try {
    if (CHEF_ACTIONS.includes(action)) {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      const uid = await verifyUser(token);
      if (!uid) return res.status(401).json({ error: 'Invalid or expired session' });

      if (action === 'onboard') return await handleOnboard(uid, res);
      if (action === 'refresh') return await handleRefresh(uid, res);
      if (action === 'dashboard') return await handleDashboard(uid, res);
    }
    if (action === 'checkout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return await handleCheckout(req.body, res);
    }
    return res.status(400).json({ error: 'Unknown action — use onboard, refresh, dashboard, or checkout' });
  } catch (err) {
    console.error('[stripe-connect]', action, err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
