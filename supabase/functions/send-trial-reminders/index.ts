// supabase/functions/send-trial-reminders/index.ts
// Sends trial expiry reminder emails via Resend.
// Run daily via pg_cron — emails users whose trial ends in 3 days or 1 day.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM       = 'Veriqo <hello@getveriqo.co.uk>';
const APP_URL    = 'https://getveriqo.co.uk';

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const results: string[] = [];

  for (const daysLeft of [3, 1]) {
    const target  = new Date();
    target.setDate(target.getDate() + daysLeft);
    const dateStr = target.toISOString().split('T')[0];

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, business_name, chef_name')
      .eq('subscription_status', 'trial')
      .gte('trial_ends_at', dateStr + 'T00:00:00.000Z')
      .lt('trial_ends_at',  dateStr + 'T23:59:59.999Z');

    if (error) {
      console.error(`[Veriqo] Error fetching profiles for ${daysLeft}d:`, error.message);
      continue;
    }

    for (const profile of profiles ?? []) {
      const { data: { user }, error: authErr } = await supabase.auth.admin.getUserById(profile.id);
      if (authErr || !user?.email) continue;

      const firstName = (profile.chef_name || profile.business_name || '').split(' ')[0] || '';

      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    FROM,
          to:      user.email,
          subject: daysLeft === 1
            ? 'Your Veriqo trial ends tomorrow'
            : 'Your Veriqo trial ends in 3 days',
          html: buildEmail(daysLeft, firstName),
        }),
      });

      const label = `${user.email} (${daysLeft}d)`;
      if (res.ok) {
        results.push(`sent: ${label}`);
        console.log(`[Veriqo] Sent → ${label}`);
      } else {
        const err = await res.json().catch(() => ({}));
        results.push(`failed: ${label} — ${JSON.stringify(err)}`);
        console.error(`[Veriqo] Failed → ${label}`, err);
      }
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function buildEmail(daysLeft: number, firstName: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  const isLastDay = daysLeft === 1;

  const headline = isLastDay
    ? 'Your free trial ends tomorrow'
    : 'Your free trial ends in 3 days';

  const body = isLastDay
    ? `Tomorrow your Veriqo trial comes to an end. Subscribe today to keep your food safety records, temperature logs, and PDF exports without any interruption — and stay inspection-ready every day.`
    : `Your Veriqo free trial ends in 3 days. It only takes a minute to subscribe and keep everything running smoothly — your records, your logs, your compliance.`;

  const urgencyColour = isLastDay ? '#b91c1c' : '#2D7A3A';
  const urgencyBg     = isLastDay ? '#fef2f2' : '#f0f8f1';
  const urgencyText   = isLastDay ? '⏰ Trial ends tomorrow' : '📅 3 days remaining on your trial';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;padding:0 16px">

    <!-- Logo -->
    <div style="padding:24px 0 20px;text-align:left">
      <span style="font-size:22px;font-weight:800;color:#1a1a18;letter-spacing:-0.5px">Veri<span style="color:#2D7A3A">qo</span></span>
    </div>

    <!-- Card -->
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.07)">

      <!-- Top accent -->
      <div style="height:4px;background:#2D7A3A"></div>

      <div style="padding:32px">

        <!-- Urgency badge -->
        <div style="display:inline-block;background:${urgencyBg};color:${urgencyColour};font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;margin-bottom:20px;letter-spacing:0.02em">${urgencyText}</div>

        <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#1a1a18;letter-spacing:-0.4px">${headline}</h1>

        <p style="margin:0 0 8px;font-size:15px;color:#1a1a18;font-weight:500">${greeting}</p>
        <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.65">${body}</p>

        <!-- Features -->
        <div style="background:#f5f4f0;border-radius:10px;padding:16px 20px;margin-bottom:28px">
          <div style="font-size:13px;color:#1a1a18;font-weight:600;margin-bottom:10px">Everything included on your trial:</div>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:4px 0;font-size:13px;color:#555;line-height:1.5">🌡️&nbsp; Temperature &amp; fridge logs</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#555;line-height:1.5">✅&nbsp; Opening, closing &amp; compliance checks</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#555;line-height:1.5">🚚&nbsp; Delivery &amp; cleaning records</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#555;line-height:1.5">📄&nbsp; PDF exports ready for inspection</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#555;line-height:1.5">📋&nbsp; Menus, dishes &amp; allergen tracking</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#555;line-height:1.5">💰&nbsp; Food costing &amp; GP% calculator</td></tr>
          </table>
        </div>

        <!-- CTA -->
        <a href="${APP_URL}/app" style="display:block;text-align:center;background:#2D7A3A;color:#ffffff;text-decoration:none;padding:16px 24px;border-radius:12px;font-size:16px;font-weight:700;letter-spacing:-0.2px">Keep my account — from £7/month →</a>

        <p style="margin:14px 0 0;font-size:12px;color:#aaa;text-align:center">HACCP £7/mo &nbsp;·&nbsp; Pro £15/mo (full app) &nbsp;·&nbsp; Annual plans save 2 months</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:20px 0;font-size:12px;color:#bbb;text-align:center;line-height:1.8">
      Veriqo &nbsp;·&nbsp; <a href="${APP_URL}" style="color:#bbb;text-decoration:none">getveriqo.co.uk</a><br>
      You're receiving this because your trial is ending soon.
    </div>
  </div>
</body>
</html>`;
}
