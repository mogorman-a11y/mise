// supabase/functions/upgrade-subscription/index.ts
// ──────────────────────────────────────────────────
// Swaps the price on an existing Stripe subscription when a user upgrades plans.
// Prevents double-billing: active subscribers call this instead of create-checkout.
//
// Body: { app: 'veriqo'|'carte'|'suite', period: 'monthly'|'annual' }
// Returns: { success: true, plan: string } | { error: string }
//
// Uses the same STRIPE_PRICE_ID_* env vars as create-checkout.

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // ── 1. Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Parse and validate request ─────────────────────────────────────────
    const body   = await req.json().catch(() => ({}));
    const app    = ['veriqo', 'carte', 'suite'].includes(body.app) ? body.app as string : null;
    const period = body.period === 'annual' ? 'annual' : 'monthly';

    if (!app) {
      return new Response(JSON.stringify({ error: 'Invalid app — must be veriqo, carte, or suite' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Resolve the new Stripe price ID ────────────────────────────────────
    const priceEnvKey: Record<string, string> = {
      veriqo_monthly: 'STRIPE_PRICE_ID',
      veriqo_annual:  'STRIPE_PRICE_ID_ANNUAL',
      carte_monthly:  'STRIPE_PRICE_ID_CARTE_MONTHLY',
      carte_annual:   'STRIPE_PRICE_ID_CARTE_ANNUAL',
      suite_monthly:  'STRIPE_PRICE_ID_SUITE_MONTHLY',
      suite_annual:   'STRIPE_PRICE_ID_SUITE_ANNUAL',
    };
    const newPriceId = Deno.env.get(priceEnvKey[`${app}_${period}`]);
    if (!newPriceId) {
      return new Response(JSON.stringify({ error: `Price not configured for ${app} ${period}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Load the user's profile ────────────────────────────────────────────
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No Stripe customer found for this user' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // ── 5. Locate the active subscription ────────────────────────────────────
    let subscriptionId: string | null = profile.stripe_subscription_id || null;

    if (!subscriptionId) {
      // Older subscribers may not have stripe_subscription_id stored — look it up
      const subs = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status:   'active',
        limit:    1,
      });
      if (subs.data.length === 0) {
        return new Response(JSON.stringify({ error: 'No active Stripe subscription found' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      subscriptionId = subs.data[0].id;
    }

    // ── 6. Retrieve subscription to inspect current price ────────────────────
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item         = subscription.items.data[0];

    if (!item) {
      return new Response(JSON.stringify({ error: 'Subscription has no items' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Already on the correct price — just sync the plan label and return
    if (item.price.id === newPriceId) {
      await supabase.from('profiles').update({ subscription_plan: app }).eq('id', user.id);
      return new Response(JSON.stringify({ success: true, plan: app }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 7. Swap the price in place ────────────────────────────────────────────
    // proration_behavior: 'create_prorations' charges/credits the difference on
    // the next invoice — no immediate charge, clean billing history.
    await stripe.subscriptions.update(subscriptionId, {
      items:               [{ id: item.id, price: newPriceId }],
      proration_behavior:  'create_prorations',
    });

    // ── 8. Update plan label in Supabase ──────────────────────────────────────
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ subscription_plan: app })
      .eq('id', user.id);

    if (updateError) console.error('[Veriqo] upgrade plan update error:', updateError.message);

    return new Response(JSON.stringify({ success: true, plan: app }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Veriqo] upgrade-subscription error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
