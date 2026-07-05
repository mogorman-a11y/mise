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

// days remaining on trial_ends_at for each email
// day1 welcome is sent immediately on signup via api/welcome-email.js
const BUCKETS = {
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
      .select('id, chef_name, business_name, email_opt_out')
      .eq('subscription_status', 'trial')
      .eq('email_opt_out', false)
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
        await _send(email, name, type, profile.id);
        results.sent++;
        results.detail.push({ type, email });
      } catch (err) {
        console.error(`[trial-emails] send error (${type}, ${profile.id}):`, err.message);
        results.errors++;
      }
    }
  }

  const skSent = await _sendStarterKitEmails(supabase);
  console.log(`[trial-emails] done — sent:${results.sent} errors:${results.errors} sk-sent:${skSent}`);
  return res.status(200).json({ sent: results.sent, errors: results.errors, starterKitSent: skSent });
};

// Returns the ISO timestamp for midnight UTC of (today + n days)
function _dayStart(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function _send(to, name, type, uid) {
  const subjects = {
    day5:  'Something cool happens when you book a job',
    day10: 'Here\'s everything included in your trial',
    day13: 'Your trial ends tomorrow',
  };

  const builders = { day5: _day5, day10: _day10, day13: _day13 };

  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'Veriqo <hello@getveriqo.co.uk>',
      to:      [to],
      subject: subjects[type],
      html:    builders[type](name, uid),
    }),
  });

  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + await r.text());
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function _hi(name) {
  return name ? 'Hi ' + name + ',' : 'Hi there,';
}

function _wrap(header, body, footer, uid) {
  const unsubUrl = uid ? 'https://getveriqo.co.uk/api/unsubscribe?uid=' + uid : null;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veriqo</title></head>
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
    Veriqo &middot; <a href="https://getveriqo.co.uk" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>
  ${unsubUrl ? `<p style="text-align:center;font-size:11px;color:#C0B8B0;margin-top:6px">Don't want these emails? <a href="${unsubUrl}" style="color:#C0B8B0;">Unsubscribe</a></p>` : ''}

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

// ─── Trial lifecycle emails ───────────────────────────────────────────────────

function _day5(name, uid) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Your booking shows up automatically</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Day 5 of your trial</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('Every module in Veriqo shares the same data. Here\'s the best example of that in action.')}

    <div style="border-left:3px solid #C8A96E;padding:2px 0 2px 16px;margin-bottom:20px">
      <div style="font-size:15px;font-weight:700;color:#1C2B1E;margin-bottom:6px">The Next Booking banner</div>
      <div style="font-size:14px;color:#5A544E;line-height:1.6">When you book a job in Menus, a banner appears automatically at the top of your HACCP home screen — showing the date, client name, covers, location, and the menus you've attached. Tap it to see the full detail.</div>
    </div>

    <div style="background:#F5F4F0;border-radius:12px;padding:18px 20px;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;color:#1a1a18;margin-bottom:12px">Try it now — takes two minutes</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="32" style="vertical-align:top;padding-top:2px">
            <div style="background:#C8A96E;color:#1C2B1E;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;display:inline-block">1</div>
          </td>
          <td style="font-size:13px;color:#5A544E;line-height:1.5;padding-bottom:10px">
            Open Menus and book a test job — any future date, any details.
          </td>
        </tr>
        <tr>
          <td width="32" style="vertical-align:top;padding-top:2px">
            <div style="background:#2D7A3A;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;display:inline-block">2</div>
          </td>
          <td style="font-size:13px;color:#5A544E;line-height:1.5">
            Switch to HACCP. Your booking banner will be waiting at the top of the home screen.
          </td>
        </tr>
      </table>
    </div>

    ${_btn(APP_VERIQO, 'Open Veriqo &rarr;')}`;

  return _wrap(header, body, null, uid);
}

function _day10(name, uid) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Here's everything included</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Day 10 of your trial</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('Your trial gives you every module. Here\'s what each one answers.')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:separate;border-spacing:0 8px">
      <tr>
        <td style="background:#f0fdf4;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="font-size:22px;vertical-align:middle">&#x1F6E1;&#xFE0F;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#1C2B1E">HACCP &mdash; Am I compliant?</div>
              <div style="font-size:13px;color:#5A544E;margin-top:2px">Temperature logs, checklists, allergen tracking, inspection-ready reports.</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="background:#F5F4F0;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="font-size:22px;vertical-align:middle">&#x1F4C5;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#1C2B1E">Menus &mdash; Am I organised?</div>
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
              <div style="font-size:14px;font-weight:700;color:#C8A96E">Costing &mdash; Am I paid and profitable?</div>
              <div style="font-size:13px;color:rgba(245,240,232,0.7);margin-top:2px">Food cost %, quotes and margin, built on the same client and job data.</div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    ${_p('4 days left in your trial. Everything above is included in Veriqo Pro — one plan, no add-ons.')}

    ${_btn(APP_VERIQO, 'Continue exploring &rarr;')}`;

  return _wrap(header, body, '4 days left in your trial.', uid);
}

function _day13(name, uid) {
  const header = `
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">Your trial ends tomorrow</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Day 13 of your trial</div>`;

  const body = `
    ${_p(_hi(name))}
    ${_p('Your 14-day trial expires in 24 hours. Here\'s exactly what each plan costs:')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:separate;border-spacing:6px 0">
      <tr>
        <td style="background:#F5F4F0;border-radius:12px;padding:16px 10px;text-align:center;vertical-align:top" width="48%">
          <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">HACCP</div>
          <div style="font-size:26px;font-weight:700;color:#1a1a18;line-height:1">£7</div>
          <div style="font-size:12px;color:#888;margin-top:3px">per month</div>
          <div style="font-size:11px;color:#aaa;margin-top:8px;line-height:1.4">Compliance module only</div>
        </td>
        <td style="background:#1C2B1E;border-radius:12px;padding:16px 10px;text-align:center;vertical-align:top" width="52%">
          <div style="font-size:11px;font-weight:700;color:#C8A96E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">&#x2605; Pro</div>
          <div style="font-size:26px;font-weight:700;color:#F5F0E8;line-height:1">£15</div>
          <div style="font-size:12px;color:rgba(245,240,232,0.6);margin-top:3px">per month</div>
          <div style="font-size:11px;color:#C8A96E;margin-top:8px;line-height:1.4">Every module, shared data</div>
        </td>
      </tr>
    </table>

    ${_p('Pro costs £8 more than HACCP alone and includes bookings, menus and costing on top — no add-ons, no separate apps.')}
    ${_p('To subscribe, open the app and tap <strong style="color:#1C2B1E">Subscribe</strong> on the paywall. Annual plans are available at checkout (2 months free).')}

    ${_btn(APP_VERIQO, 'Open Veriqo to subscribe &rarr;')}`;

  return _wrap(header, body, 'Annual plans give you 2 months free — available at checkout.', uid);
}

// ─── Starter Kit — Days 2–7 ───────────────────────────────────────────────────

async function _sendStarterKitEmails(supabase) {
  let sent = 0;
  // Prevent cascade: if a lead's last_email_sent is updated mid-loop, later iterations
  // would immediately match them for the next day in the same cron run.
  const processedThisRun = new Set();
  const subjects = {
    2: 'The one number that decides if you make money',
    3: "The EHO inspection most private chefs aren't ready for",
    4: 'The first-inquiry script that doubles conversion',
    5: '3 event templates that run themselves',
    6: 'What £3k/month actually looks like',
    7: 'Chef to CEO — everything you need to go independent',
  };
  const builders = { 2: _skDay2, 3: _skDay3, 4: _skDay4, 5: _skDay5, 6: _skDay6, 7: _skDay7 };

  for (let day = 2; day <= 7; day++) {
    // Send to leads who: have received all previous emails AND signed up at least (day-1) days ago
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (day - 1));
    cutoff.setUTCHours(23, 59, 59, 999);

    const { data: leads, error } = await supabase
      .from('starter_kit_leads')
      .select('id, email, stage, events_per_month')
      .eq('email_opt_out', false)
      .eq('last_email_sent', day - 1)
      .lte('signed_up_at', cutoff.toISOString());

    if (error) {
      console.error(`[trial-emails] sk-day${day} query error:`, error.message);
      continue;
    }

    for (const lead of leads || []) {
      if (processedThisRun.has(lead.id)) continue;
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: "Michael O'Gorman <hello@getveriqo.co.uk>",
            to: [lead.email],
            subject: subjects[day],
            html: builders[day](lead.stage, lead.events_per_month, lead.id),
          }),
        });
        if (!r.ok) throw new Error('Resend ' + r.status + ': ' + await r.text());
        await supabase.from('starter_kit_leads').update({ last_email_sent: day }).eq('id', lead.id);
        processedThisRun.add(lead.id);
        sent++;
        console.log(`[trial-emails] sk-day${day} sent to`, lead.email);
      } catch (err) {
        console.error(`[trial-emails] sk-day${day} error for ${lead.email}:`, err.message);
      }
    }
  }
  return sent;
}

// ─── Shared helpers (duplicated from welcome-email.js — no shared imports) ────

function _skWrap(day, body, leadId) {
  const unsubUrl = 'https://getveriqo.co.uk/api/unsubscribe?uid=' + leadId + '&list=starter';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px 24px">
  <div style="background:#1E3A2F;border-radius:12px 12px 0 0;padding:18px 28px">
    <div style="font-size:11px;color:#C8922A;letter-spacing:0.1em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-weight:600">Day ${day} of 7 &middot; The Private Chef Operating System</div>
  </div>
  <div style="background:#ffffff;padding:32px 28px;border-radius:0 0 12px 12px;border:1px solid #E2DDD5;border-top:0">
    ${body}
  </div>
  <p style="text-align:center;font-size:12px;color:#9a9080;margin-top:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
    Michael O'Gorman &middot; Chef to CEO &nbsp;&middot;&nbsp;
    <a href="${unsubUrl}" style="color:#9a9080;text-decoration:underline">Unsubscribe</a>
  </p>
</div>
</body>
</html>`;
}
function _skP(t) { return `<p style="margin:0 0 18px;font-size:15px;color:#4A4438;line-height:1.75;font-family:Georgia,'Times New Roman',serif">${t}</p>`; }
function _skAction(t) { return `<div style="background:#F7F3EC;border-left:3px solid #C8922A;padding:14px 18px;margin:24px 0;border-radius:0 8px 8px 0"><div style="font-size:11px;font-weight:700;color:#C8922A;letter-spacing:0.1em;text-transform:uppercase;font-family:-apple-system,sans-serif;margin-bottom:6px">Today's action</div><p style="margin:0;font-size:14px;color:#4A4438;line-height:1.65;font-family:Georgia,serif">${t}</p></div>`; }
function _skPS(t) { return `<p style="margin:24px 0 0;font-size:13px;color:#6B6355;line-height:1.65;font-family:Georgia,'Times New Roman',serif;border-top:1px solid #E2DDD5;padding-top:20px">${t}</p>`; }
function _skBtn(url, label) { return `<a href="${url}" style="display:block;background:#1E3A2F;color:#F7F3EC;text-decoration:none;text-align:center;padding:16px 24px;border-radius:8px;font-size:15px;font-weight:700;margin-top:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif">${label}</a>`; }
function _skBtnGold(url, label) { return `<a href="${url}" style="display:block;background:#C8922A;color:#1E3A2F;text-decoration:none;text-align:center;padding:16px 24px;border-radius:8px;font-size:15px;font-weight:700;margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,sans-serif">${label}</a>`; }

// ─── Day 2 — Pricing ──────────────────────────────────────────────────────────

function _skDay2(stage, eventsPerMonth, leadId) {
  let opening;
  if (stage === 'established') {
    opening = _skP("I'd bet money you've never broken down your food cost % event-by-event over a quarter. Today's that exercise. Pick your last 5 events.");
  } else {
    opening = _skP("Yesterday I asked you what was hurting most. Whatever you said, today's email is the one that pays for itself.");
  }
  const body = `
    ${_skP('Hi there,')}
    ${opening}
    ${_skP("There's one number that decides whether a private chef makes money or just stays busy: <strong>food cost percentage.</strong>")}
    ${_skP("It's the cost of your ingredients as a percentage of what you charge per head. The professional benchmark is 28–32%. The private chef sector average is <strong>38–45%</strong>. That's 10–17 percentage points of margin most chefs are giving away because they price on gut feel.")}
    <div style="background:#F7F3EC;border-radius:8px;padding:18px 20px;margin:0 0 18px;font-family:Georgia,'Times New Roman',serif">
      <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:10px">Worked example — 6-course dinner for 8 guests:</div>
      <div style="font-size:14px;color:#4A4438;line-height:1.8">
        Ingredients cost you £160 total (£20 a head)<br>
        You charge £75/head → food cost is 27%. <strong style="color:#2D7A3A">Healthy.</strong><br>
        You charge £55/head → food cost is 36%. <em>Average. Leaking margin.</em><br>
        You charge £45/head → food cost is 44%. <strong style="color:#C0392B">You're cooking for free.</strong>
      </div>
    </div>
    ${_skP("The £75/head chef and the £45/head chef are doing the same work. One is running a business. The other is running a hobby that breaks even on a good month.")}
    ${_skAction("Pick your next event. Add up the ingredient cost. Divide by what you're charging per head. That's your food cost %. If it's over 32%, you're undercharging. By how much tells you the size of the problem.")}
    ${_skP('Tomorrow: the compliance system. Less sexy, more important.<br><br>Michael')}
    ${_skPS("P.S. If you're not sure your number is right, hit reply with the maths. I'll sense-check it.")}
  `;
  return _skWrap(2, body, leadId);
}

// ─── Day 3 — Compliance ───────────────────────────────────────────────────────

function _skDay3(stage, eventsPerMonth, leadId) {
  const body = `
    ${_skP('Hi there,')}
    ${_skP("<strong>EHOs do inspect private chefs.</strong>")}
    ${_skP("I hear this one constantly — \"I work out of my home kitchen, EHOs only inspect restaurants, I'm fine.\" Wrong. If you're cooking for paying clients, you're a food business. You register with your local authority. They schedule an inspection. They turn up.")}
    ${_skP("For private chefs cooking from a home kitchen, inspections are often booked in advance — they email or call to arrange a date. That's the good news. The bad news is most chefs use the notice period to scramble for paperwork that should already exist.")}
    ${_skP("When the EHO arrives, here's what they actually ask for:")}
    <ul style="margin:0 0 18px;padding-left:22px;font-size:14px;color:#4A4438;line-height:1.85;font-family:Georgia,'Times New Roman',serif">
      <li style="margin-bottom:4px"><strong>Temperature records</strong> — fridges, freezers, cooking, delivery, reheating. Last 3 months minimum.</li>
      <li style="margin-bottom:4px"><strong>Allergen matrix per event</strong> — every dish, against the UK 14 major allergens, with the client's declared allergies on file</li>
      <li style="margin-bottom:4px"><strong>Supplier register</strong> — name, delivery temperature on arrival, best-before, per delivery</li>
      <li style="margin-bottom:4px"><strong>Cleaning records</strong> — pre, during, post-event</li>
      <li style="margin-bottom:4px"><strong>HACCP records</strong> — timestamped, the same day they happened</li>
      <li><strong>Credentials</strong> — Food Safety Level 2 minimum, refreshed every 3 years</li>
    </ul>
    ${_skP("A 5-star rating is worth real money. Corporate clients filter for it. Venues check it. Insurance gets cheaper. A 2 or 3-star rating quietly costs you work for the next 18 months until they re-inspect.")}
    ${_skP("<strong>The problem with paper logs:</strong> The EHO asks for last month's reheating temperatures. You flip through three notebooks. One's in the kitchen, one's in the van, one's at a client's venue. The records existing isn't enough — they have to be <em>organised, timestamped, and retrievable on the spot.</em>")}
    ${_skP("This is exactly why I built <strong>Veriqo</strong> — the digital HACCP app I use to run compliance for Side Order Catering. Temperature logs, allergen matrix, supplier deliveries via Scan Label AI, cleaning records — all timestamped, all retrievable. When my last EHO turned up I handed her my phone, she scrolled through 3 months of records in 4 minutes, and I got 5 stars.")}
    ${_skAction("Go through the checklist above. For each one, ask yourself: \"If they asked for the last 3 months' records right now, could I produce them in under 5 minutes?\" Every \"no\" is a gap. Write them down.")}
    ${_skP('Tomorrow: the inquiry script that doubles conversion rate.<br><br>Michael')}
    ${_skPS("P.S. Veriqo is the compliance app I mentioned — digital HACCP, allergen management, and EHO-ready records. Standalone it's £7/month (HACCP only) or £15/month for the full Pro plan. Chef to CEO members get Veriqo PRO included free for 12 months. More on that on Day 7. Start a free trial at <a href=\"https://getveriqo.co.uk\" style=\"color:#1E3A2F\">getveriqo.co.uk</a>.")}
  `;
  return _skWrap(3, body, leadId);
}

// ─── Day 4 — Inquiry script ───────────────────────────────────────────────────

function _skDay4(stage, eventsPerMonth, leadId) {
  const body = `
    ${_skP('Hi there,')}
    ${_skP("A potential client sends an inquiry. \"Hi, do you do private dinners? We're thinking 8 people, end of next month.\"")}
    ${_skP("What most chefs reply: <em>\"Yes! I'd love to. My rates start at £65/head. Let me know if that works.\"</em>")}
    ${_skP("What you should reply: a qualifying script.")}
    ${_skP("Here's the structure I use on every cold inquiry at Side Order Catering. It doubled my conversion rate when I started using it.")}
    <div style="background:#F7F3EC;border-radius:8px;padding:20px 22px;margin:0 0 18px;font-size:14px;color:#4A4438;line-height:1.8;font-family:Georgia,'Times New Roman',serif;border-left:3px solid #E2DDD5">
      <em>Hi [name], thanks for reaching out — that sounds like a lovely event. Before I send through pricing, I want to make sure I give you the right answer. A few quick questions:</em><br><br>
      <em>1. What's the occasion?<br>
      2. Where would the event be held — your home or a venue?<br>
      3. Any dietary requirements, allergies, or strong preferences across the 8 guests?<br>
      4. What time of year / day of week are you thinking?<br>
      5. Have you booked a private chef before? Any sense of budget per head?</em><br><br>
      <em>Once I've got these, I'll send through a tailored menu suggestion with two price points so you can see what works for you.</em><br><br>
      <em>Looking forward to hearing more — Michael</em>
    </div>
    ${_skP("This script does four things at once:")}
    <ol style="margin:0 0 18px;padding-left:22px;font-size:14px;color:#4A4438;line-height:1.85;font-family:Georgia,'Times New Roman',serif">
      <li style="margin-bottom:4px"><strong>Qualifies</strong> — by question 5 you know if they're a real client or a tyre-kicker</li>
      <li style="margin-bottom:4px"><strong>Positions you as a professional</strong> — generic chefs send rates. Professionals ask questions.</li>
      <li style="margin-bottom:4px"><strong>Surfaces allergens early</strong> — critical for the next stage</li>
      <li><strong>Gives you anchor pricing leverage</strong> — by sending two price points you take "too expensive" off the table</li>
    </ol>
    ${_skAction("Copy the script into your notes app. Use it on the next inquiry that lands. Watch the response rate.")}
    ${_skP('Tomorrow: the templates that run a booking on autopilot.<br><br>Michael')}
  `;
  return _skWrap(4, body, leadId);
}

// ─── Day 5 — Booking ops ──────────────────────────────────────────────────────

function _skDay5(stage, eventsPerMonth, leadId) {
  const body = `
    ${_skP('Hi there,')}
    ${_skP("By now you've got pricing, compliance, and an inquiry script. The last piece is booking operations — what happens between <em>\"yes, I'd love to book\"</em> and the event itself.")}
    ${_skP("Most private chefs run every booking from scratch. New email chain, new notes, new prep timeline. It's exhausting and it's where things get missed. The fix: event templates. Three is enough for 90% of private chef work.")}
    <div style="margin:0 0 16px">
      <div style="background:#F7F3EC;border-radius:8px;padding:16px 18px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:6px">Template 1 — Private Dinner</div>
        <div style="font-size:13px;color:#4A4438;line-height:1.65">Timeline starts 14 days out. Menu confirmation, allergen check, deposit invoice, shopping list, 48-hour client briefing, on-site checklist, post-event thank-you.</div>
      </div>
      <div style="background:#F7F3EC;border-radius:8px;padding:16px 18px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:6px">Template 2 — Wedding</div>
        <div style="font-size:13px;color:#4A4438;line-height:1.65">Timeline starts 90 days out. Tasting, menu lock at -60, final numbers at -14, supplier deliveries at -2, on-site setup, service plan, post-event follow-up at +3.</div>
      </div>
      <div style="background:#F7F3EC;border-radius:8px;padding:16px 18px">
        <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:6px">Template 3 — Corporate</div>
        <div style="font-size:13px;color:#4A4438;line-height:1.65">Timeline starts 21 days out. Brief confirmation, dietary collection, deposit invoice, final numbers at -7, on-site setup, invoice at +1.</div>
      </div>
    </div>
    ${_skP("I've built these into <strong>Veriqo PRO</strong> — the Client Engine handles bookings, event templates and allergen matrices in one place. New event → pick template → done. The allergen matrix and event briefing generate themselves from the client record. You can build them in Notion or a Google Doc just as well. The templates matter more than the tool.")}
    ${_skAction("Pick one of the three. Open Notion / Docs / Veriqo (your choice). Build the checklist. Use it on your next event.")}
    ${_skP('Tomorrow: what £3k/month actually looks like.<br><br>Michael')}
    ${_skPS("P.S. These templates are built into the Veriqo Client engine — new event, pick a template, done. The allergen matrix and event briefing pull through automatically from the client record. More on Day 7.")}
  `;
  return _skWrap(5, body, leadId);
}

// ─── Day 6 — 90-day arc (segmented by eventsPerMonth) ────────────────────────

function _skDay6(stage, eventsPerMonth, leadId) {
  let pathBlock;
  if (eventsPerMonth === '10+') {
    pathBlock = `
      <div style="background:#F7F3EC;border-radius:8px;padding:18px 20px;margin:0 0 18px">
        <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:8px">The 10+ events/month path — scaling</div>
        <div style="font-size:14px;color:#4A4438;line-height:1.75">You've outgrown solo. £3k/month isn't the question — £8k/month is. The question is whether you bring on a second chef, raise your prices, or both. Module 5 of the Chef to CEO curriculum covers this directly.</div>
      </div>`;
  } else if (eventsPerMonth === '4-10') {
    pathBlock = `
      <div style="background:#F7F3EC;border-radius:8px;padding:18px 20px;margin:0 0 18px">
        <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:8px">The 4–10 events/month path — ops-led</div>
        <div style="font-size:14px;color:#4A4438;line-height:1.75">You've got volume. You don't need more bookings — you need better margins per booking. Six events a month at £500 average = £3k. Six events at £750 average = £4.5k. Same diary, 50% more money. The work this week is pushing your average per-event spend up by raising your food cost discipline and your inquiry conversion rate on the higher-budget jobs.</div>
      </div>`;
  } else {
    pathBlock = `
      <div style="background:#F7F3EC;border-radius:8px;padding:18px 20px;margin:0 0 18px">
        <div style="font-size:13px;font-weight:bold;color:#1E3A2F;margin-bottom:8px">The 0–3 events/month path — pricing-led</div>
        <div style="font-size:14px;color:#4A4438;line-height:1.75">Three events a month at £1,000 average per event = £3k/month. That means one mid-sized private dinner (8 guests × £75 = £600) and two larger ones (12 guests × £85 = £1,020) every month. It's achievable inside 90 days if your pricing is right. Most chefs in this band can't get there because they're charging £45/head and would need 7 events to hit the same number. The maths kills them before the calendar does.</div>
      </div>`;
  }

  const body = `
    ${_skP('Hi there,')}
    ${_skP("You've made it to Day 6. Most people don't — so well done.")}
    ${_skP("Today's email is the one I wish someone had sent me when I went independent. The maths of a £3k/month private chef business.")}
    ${pathBlock}
    ${_skP("The 90-day arc is real. Most chefs who work the system get there. The ones who don't have one specific thing missing — usually pricing discipline, occasionally compliance friction, sometimes inquiry response time.")}
    ${_skAction("Hit reply with the number you're aiming for in 90 days. £3k? £5k? £8k? Tell me where you're at now and where you want to be. I'll send back the one thing I'd focus on if I were you.")}
    ${_skP('Tomorrow: the offer.<br><br>Michael')}
  `;
  return _skWrap(6, body, leadId);
}

// ─── Day 7 — The offer ────────────────────────────────────────────────────────

function _skDay7(stage, eventsPerMonth, leadId) {
  const body = `
    ${_skP('Hi there,')}
    ${_skP("Last email of the week. Then I'll get out of your inbox unless you opt in to more.")}
    ${_skP("Quick recap of the seven days:")}
    <ol style="margin:0 0 18px;padding-left:22px;font-size:14px;color:#4A4438;line-height:1.85;font-family:Georgia,'Times New Roman',serif">
      <li style="margin-bottom:4px">The four systems every private chef needs</li>
      <li style="margin-bottom:4px">Food cost % — the one number that decides if you make money</li>
      <li style="margin-bottom:4px">The EHO compliance checklist</li>
      <li style="margin-bottom:4px">The first-inquiry script that doubles conversion</li>
      <li style="margin-bottom:4px">The three event templates that run themselves</li>
      <li>What £3k/month actually looks like for your stage</li>
    </ol>
    ${_skP("That's the system. You can build all of it yourself. Most chefs do — over 18 months, with a few expensive mistakes along the way.")}
    ${_skP("Or you can join Chef to CEO and have it running by next week.")}
    <div style="background:#1E3A2F;border-radius:10px;padding:22px 24px;margin:0 0 18px">
      <div style="font-size:16px;font-weight:bold;color:#F7F3EC;margin-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif">Chef to CEO — what you get</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#a8c4b8;line-height:1.85;font-family:Georgia,'Times New Roman',serif">
        <li style="margin-bottom:4px">Full 90-day curriculum — 5 modules covering everything above plus scaling and team</li>
        <li style="margin-bottom:4px">The complete Business Toolkit — pricing matrices, client contracts, prep templates</li>
        <li style="margin-bottom:4px">Veriqo PRO for 12 months — compliance engine (HACCP + allergens), client engine (CRM + bookings), profit engine (food cost, quotes, invoicing) all in one app</li>
        <li style="margin-bottom:4px">Private Chef to CEO Skool community — direct access to me and the cohort</li>
        <li>The 90-day £3k path — built into the curriculum from day one</li>
      </ul>
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1)">
        <div style="font-size:12px;color:#C8922A;letter-spacing:0.08em;text-transform:uppercase;font-family:-apple-system,sans-serif;margin-bottom:8px">One package · One-time payment</div>
        <div style="font-size:13px;color:#a8c4b8;line-height:1.65"><strong style="color:#F7F3EC;font-size:26px">£397</strong> &nbsp;one-time · lifetime course access<br><span style="font-size:12px">14-day money-back guarantee. After your included year, keep Veriqo PRO for £15/month.</span></div>
      </div>
    </div>
    ${_skBtn('https://cheftoceo.co.uk/join', 'Get The Systems &rarr;')}
    ${_skBtnGold('https://cheftoceo.co.uk/call', 'Book a 15-minute call with me first &rarr;')}
    ${_skP("<br>If now's not the time, that's fine. Reply to any of this week's emails when it is. I keep the door open.<br><br>Thanks for letting me into your inbox this week.<br><br>Michael")}
    ${_skPS("P.S. I do read every reply. If anything from this week stuck — or didn't — tell me. It makes the next cohort's emails sharper.")}
  `;
  return _skWrap(7, body, leadId);
}
