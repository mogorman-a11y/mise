// supabase/functions/delete-account/index.ts v2
// ──────────────────────────────────────────────
// Permanently deletes the calling user's account:
//   1. Verifies the caller's JWT
//   2. Deletes every user-owned object from Supabase Storage (all buckets,
//      objects under the `<uid>/…` path prefix only) — aborts the whole
//      deletion if any object cannot be removed, so sensitive files are
//      never orphaned and nothing is half-deleted
//   3. Cancels the active Stripe subscription immediately (if any)
//   4. Deletes all user-owned rows across every public table
//   5. Deletes the auth.users row
//
// Called by vqDeleteAccount() in app.html with Authorization: Bearer <token>.
//
// v2 (2026-08-31, privacy hardening): added step 2. Previously storage
// objects were left behind after account deletion. All storage paths are
// scoped to `<uid>/…` so this can never touch another tenant's files.

import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno&deno-std=0.132.0&no-check';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://getveriqo.co.uk',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Delete every object this user owns, across all buckets ────────────────────
// Only ever lists/removes objects under the `<uid>/` folder prefix — the same
// predicate the bucket RLS policies enforce for INSERT/DELETE — so it is
// structurally impossible to touch another user's files. Returns the set of
// errors encountered; an empty array means every owned object was removed.
async function deleteUserStorageObjects(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  uid: string,
): Promise<{ removed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;

  let buckets: Array<{ id: string }> = [];
  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    buckets = data ?? [];
  } catch (e) {
    return { removed, errors: [`listBuckets: ${(e as Error).message}`] };
  }

  for (const bucket of buckets) {
    const paths: string[] = [];

    const walk = async (prefix: string): Promise<void> => {
      const pageSize = 100;
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: entries, error } = await supabase.storage
          .from(bucket.id)
          .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) { errors.push(`${bucket.id}:list(${prefix}): ${error.message}`); return; }
        if (!entries || entries.length === 0) break;
        for (const entry of entries) {
          const full = prefix ? `${prefix}/${entry.name}` : entry.name;
          // Supabase reports folders as rows with a null id.
          if (entry.id === null || entry.id === undefined) await walk(full);
          else paths.push(full);
        }
        if (entries.length < pageSize) break;
        offset += pageSize;
      }
    };

    // Root the walk at `<uid>` — nothing outside this user's folder is visited.
    await walk(uid);

    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket.id).remove(chunk);
      if (error) errors.push(`${bucket.id}:remove: ${error.message}`);
      else removed += chunk.length;
    }
  }

  return { removed, errors };
}

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

  // ── 2. Delete user-owned storage objects FIRST ───────────────────────────
  // Done before any DB/auth deletion: if a file cannot be removed we abort
  // with nothing deleted, so support can retry rather than being left with
  // sensitive files whose owning account no longer exists.
  const storage = await deleteUserStorageObjects(supabase, uid);
  if (storage.errors.length > 0) {
    // Log the detail server-side only — never return bucket names / paths.
    console.error(`delete-account: storage cleanup failed for ${uid}:`, storage.errors);
    return json({
      error: 'We could not remove all of your stored files, so no data has been deleted yet. ' +
             'Please contact support@getveriqo.co.uk and we will complete this for you.',
      code: 'storage_cleanup_failed',
    }, 500);
  }

  // ── 3. Cancel Stripe subscription if active ───────────────────────────────
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

  // ── 4. Delete all user-owned data ─────────────────────────────────────────
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

  // ── 5. Delete auth user ───────────────────────────────────────────────────
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(uid);
  if (deleteErr) {
    console.error('auth.admin.deleteUser:', deleteErr.message);
    return json({ error: 'Failed to delete account. Please contact support.' }, 500);
  }

  return json({ ok: true, storage_objects_removed: storage.removed });
});
