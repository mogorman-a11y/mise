// supabase/functions/delete-account/index.ts v1
// ──────────────────────────────────────────────
// Permanently deletes the calling user's account:
//   1. Cancels active Stripe subscription immediately (if any)
//   2. Deletes all user-owned rows across every public table
//   3. Deletes the auth.users row (cascades any remaining FKs)
//
// Called by vqDeleteAccount() in app.html with Authorization: Bearer <token>

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://getveriqo.co.uk',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  // ── 1. Verify JWT ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return json({ error: 'Invalid or expired session' }, 401);

  const uid = user.id;

  // ── 2. Cancel Stripe subscription if active ───────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_subscription_id, stripe_customer_id')
    .eq('id', uid)
    .single();

  const stripeSubId = (profile as { stripe_subscription_id?: string } | null)?.stripe_subscription_id;

  if (stripeSubId) {
    try {
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
        apiVersion: '2024-04-10',
        httpClient: Stripe.createFetchHttpClient(),
      });
      await stripe.subscriptions.cancel(stripeSubId);
    } catch (e) {
      // Log but don't abort — sub may already be cancelled
      console.error('Stripe cancel error:', e);
    }
  }

  // ── 3. Delete all user-owned data ─────────────────────────────────────────
  // Order matters: resolve circular FK (profiles.kitchen_id ↔ kitchens.owner_user_id)
  // by nulling profiles.kitchen_id before deleting kitchens.

  const tables: Array<{ table: string; col: string }> = [
    { table: 'attachments',          col: 'user_id' },
    { table: 'business_settings',    col: 'user_id' },
    { table: 'client_intake_tokens', col: 'owner_user_id' },
    { table: 'clients',              col: 'user_id' },
    { table: 'costings',             col: 'user_id' },
    { table: 'dishes',               col: 'user_id' },
    { table: 'expenses',             col: 'user_id' },
    { table: 'freelancer_access',    col: 'owner_user_id' },
    { table: 'haccp_records',        col: 'user_id' },
    { table: 'invoice_items',        col: 'user_id' },
    { table: 'invoices',             col: 'user_id' },
    { table: 'job_menus',            col: 'user_id' },
    { table: 'jobs',                 col: 'user_id' },
    { table: 'kitchen_members',      col: 'user_id' },
    { table: 'menu_dishes',          col: 'user_id' },
    { table: 'menus',                col: 'user_id' },
    { table: 'mileage',              col: 'user_id' },
    { table: 'mise_records',         col: 'user_id' },
    { table: 'mise_settings',        col: 'id' },
    { table: 'payments',             col: 'user_id' },
    { table: 'push_subscriptions',   col: 'user_id' },
    { table: 'quotes',               col: 'user_id' },
    { table: 'settings',             col: 'id' },
    { table: 'staff',                col: 'user_id' },
    { table: 'tax_categories',       col: 'user_id' },
  ];

  for (const { table, col } of tables) {
    const { error } = await supabase.from(table).delete().eq(col, uid);
    if (error) console.error(`Delete ${table}:`, error.message);
  }

  // Break circular FK, then delete owned kitchens and their members
  await supabase.from('profiles').update({ kitchen_id: null }).eq('id', uid);

  const { data: kitchens } = await supabase
    .from('kitchens')
    .select('id')
    .eq('owner_user_id', uid);

  if (kitchens && kitchens.length > 0) {
    const kitchenIds = kitchens.map((k: { id: string }) => k.id);
    await supabase.from('kitchen_members').delete().in('kitchen_id', kitchenIds);
    await supabase.from('kitchens').delete().in('id', kitchenIds);
  }

  // Delete profile row
  await supabase.from('profiles').delete().eq('id', uid);

  // ── 4. Delete auth user ───────────────────────────────────────────────────
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(uid);
  if (deleteErr) {
    console.error('auth.admin.deleteUser:', deleteErr.message);
    return json({ error: 'Failed to delete account. Please contact support.' }, 500);
  }

  return json({ ok: true });
});
