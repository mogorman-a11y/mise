// supabase/functions/send-push-notifications/index.ts
// ─────────────────────────────────────────────────────
// Sends daily push reminders to all subscribed users.
// Called by pg_cron at 9am UTC (morning) and 17:30 UTC (closing).
//
// Secrets required:
//   VAPID_PUBLIC_KEY   — base64url-encoded P-256 public key
//   VAPID_PRIVATE_KEY  — base64url-encoded P-256 private key
//
// Invocation body: { "type": "morning" } or { "type": "closing" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const type = body.type || 'morning';

    // ── Configure VAPID ────────────────────────────────────────────────────
    webpush.setVapidDetails(
      'mailto:hello@getveriqo.co.uk',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    // ── Pick notification content ──────────────────────────────────────────
    const notifications: Record<string, { title: string; body: string; tag: string }> = {
      morning: {
        title: 'Veriqo — Morning checks',
        body:  '🌡️ Log your fridge temps and opening checks before service starts.',
        tag:   'veriqo-morning',
      },
      closing: {
        title: 'Veriqo — Closing checks',
        body:  '🌙 Don\'t forget your closing checks and cleaning sign-off before you leave.',
        tag:   'veriqo-closing',
      },
    };
    const payload = notifications[type] ?? notifications.morning;

    // ── Fetch all push subscriptions ───────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Only send to users with active or in-trial subscriptions
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, subscription, user_id, profiles!inner(subscription_status, trial_ends_at)')
      .in('profiles.subscription_status', ['active', 'trial']);

    if (error) throw error;
    if (!subs || !subs.length) {
      return new Response(JSON.stringify({ sent: 0, message: 'No subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Filter trial users whose trial hasn't ended ────────────────────────
    const now = new Date();
    const eligible = subs.filter((s: any) => {
      const p = s.profiles;
      if (!p) return false;
      if (p.subscription_status === 'active') return true;
      if (p.subscription_status === 'trial') {
        return p.trial_ends_at ? new Date(p.trial_ends_at) > now : false;
      }
      return false;
    });

    // ── Send pushes ────────────────────────────────────────────────────────
    let sent = 0;
    const stale: string[] = []; // endpoints that are no longer valid

    await Promise.allSettled(eligible.map(async (s: any) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(payload));
        sent++;
      } catch (err: any) {
        // 410 Gone = subscription expired/unsubscribed — remove from DB
        if (err.statusCode === 410 || err.statusCode === 404) {
          stale.push(s.endpoint);
        } else {
          console.warn('[Veriqo] Push send error for endpoint', s.endpoint, err.message);
        }
      }
    }));

    // Clean up stale endpoints
    if (stale.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', stale);
      console.log('[Veriqo] Removed', stale.length, 'stale push subscriptions');
    }

    console.log(`[Veriqo] Sent ${type} push to ${sent}/${eligible.length} subscribers`);
    return new Response(JSON.stringify({ sent, total: eligible.length, stale: stale.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Veriqo] send-push-notifications error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
