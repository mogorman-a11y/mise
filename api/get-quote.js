// api/get-quote.js — Public client portal quote lookup
// GET /api/get-quote?q={portalToken}
// Uses service role to bypass RLS — only returns non-draft quotes.
// Powers the /pay client portal page.
//
// `q` is quotes.portal_token, a random per-quote credential (see migration
// 20260722000000) — NOT the row's internal `id`. The old id-keyed lookup
// was VQ-003: ids are client-generated Date.now() timestamps, low-entropy
// and enumerable, so they doubled as guessable access credentials for
// client financial/PII data.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.query.q;
  if (!token) return res.status(400).json({ error: 'Quote ID required' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Fetch the quote row
  const { data: row, error } = await sb
    .from('quotes')
    .select('quote_data, user_id, status')
    .eq('portal_token', token)
    .single();

  if (error || !row) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  // Don't expose drafts to clients — chef must send the quote first
  if (!row.status || row.status === 'draft') {
    return res.status(403).json({ error: 'This quote has not been sent yet' });
  }

  const quote = row.quote_data || {};

  // Fetch chef profile for display name + payment instructions
  const { data: profile } = await sb
    .from('profiles')
    .select('business_name, chef_name, yield_settings, stripe_account_status')
    .eq('id', row.user_id)
    .single();

  const ySettings = (profile && profile.yield_settings) || {};
  const depositPct = parseFloat(ySettings.defaultDepositPct || 30);

  // Calculate totals — mirrors buildQuotePDF / Tab Summary in yield.html
  const base = parseFloat(quote.price_per_head || 0) * parseInt(quote.covers || 0);
  const extrasTotal = (quote.extras || []).reduce(function (s, e) {
    return s + parseFloat(e.amount || 0);
  }, 0);
  const subTotal = base + extrasTotal;
  // Prefer VAT snapshot stored on the quote itself; fall back to chef's current settings
  const vatEnabled = quote.vatEnabled !== undefined ? !!quote.vatEnabled : !!(ySettings.vatEnabled);
  const vatRate = parseFloat(quote.vatRate !== undefined ? quote.vatRate : (ySettings.vatRate || 20)) / 100;
  const vatAmount = vatEnabled ? subTotal * vatRate : 0;
  const grandTotal = subTotal + vatAmount;
  const depositAmt = grandTotal * (depositPct / 100);
  const balanceAmt = grandTotal - depositAmt;

  return res.status(200).json({
    quote: {
      client_name: quote.client_name || null,
      event_date: quote.event_date || null,
      covers: parseInt(quote.covers || 0),
      price_per_head: parseFloat(quote.price_per_head || 0),
      extras: quote.extras || [],
      catering_subtotal: base,
      extras_total: extrasTotal,
      subtotal: subTotal,
      vat_enabled: vatEnabled,
      vat_rate: Math.round(vatRate * 100),
      vat_amount: vatAmount,
      grand_total: grandTotal,
      deposit_pct: depositPct,
      deposit_amount: depositAmt,
      balance_amount: balanceAmt,
      deposit_paid: !!quote.depositPaid,
      balance_paid: !!quote.balancePaid,
      status: row.status,
      notes: quote.notes || ''
    },
    chef: {
      business_name: (profile && profile.business_name) || 'Your Chef',
      chef_name: (profile && profile.chef_name) || '',
      payment_instructions: ySettings.paymentInstructions || '',
      card_payments_enabled: !!(profile && profile.stripe_account_status === 'active')
    }
  });
};
