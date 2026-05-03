// api/trial-emails.js — Vercel cron, 09:00 UTC daily
// Sends trial lifecycle emails at days 1, 5, 10, and 13 of a 14-day trial.
//
// Bucketing: "day N" = user whose trial_ends_at falls on (today + remaining_days).
//   Day 1  → trial_ends_at on today + 13  (13 days left)
//   Day 5  → trial_ends_at on today + 9   (9 days left)
//   Day 10 → trial_ends_at on today + 4   (4 days left)
//   Day 13 → trial_ends_at on today + 1   (1 day left)
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, CRON_SECRET

const { createClient } = require('@supabase/supabase-js');

const APP_VERIQO = 'https://getveriqo.co.uk/app';
const APP_CARTE  = 'https://getveriqo.co.uk/mise';

// days remaining on trial_ends_at for each email
const BUCKETS = {
  day1:  13,
  day5:  9,
  day10: 4,
  day13: 1,
};

module.exports = async function handler(req, res) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Load all user emails once
  const { data: { users }, error: usersErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) {
    console.error('[trial-emails] listUsers error:', usersErr.message);
    return res.status(500).json({ error: usersErr.message });
  }
  const emailMap = {};
  users.forEach(u => { emailMap[u.id] = u.email; });

  const results = { sent: 0, errors: 0, detail: [] };

  for (const [type, daysLeft] of Object.entries(BUCKETS)) {
    const lo = _dayStart(daysLeft);
    const hi = _dayStart(daysLeft + 1);

    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id, chef_name, business_name')
      .eq('subscription_status', 'trial')
      .gte('trial_ends_at', lo)
      .lt('trial_ends_at', hi);

    if (profilesErr) {
      console.error(`[trial-emails] query error (${type}):`, profilesErr.message);
      results.errors++;
      continue;
    }

    for (const profile of profiles || []) {
      const email = emailMap[profile.id];
      if (!email) continue;

      const name = profile.chef_name || profile.business_name || null;
      try {
        await _send(email, name, type);
        results.sent++;
        results.detail.push({ type, email });
      } catch (err) {
        console.error(`[trial-emails] send error (${type}, ${profile.id}):`, err.message);
        results.errors++;
      }
    }
  }

  console.log(`[trial-emails] done — sent:${results.sent} errors:${results.errors}`);
  return res.status(200).json({ sent: results.sent, errors: results.errors });
};

// Returns the ISO timestamp for midnight UTC of (today + n days)
function _dayStart(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function _send(to, name, type) {
  const subjects = {
    day1:  'Your Veriqo + Carte trial starts now',
    day5:  'Something cool happens when you book a job in Carte',
    day10: 'The third app is coming — here\'s what to expect',
    day13: 'Your trial ends tomorrow',
  };
  const builders = { day1: _day1, day5: _day5, day10: _day10, day13: _day13 };

  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'Veriqo + Carte <hello@getveriqo.co.uk>',
      to:      [to],
      subject: subjects[type],
      html:    builders[type](name),
    }),
  });

  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + await r.text());
}

// ─── Shared layout helpers ───────────────────────────────────────────────────

function _hi(name) {
  return name ? 'Hi ' + name + ',' : 'Hi there,';
}

function _wrap(header, body, footer) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veriqo + Carte</title></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <div style="background:#1C2B1E;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    ${header}
  </div>

  <div style="background:#ffffff;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E2DDD5;border-top:0">
    ${body}
  </div>

  ${footer ? `<p style="text-align:center;font-size:12px;color:#A09890;margin-top:14px">${footer}</p>` : ''}
  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:6px">
    Veriqo + Carte &middot; <a href="https://getveriqo.co.uk" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>

</div>
</body>
</html>`;
}

function _btn(url, label, primary) {
  if (primary !== false) {
    return `<a href="${url}" style="display:block;background:#C8A96E;color:#1C2B1E;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.2px;margin-top:22px">${label}</a>`;
  }
  return `<a href="${url}" style="display:block;background:#1C2B1E;color:#F5F0E8;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:-0.2px;margin-top:10px">${label}</a>`;
}

function _p(text) {
  return `<p style="margin:0 0 18px;font-size:15px;color:#5A544E;line-height:1.65">${text}</p>`;
}

// ─── Day 1: Welcome to the Suite ────────────────────────────────────────────

function _day1(name) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Welcome to your 14-day trial</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Veriqo + Carte Suite</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('You now have full access to both apps for the next 14 days. Here\'s the simplest way to think about them:')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-spacing:0">
      <tr>
        <td width="49%" style="background:#F5F4F0;border-radius:12px;padding:16px;vertical-align:top">
          <div style="font-size:12px;font-weight:700;color:#2D7A3A;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">&#x1F6E1;&#xFE0F; Veriqo</div>
          <div style="font-size:20px;font-weight:700;color:#1a1a18;line-height:1.2;margin-bottom:8px">Am I<br>compliant?</div>
          <div style="font-size:13px;color:#666;line-height:1.5">HACCP temperature logs, checklists, allergen tracking &amp; PDF reports ready for inspection.</div>
        </td>
        <td width="2%"></td>
        <td width="49%" style="background:#1C2B1E;border-radius:12px;padding:16px;vertical-align:top">
          <div style="font-size:12px;font-weight:700;color:#C8A96E;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px">&#x2726; Carte</div>
          <div style="font-size:20px;font-weight:700;color:#F5F0E8;line-height:1.2;margin-bottom:8px">Am I<br>organised?</div>
          <div style="font-size:13px;color:rgba(245,240,232,0.7);line-height:1.5">Clients, bookings, menus, jobs &amp; transport logs — all in one place.</div>
        </td>
      </tr>
    </table>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:8px">
      <div style="font-size:14px;font-weight:700;color:#15803d;margin-bottom:5px">The best place to start: your dish library</div>
      <div style="font-size:13px;color:#5A544E;line-height:1.55">Add your dishes once in Carte and they're automatically available in Veriqo too. Your menus follow you across both apps — set it up once, use it everywhere.</div>
    </div>

    ${_btn(APP_CARTE, 'Set up your dish library in Carte &rarr;')}
    ${_btn(APP_VERIQO, 'Or open Veriqo to start logging &rarr;', false)}`;

  return _wrap(header, body, 'Questions? Just reply to this email — we read everything.');
}

// ─── Day 5: The Cross-App Magic ──────────────────────────────────────────────

function _day5(name) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Your apps talk to each other</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Day 5 of your trial</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('Veriqo and Carte share the same data layer. Changes in one app show up in the other — automatically, in real time. Here\'s the best example of that in action.')}

    <div style="border-left:3px solid #C8A96E;padding:2px 0 2px 16px;margin-bottom:20px">
      <div style="font-size:15px;font-weight:700;color:#1C2B1E;margin-bottom:6px">The Next Booking banner</div>
      <div style="font-size:14px;color:#5A544E;line-height:1.6">When you book a job in Carte, a banner appears automatically at the top of your Veriqo dashboard — showing the date, client name, covers, location, and the menus you've attached. Tap it to see the full detail.</div>
    </div>

    <div style="background:#F5F4F0;border-radius:12px;padding:18px 20px;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;color:#1a1a18;margin-bottom:12px">Try it now — takes two minutes</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="32" style="vertical-align:top;padding-top:2px">
            <div style="background:#C8A96E;color:#1C2B1E;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;display:inline-block">1</div>
          </td>
          <td style="font-size:13px;color:#5A544E;line-height:1.5;padding-bottom:10px">
            Open Carte and book a test job — any future date, any details.
          </td>
        </tr>
        <tr>
          <td width="32" style="vertical-align:top;padding-top:2px">
            <div style="background:#2D7A3A;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;display:inline-block">2</div>
          </td>
          <td style="font-size:13px;color:#5A544E;line-height:1.5">
            Switch to Veriqo. Your booking banner will be waiting at the top of the dashboard.
          </td>
        </tr>
      </table>
    </div>

    ${_btn(APP_CARTE, 'Book a test job in Carte &rarr;')}
    ${_btn(APP_VERIQO, 'Then open Veriqo to see it appear &rarr;', false)}`;

  return _wrap(header, body, null);
}

// ─── Day 10: The Finance Tease (FOMO) ────────────────────────────────────────

function _day10(name) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">The third app is coming</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Day 10 of your trial</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('Your suite is built around three questions. Right now you have access to the first two.')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:separate;border-spacing:0 8px">
      <tr>
        <td style="background:#f0fdf4;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="font-size:22px;vertical-align:middle">&#x1F6E1;&#xFE0F;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#1C2B1E">Veriqo &mdash; Am I compliant?</div>
              <div style="font-size:13px;color:#5A544E;margin-top:2px">HACCP records, temperature logs, inspection-ready reports.</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="background:#F5F4F0;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="font-size:22px;vertical-align:middle">&#x2726;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#1C2B1E">Carte &mdash; Am I organised?</div>
              <div style="font-size:13px;color:#5A544E;margin-top:2px">Clients, bookings, menus, jobs, transport logs.</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="background:#1C2B1E;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="font-size:22px;vertical-align:middle">&#x1F4B7;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#C8A96E">Finance &mdash; Am I paid and profitable?</div>
              <div style="font-size:13px;color:rgba(245,240,232,0.7);margin-top:2px">Invoices, expenses, mileage &amp; P&amp;L — built on the same client and job data. <span style="color:#C8A96E;font-weight:600">Coming soon.</span></div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    ${_p('When Finance launches, Suite subscribers get it included — same price, no changes. If you\'re on the Suite at £20/month when it goes live, Finance is yours.')}
    ${_p('That\'s two months of trial left to decide. But locking in your Suite plan now means you\'re covered the moment Finance ships.')}

    ${_btn(APP_VERIQO, 'Continue with the Suite &rarr;')}`;

  return _wrap(header, body, '4 days left in your trial.');
}

// ─── Day 13: The Expiration Warning ──────────────────────────────────────────

function _day13(name) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Your trial ends tomorrow</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Day 13 of your trial</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('Your 14-day trial expires in 24 hours. Here\'s exactly what each option costs:')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:separate;border-spacing:6px 0">
      <tr>
        <td style="background:#F5F4F0;border-radius:12px;padding:16px 10px;text-align:center;vertical-align:top" width="32%">
          <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Veriqo only</div>
          <div style="font-size:26px;font-weight:700;color:#1a1a18;line-height:1">£12</div>
          <div style="font-size:12px;color:#888;margin-top:3px">per month</div>
          <div style="font-size:11px;color:#aaa;margin-top:8px;line-height:1.4">HACCP compliance only</div>
        </td>
        <td style="background:#F5F4F0;border-radius:12px;padding:16px 10px;text-align:center;vertical-align:top" width="32%">
          <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Carte only</div>
          <div style="font-size:26px;font-weight:700;color:#1a1a18;line-height:1">£12</div>
          <div style="font-size:12px;color:#888;margin-top:3px">per month</div>
          <div style="font-size:11px;color:#aaa;margin-top:8px;line-height:1.4">Business management only</div>
        </td>
        <td style="background:#1C2B1E;border-radius:12px;padding:16px 10px;text-align:center;vertical-align:top" width="36%">
          <div style="font-size:11px;font-weight:700;color:#C8A96E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">&#x2605; Suite</div>
          <div style="font-size:26px;font-weight:700;color:#F5F0E8;line-height:1">£20</div>
          <div style="font-size:12px;color:rgba(245,240,232,0.6);margin-top:3px">per month</div>
          <div style="font-size:11px;color:#C8A96E;margin-top:8px;line-height:1.4">Both apps + Finance (coming soon)</div>
        </td>
      </tr>
    </table>

    ${_p('The Suite costs £8 more than a single app and gives you both — plus Finance when it launches, included at no extra cost.')}
    ${_p('To subscribe, open the app and tap <strong style="color:#1C2B1E">Subscribe</strong> on the paywall. Annual plans are available at checkout (2 months free).')}

    ${_btn(APP_VERIQO, 'Open Veriqo to subscribe &rarr;')}
    ${_btn(APP_CARTE, 'Or open Carte to subscribe &rarr;', false)}`;

  return _wrap(header, body, 'Annual plans give you 2 months free — available at checkout.');
}
