// api/feature-blast.js — one-shot broadcast to all users
// Sends a feature announcement + CHEF20 discount email to every user with a profile.
// Secured by CRON_SECRET so it can only be triggered intentionally.
//
// Trigger once via:
//   curl -X POST https://getveriqo.co.uk/api/feature-blast \
//     -H "Authorization: Bearer YOUR_CRON_SECRET"
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, CRON_SECRET

const { createClient } = require('@supabase/supabase-js');

const APP_VERIQO = 'https://getveriqo.co.uk/app';
const APP_CARTE  = 'https://getveriqo.co.uk/mise';

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Pull all auth users for email lookup
  const { data: { users }, error: usersErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) {
    console.error('[feature-blast] listUsers error:', usersErr.message);
    return res.status(500).json({ error: usersErr.message });
  }
  const emailMap = {};
  users.forEach(u => { emailMap[u.id] = u.email; });

  // Pull all profiles for name
  const { data: profiles, error: profilesErr } = await supabase
    .from('profiles')
    .select('id, chef_name, business_name, email_opt_out')
    .eq('email_opt_out', false);
  if (profilesErr) {
    console.error('[feature-blast] profiles error:', profilesErr.message);
    return res.status(500).json({ error: profilesErr.message });
  }

  const results = { sent: 0, errors: 0, skipped: 0 };

  for (const profile of profiles || []) {
    const email = emailMap[profile.id];
    if (!email) { results.skipped++; continue; }

    const name = profile.chef_name || profile.business_name || null;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    'Veriqo + Carte <hello@getveriqo.co.uk>',
          to:      [email],
          subject: "What's new in your suite — plus 20% off annual",
          html:    _buildBlast(name, profile.id),
        }),
      });

      if (!r.ok) throw new Error('Resend ' + r.status + ': ' + await r.text());
      results.sent++;
    } catch (err) {
      console.error('[feature-blast] send error (' + profile.id + '):', err.message);
      results.errors++;
    }

    // Resend rate limit: max 5/sec — 250ms keeps us safely under
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('[feature-blast] done —', JSON.stringify(results));
  return res.status(200).json(results);
};

// ─── Email template ────────────────────────────────────────────────────────────

function _hi(name) {
  return name ? 'Hi ' + name + ',' : 'Hi there,';
}

function _p(text) {
  return `<p style="margin:0 0 18px;font-size:15px;color:#5A544E;line-height:1.65">${text}</p>`;
}

function _btn(url, label, primary) {
  if (primary !== false) {
    return `<a href="${url}" style="display:block;background:#C8A96E;color:#1C2B1E;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.2px;margin-top:22px">${label}</a>`;
  }
  return `<a href="${url}" style="display:block;background:#1C2B1E;color:#F5F0E8;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:-0.2px;margin-top:10px">${label}</a>`;
}

function _buildBlast(name, uid) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Your suite just got bigger</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">New features + 20% off annual plans</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p("We've been building. Here's what's new across Veriqo, Carte, and the suite — plus a limited discount to say thank you.")}

    <!-- Yield coming soon -->
    <div style="background:#1C2B1E;border-radius:14px;padding:20px 22px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#C8A96E;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px">&#x1F4B7;&nbsp; Coming soon</div>
      <div style="font-size:19px;font-weight:700;color:#F5F0E8;line-height:1.25;margin-bottom:8px">Yield — the finance app for private chefs</div>
      <div style="font-size:14px;color:rgba(245,240,232,0.75);line-height:1.6;margin-bottom:14px">
        The third app in the suite is almost ready. Yield will let you cost jobs properly, send quotes, raise invoices, and track payments — all built around the same clients and menus you already use in Carte. Suite subscribers get it included at no extra cost when it launches.
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48%" style="background:rgba(200,169,110,0.12);border-radius:10px;padding:12px 14px;vertical-align:top">
            <div style="font-size:12px;font-weight:700;color:#C8A96E;margin-bottom:6px">&#x1F4CA; Costing</div>
            <div style="font-size:12px;color:rgba(245,240,232,0.7);line-height:1.5">Ingredients, covers &amp; hours → a recommended quote price with live food cost %.</div>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:rgba(200,169,110,0.12);border-radius:10px;padding:12px 14px;vertical-align:top">
            <div style="font-size:12px;font-weight:700;color:#C8A96E;margin-bottom:6px">&#x1F4CB; Quotes &amp; invoices</div>
            <div style="font-size:12px;color:rgba(245,240,232,0.7);line-height:1.5">Accept a quote and deposit + balance invoices generate automatically.</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Cross-app sync -->
    <div style="background:#F5F4F0;border-radius:14px;padding:20px 22px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#2D7A3A;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px">&#x1F501;&nbsp; Cross-app sync</div>
      <div style="font-size:17px;font-weight:700;color:#1C2B1E;line-height:1.3;margin-bottom:8px">Your dish library now works across all three apps</div>
      <div style="font-size:14px;color:#5A544E;line-height:1.6">Add a dish or menu once in Carte and it's automatically available in Veriqo for allergen tracking — and ready for Yield when it launches. One source of truth, everywhere.</div>
    </div>

    <!-- Next booking banner -->
    <div style="background:#F5F4F0;border-radius:14px;padding:20px 22px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:#2D7A3A;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:10px">&#x1F4C5;&nbsp; Veriqo update</div>
      <div style="font-size:17px;font-weight:700;color:#1C2B1E;line-height:1.3;margin-bottom:8px">Your next booking now shows at the top of Veriqo</div>
      <div style="font-size:14px;color:#5A544E;line-height:1.6">Book a job in Carte and a banner appears automatically in Veriqo — date, client, covers, location, and the menus attached. Tap it to see the full detail. No double entry.</div>
    </div>

    <!-- CHEF20 offer -->
    <div style="border:2px solid #C8A96E;border-radius:14px;padding:22px;margin-bottom:8px;text-align:center">
      <div style="font-size:12px;font-weight:700;color:#C8A96E;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px">Limited offer</div>
      <div style="font-size:22px;font-weight:700;color:#1C2B1E;margin-bottom:6px">20% off any annual plan</div>
      <div style="font-size:14px;color:#5A544E;margin-bottom:16px">Use code <strong style="color:#1C2B1E;letter-spacing:0.5px">CHEF20</strong> at checkout. Annual plans already save you 2 months — this takes another 20% off on top.</div>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border-collapse:separate;border-spacing:0 6px">
        <tr>
          <td style="background:#F5F4F0;border-radius:10px;padding:12px 14px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:14px;color:#1C2B1E;font-weight:600">Veriqo or Carte</td>
              <td style="text-align:right">
                <span style="font-size:12px;color:#aaa;text-decoration:line-through;margin-right:6px">£120/yr</span>
                <span style="font-size:16px;font-weight:700;color:#1C2B1E">£96/yr</span>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#1C2B1E;border-radius:10px;padding:12px 14px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:14px;color:#C8A96E;font-weight:700">&#x2605; Suite <span style="font-size:12px;font-weight:400;color:rgba(200,169,110,0.7)">(Veriqo + Carte)</span></td>
              <td style="text-align:right">
                <span style="font-size:12px;color:rgba(245,240,232,0.4);text-decoration:line-through;margin-right:6px">£200/yr</span>
                <span style="font-size:16px;font-weight:700;color:#F5F0E8">£160/yr</span>
              </td>
            </tr></table>
          </td>
        </tr>
      </table>

      <div style="background:#1C2B1E;color:#F5F0E8;font-size:20px;font-weight:700;letter-spacing:2px;padding:14px 20px;border-radius:10px;display:inline-block">CHEF20</div>
      <div style="font-size:12px;color:#A09890;margin-top:10px">Enter this code at checkout · Annual plans only</div>
    </div>

    ${_btn(APP_VERIQO, 'Go to app and subscribe &rarr;')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>What's new in your suite</title></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <div style="background:#1C2B1E;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    ${header}
  </div>

  <div style="background:#ffffff;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E2DDD5;border-top:0">
    ${body}
  </div>

  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:14px">Questions? Just reply to this email — we read everything.</p>
  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:6px">
    Veriqo + Carte &middot; <a href="https://getveriqo.co.uk" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>
  ${uid ? `<p style="text-align:center;font-size:11px;color:#C0B8B0;margin-top:6px">Don't want these emails? <a href="https://getveriqo.co.uk/api/unsubscribe?uid=${uid}" style="color:#C0B8B0;">Unsubscribe</a></p>` : ''}

</div>
</body>
</html>`;
}
