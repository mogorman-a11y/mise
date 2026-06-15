// api/welcome-email.js — called immediately after a new user signs up
// Sends a branded welcome email via Resend.
// POST { email, name, app } — app is 'veriqo' | 'carte' | 'yield' (defaults to 'veriqo')
// POST { email, source:'starter-kit', stage, eventsPerMonth } — starter kit Day 1 + Supabase insert
// No auth — welcome email is low-stakes; rate-limit at infra level if needed.

const { createClient } = require('@supabase/supabase-js');

const APP_VERIQO = 'https://getveriqo.co.uk/app';
const APP_CARTE  = 'https://getveriqo.co.uk/mise';
const APP_YIELD  = 'https://getveriqo.co.uk/yield';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, app, source, stage, eventsPerMonth } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  if (source === 'starter-kit') {
    return await _handleStarterKit(res, email, stage, eventsPerMonth);
  }

  const isYield = app === 'yield';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    isYield ? 'Yield <hello@getveriqo.co.uk>' : 'Veriqo + Carte <hello@getveriqo.co.uk>',
        to:      [email],
        subject: isYield ? 'Your Yield trial starts now' : 'Your Veriqo + Carte trial starts now',
        html:    isYield ? _buildYieldWelcome(name || null) : _buildSuiteWelcome(name || null),
      }),
    });

    if (!r.ok) throw new Error('Resend ' + r.status + ': ' + await r.text());
    console.log('[welcome-email] sent to', email, '(app:', app || 'veriqo', ')');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[welcome-email] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function _hi(name) {
  return name ? 'Hi ' + name + ',' : 'Hi there,';
}

function _p(text) {
  return `<p style="margin:0 0 18px;font-size:15px;color:#5A544E;line-height:1.65">${text}</p>`;
}

function _pDark(text) {
  return `<p style="margin:0 0 18px;font-size:15px;color:#B0AAA0;line-height:1.65">${text}</p>`;
}

function _btn(url, label, primary) {
  if (primary !== false) {
    return `<a href="${url}" style="display:block;background:#C8A96E;color:#1C2B1E;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.2px;margin-top:22px">${label}</a>`;
  }
  return `<a href="${url}" style="display:block;background:#1C2B1E;color:#F5F0E8;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:-0.2px;margin-top:10px">${label}</a>`;
}

function _btnYield(url, label, primary) {
  if (primary !== false) {
    return `<a href="${url}" style="display:block;background:#C9A84C;color:#0E0E0D;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.2px;margin-top:22px">${label}</a>`;
  }
  return `<a href="${url}" style="display:block;background:#1E1A11;border:1px solid #3A3A37;color:#F0EDE6;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:-0.2px;margin-top:10px">${label}</a>`;
}

// ─── Yield welcome ────────────────────────────────────────────────────────────

function _buildYieldWelcome(name) {
  const header = `
    <div style="margin:0 auto 20px;width:52px;height:52px;background:#1E1A11;border:1px solid #C9A84C40;border-radius:14px;display:flex;align-items:center;justify-content:center">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <path d="M6 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M26 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M16 17L16 28" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
      </svg>
    </div>
    <div style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F0EDE6;letter-spacing:-0.3px">Welcome to Yield</div>
    <div style="font-size:13px;color:#C9A84C;margin-top:6px;font-weight:500">Your 14-day trial has started</div>`;

  const body = `
    ${_pDark(_hi(name))}
    ${_pDark('Yield is built around one question: <strong style="color:#F0EDE6">Am I paid and profitable?</strong> Everything in the app — quoting, invoicing, job costing, P&amp;L — is designed to answer that.')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:separate;border-spacing:0 8px">
      <tr>
        <td style="background:#1A1A18;border:1px solid #2A2A27;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="vertical-align:middle;font-size:20px">&#x1F4CB;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#F0EDE6">Quotes</div>
              <div style="font-size:13px;color:#7A7870;margin-top:2px;line-height:1.5">Send professional quotes, track status, auto-create invoices on acceptance.</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="background:#1A1A18;border:1px solid #2A2A27;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="vertical-align:middle;font-size:20px">&#x1F4B7;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#F0EDE6">Invoices &amp; payments</div>
              <div style="font-size:13px;color:#7A7870;margin-top:2px;line-height:1.5">Deposit + balance invoices, mark as paid, tab timeline shows every job's financial status.</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="background:#1A1A18;border:1px solid #2A2A27;border-radius:10px;padding:14px 16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="36" style="vertical-align:middle;font-size:20px">&#x1F9EE;</td>
            <td style="vertical-align:middle">
              <div style="font-size:14px;font-weight:700;color:#F0EDE6">Costing &amp; P&amp;L</div>
              <div style="font-size:13px;color:#7A7870;margin-top:2px;line-height:1.5">Food cost %, travel, labour, margin — built into every quote so you know your profit before you send it.</div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    <div style="background:#1E1A11;border:1px solid #C9A84C40;border-radius:10px;padding:14px 16px;margin-bottom:8px">
      <div style="font-size:14px;font-weight:700;color:#C9A84C;margin-bottom:5px">Best place to start: build a quote</div>
      <div style="font-size:13px;color:#7A7870;line-height:1.55">Open the Quotes tab, tap New Quote, fill in the event details and add your dishes. Yield handles the maths — food cost, deposit amount, balance due.</div>
    </div>

    ${_btnYield(APP_YIELD, 'Open Yield &rarr;')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yield</title></head>
<body style="margin:0;padding:0;background:#0E0E0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <div style="background:#141410;border:1px solid #C9A84C30;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    ${header}
  </div>

  <div style="background:#181817;padding:32px;border-radius:0 0 16px 16px;border:1px solid #2A2A27;border-top:0">
    ${body}
  </div>

  <p style="text-align:center;font-size:12px;color:#5A5650;margin-top:14px">Questions? Just reply to this email — we read everything.</p>
  <p style="text-align:center;font-size:12px;color:#5A5650;margin-top:6px">
    Yield &middot; <a href="https://getveriqo.co.uk" style="color:#5A5650;text-decoration:none">getveriqo.co.uk</a>
  </p>

</div>
</body>
</html>`;
}

// ─── Suite welcome (Veriqo + Carte) ──────────────────────────────────────────

function _buildSuiteWelcome(name) {
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

  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:14px">Questions? Just reply to this email — we read everything.</p>
  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:6px">
    Veriqo + Carte &middot; <a href="https://getveriqo.co.uk" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>

</div>
</body>
</html>`;
}

// ─── Starter Kit handler + Day 1 email ────────────────────────────────────────

async function _handleStarterKit(res, email, stage, eventsPerMonth) {
  const validStages = ['employed', 'newly_independent', 'established'];
  const validEvents = ['0-3', '4-10', '10+'];
  if (!validStages.includes(stage)) stage = 'newly_independent';
  if (!validEvents.includes(eventsPerMonth)) eventsPerMonth = '0-3';

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Upsert — on duplicate email, return existing row so we can still send Day 1
  const { data: row, error: dbErr } = await supabase
    .from('starter_kit_leads')
    .upsert({ email, stage, events_per_month: eventsPerMonth }, { onConflict: 'email' })
    .select('id, last_email_sent')
    .single();

  if (dbErr) {
    console.error('[welcome-email] starter-kit db error:', dbErr.message);
    return res.status(500).json({ error: dbErr.message });
  }

  // Mid-sequence: leave them alone, they're already getting emails
  if (row.last_email_sent >= 1 && row.last_email_sent < 7) {
    console.log('[welcome-email] starter-kit mid-sequence duplicate signup:', email);
    return res.status(200).json({ ok: true });
  }

  // Completed sequence: reset and restart from Day 1
  if (row.last_email_sent === 7) {
    await supabase.from('starter_kit_leads')
      .update({ last_email_sent: 0, stage, events_per_month: eventsPerMonth })
      .eq('id', row.id);
    console.log('[welcome-email] starter-kit restarting completed sequence for:', email);
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: "Michael O'Gorman <hello@getveriqo.co.uk>",
        to: [email],
        subject: 'The 4 systems most private chefs are missing',
        html: _buildStarterDay1(stage, row.id),
      }),
    });
    if (!r.ok) throw new Error('Resend ' + r.status + ': ' + await r.text());
    await supabase.from('starter_kit_leads').update({ last_email_sent: 1 }).eq('id', row.id);
    console.log('[welcome-email] starter-kit Day 1 sent to', email);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[welcome-email] starter-kit send error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Starter Kit shared email helpers ─────────────────────────────────────────

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

function _skP(text) {
  return `<p style="margin:0 0 18px;font-size:15px;color:#4A4438;line-height:1.75;font-family:Georgia,'Times New Roman',serif">${text}</p>`;
}

function _skAction(text) {
  return `<div style="background:#F7F3EC;border-left:3px solid #C8922A;padding:14px 18px;margin:24px 0;border-radius:0 8px 8px 0">
    <div style="font-size:11px;font-weight:700;color:#C8922A;letter-spacing:0.1em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin-bottom:6px">Today's action</div>
    <p style="margin:0;font-size:14px;color:#4A4438;line-height:1.65;font-family:Georgia,'Times New Roman',serif">${text}</p>
  </div>`;
}

function _skPS(text) {
  return `<p style="margin:24px 0 0;font-size:13px;color:#6B6355;line-height:1.65;font-family:Georgia,'Times New Roman',serif;border-top:1px solid #E2DDD5;padding-top:20px">${text}</p>`;
}

// ─── Day 1 ────────────────────────────────────────────────────────────────────

function _buildStarterDay1(stage, leadId) {
  let opening, ps;
  if (stage === 'employed') {
    opening = "You're thinking about going independent. Smart. Before you do — these are the four systems you'll need running on Day 1.";
    ps = "Most chefs go independent without these. They spend 18 months figuring them out the hard way. You won't.";
  } else if (stage === 'established') {
    opening = "You're 2+ years in. You've got most of this working — but I'd bet money you're undercharging on at least one of the four.";
    ps = "If you're already running 10+ events a month, the leverage you're missing is in pricing and ops, not basics. This week's a tune-up.";
  } else {
    opening = "Welcome to The Private Chef Operating System. Over the next 7 days I'm going to walk you through the four systems every private chef business needs to run properly — and the one most chefs are missing on at least three of them.";
    ps = "Day 2 lands tomorrow morning. It's the most important email of the week — the one number that decides whether you make money or just stay busy.";
  }

  const body = `
    ${_skP('Hi there,')}
    ${_skP(opening)}
    ${_skP("I'm Michael. I've spent 25 years in professional kitchens. Four-time Chef of the Year finalist. I run Side Order Catering as a private chef and caterer across the Midlands, and I built Chef to CEO because I got tired of watching brilliant chefs go independent and lose money for two years before figuring out the business side.")}
    ${_skP('The four systems are:')}
    <ol style="margin:0 0 18px;padding-left:22px;font-size:15px;color:#4A4438;line-height:1.85;font-family:Georgia,'Times New Roman',serif">
      <li style="margin-bottom:6px"><strong>Pricing</strong> — knowing your real food cost % and charging from numbers, not gut feel</li>
      <li style="margin-bottom:6px"><strong>Compliance</strong> — a digital HACCP system that gets you a 5-star EHO rating without paperwork on your kitchen table</li>
      <li style="margin-bottom:6px"><strong>Inquiry conversion</strong> — a script that qualifies clients in the first message and doubles your booking rate</li>
      <li><strong>Booking operations</strong> — templates, briefings, and post-event follow-ups that run themselves</li>
    </ol>
    ${_skP("That's the week. One pillar per day, one action after each. By Day 7 you'll have a working version of all four.")}
    ${_skAction("Hit reply and tell me which of the four is hurting you most right now. I read every reply. The answer shapes what I send you tomorrow.")}
    ${_skP('Talk soon,<br>Michael')}
    ${_skPS('P.S. ' + ps)}
  `;

  return _skWrap(1, body, leadId);
}
