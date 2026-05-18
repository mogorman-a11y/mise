// api/yield-reminders.js — payment reminder emails for Yield
// Checks invoices due in -7, -3, 0, +3 days and sends branded reminders.
// Triggered daily by GitHub Actions cron (secured by CRON_SECRET header).
// Respects email_opt_out on profiles.

const { createClient } = require('@supabase/supabase-js');

const REMINDER_DAYS = [-7, -3, 0, 3];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['authorization'] !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDates = REMINDER_DAYS.map(d => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + d);
    return dt.toISOString().split('T')[0];
  });

  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('id, user_id, inv_number, type, total, due_date, client_name, status')
    .in('due_date', targetDates)
    .neq('status', 'paid');

  if (invErr) {
    console.error('[yield-reminders] invoices error:', invErr.message);
    return res.status(500).json({ error: invErr.message });
  }

  if (!invoices || invoices.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No invoices due' });
  }

  const userIds = [...new Set(invoices.map(i => i.user_id))];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, business_name, email_opt_out')
    .in('id', userIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  const emailMap = {};
  for (const uid of userIds) {
    try {
      const { data: ud } = await supabase.auth.admin.getUserById(uid);
      if (ud && ud.user) emailMap[uid] = ud.user.email;
    } catch (e) {}
  }

  let sent = 0;
  const errors = [];

  for (const inv of invoices) {
    const profile = profileMap[inv.user_id];
    if (!profile || profile.email_opt_out) continue;
    const email = emailMap[inv.user_id];
    if (!email) continue;

    const dueDate = new Date(inv.due_date);
    const diffDays = Math.round((dueDate - today) / 86400000);

    const subject = diffDays < 0
      ? 'Overdue: ' + (inv.inv_number || 'Invoice') + ' — ' + (inv.client_name || 'Client')
      : diffDays === 0
      ? 'Due today: ' + (inv.inv_number || 'Invoice') + ' — ' + (inv.client_name || 'Client')
      : 'Reminder: ' + (inv.inv_number || 'Invoice') + ' due in ' + diffDays + ' days';

    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Yield <hello@getveriqo.co.uk>',
          to: [email],
          subject,
          html: _buildEmail(inv, profile, diffDays),
        }),
      });
      if (emailRes.ok) {
        sent++;
      } else {
        const body = await emailRes.text();
        errors.push(inv.id + ': Resend ' + emailRes.status + ' — ' + body);
      }
    } catch (e) {
      errors.push(inv.id + ': ' + e.message);
    }
  }

  console.log('[yield-reminders] sent=' + sent + ' errors=' + errors.length);
  return res.status(200).json({ sent, errors });
};

function _fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function _cur(amount) {
  return '£' + parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function _buildEmail(inv, profile, diffDays) {
  const businessName = profile.business_name || 'there';
  const typeLabel    = inv.type === 'deposit' ? 'Deposit invoice' : 'Balance invoice';
  const invRef       = inv.inv_number || 'Invoice';
  const urgency      = diffDays < 0 ? '#D45F4A' : '#C9A84C';
  const dueLabel     = diffDays < 0
    ? (Math.abs(diffDays) === 1 ? 'was due yesterday' : 'was due ' + Math.abs(diffDays) + ' days ago')
    : diffDays === 0 ? 'is due today'
    : diffDays === 1 ? 'is due tomorrow'
    : 'is due in ' + diffDays + ' days';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0E0E0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">
  <div style="background:#1A1A18;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;border:1px solid #2A2A28;border-bottom:0">
    <div style="margin-bottom:12px">
      <svg width="36" height="36" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M26 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M16 17L16 28" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
      </svg>
    </div>
    <div style="font-size:20px;font-weight:700;color:#F0EDE6">Yield</div>
    <div style="font-size:12px;color:#C9A84C;margin-top:3px">Payment reminder</div>
  </div>
  <div style="background:#1A1A18;padding:28px 32px;border-radius:0 0 16px 16px;border:1px solid #2A2A28;border-top:0">
    <p style="margin:0 0 6px;font-size:15px;color:#D4D0C8;line-height:1.6">Hi ${businessName},</p>
    <p style="margin:0 0 20px;font-size:15px;color:#D4D0C8;line-height:1.6">
      Your <strong style="color:#F0EDE6">${typeLabel}</strong> for
      <strong style="color:#F0EDE6">${inv.client_name || 'your client'}</strong>
      <span style="color:${urgency};font-weight:600"> ${dueLabel}</span>.
    </p>
    <div style="background:#121210;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:13px;color:#6A6860">Invoice</span>
        <span style="font-size:13px;color:#D4D0C8">${invRef}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:13px;color:#6A6860">Client</span>
        <span style="font-size:13px;color:#D4D0C8">${inv.client_name || '—'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:13px;color:#6A6860">Amount</span>
        <span style="font-size:13px;font-weight:600;color:#C9A84C">${_cur(inv.total)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:13px;color:#6A6860">Due</span>
        <span style="font-size:13px;color:${urgency};font-weight:600">${_fmt(inv.due_date)}</span>
      </div>
    </div>
    <a href="https://getveriqo.co.uk/yield" style="display:block;background:#C9A84C;color:#0E0E0D;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:700;">
      Open Yield &rarr;
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#4A4840;line-height:1.5">
      Automated reminder from your Yield account. &nbsp;
      <a href="https://getveriqo.co.uk/api/unsubscribe?uid=${inv.user_id}" style="color:#6A6860;text-decoration:underline">Unsubscribe</a>
    </p>
  </div>
  <p style="text-align:center;font-size:12px;color:#4A4840;margin-top:20px">
    Yield &middot; <a href="https://getveriqo.co.uk" style="color:#4A4840;text-decoration:none">getveriqo.co.uk</a>
  </p>
</div>
</body>
</html>`;
}
