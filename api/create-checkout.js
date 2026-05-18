// api/create-checkout.js — Vercel serverless function
// ──────────────────────────────────────────────────────
// Creates a Stripe Checkout session and returns the redirect URL.
// Called by subscription.js when the user clicks "Subscribe now".
//
// Required environment variables (Vercel dashboard + .env.local):
//   STRIPE_SECRET_KEY         — sk_test_... (test) or sk_live_... (live)
//   STRIPE_PRICE_ID           — price_... from your Stripe product
//   SUPABASE_URL              — your Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (server-side ONLY, never in browser)
//   APP_URL                   — https://your-project.vercel.app

// TODO (Step 5): uncomment once Stripe and Supabase packages are installed
// const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const { createClient } = require('@supabase/supabase-js');
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // TODO (Step 5): look up or create a Stripe customer for this user
    // const { data: profile } = await supabase
    //   .from('profiles')
    //   .select('stripe_customer_id')
    //   .eq('id', userId)
    //   .single();

    // let customerId = profile?.stripe_customer_id;
    // if (!customerId) {
    //   const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    //   const customer = await stripe.customers.create({ email: user.email });
    //   customerId = customer.id;
    //   await supabase.from('profiles')
    //     .update({ stripe_customer_id: customerId })
    //     .eq('id', userId);
    // }

    // TODO (Step 5): create Checkout session
    // const session = await stripe.checkout.sessions.create({
    //   customer: customerId,
    //   payment_method_types: ['card'],
    //   mode: 'subscription',
    //   line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    //   success_url: `${process.env.APP_URL}/?checkout=success`,
    //   cancel_url:  `${process.env.APP_URL}/?checkout=cancelled`,
    //   currency: 'gbp',
    //   metadata: { userId }
    // });
    // return res.status(200).json({ url: session.url });

    return res.status(501).json({ error: 'Not implemented yet — coming in Step 5' });

  } catch (err) {
    console.error('[Mise] create-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
