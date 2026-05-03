// api/auth-link.js — Vercel serverless function
// Generates a Supabase magic link or recovery link using the admin API,
// then sends a branded email via Resend. Covers:
//   - Veriqo magic link  (type=magiclink, app=veriqo)
//   - Veriqo reset password (type=recovery, app=veriqo)
//   - Carte reset password  (type=recovery, app=carte)
// Carte magic link is handled separately by api/carte-magic-link.js.
//
// Using admin generateLink + token_hash bypasses Supabase's email redirect
// entirely, so it works regardless of the project's PKCE setting and
// regardless of which browser the user opens the email in.

const { createClient } = require('@supabase/supabase-js');

const CFG = {
  veriqo: {
    appUrl:   'https://getveriqo.co.uk/app',
    name:     'Veriqo',
    tagline:  'HACCP food safety compliance',
    from:     'Veriqo <hello@getveriqo.co.uk>',
    headerBg: '#1B3A5C',
    headerFg: '#ffffff',
    accent:   '#2D7A3A',
    btnBg:    '#2D7A3A',
    btnFg:    '#ffffff',
    bodyBg:   '#f5f4f0',
  },
  carte: {
    appUrl:   'https://getveriqo.co.uk/mise',
    name:     'Carte',
    tagline:  'Private chef. Perfectly organised.',
    from:     'Carte <hello@getveriqo.co.uk>',
    headerBg: '#1C2B1E',
    headerFg: '#F5F0E8',
    accent:   '#C8A96E',
    btnBg:    '#1C2B1E',
    btnFg:    '#C8A96E',
    bodyBg:   '#F5F0E8',
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, type, app } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    if (!['magiclink', 'recovery'].includes(type)) return res.status(400).json({ error: 'invalid type' });

    const cfg = CFG[app] || CFG.veriqo;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase.auth.admin.generateLink({
      type,
      email,
      options: { redirectTo: cfg.appUrl },
    });
    if (error) throw error;

    const tokenHash = data && data.properties && data.properties.hashed_token;
    if (!tokenHash) throw new Error('Link generation failed — no token hash returned');

    const link = cfg.appUrl + '?token_hash=' + encodeURIComponent(tokenHash) + '&type=' + type;

    const subject = type === 'recovery'
      ? 'Reset your ' + cfg.name + ' password'
      : 'Your ' + cfg.name + ' sign-in link';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    cfg.from,
        to:      [email],
        subject,
        html:    _buildEmail(link, type, cfg),
      }),
    });

    if (!emailRes.ok) {
      const body = await emailRes.text();
      throw new Error('Resend error ' + emailRes.status + ': ' + body);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[auth-link] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function _buildEmail(link, type, cfg) {
  const isReset   = type === 'recovery';
  const headline  = isReset ? 'Reset your password' : 'Sign in to ' + cfg.name;
  const bodyText  = isReset
    ? 'Click the button below to reset your password. This link expires in 1 hour and can only be used once.'
    : 'Tap the button below to sign in to ' + cfg.name + '. This link expires in 1 hour and can only be used once.';
  const btnLabel  = isReset ? 'Reset password &rarr;' : 'Sign in to ' + cfg.name + ' &rarr;';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${cfg.bodyBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <div style="background:${cfg.headerBg};border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:22px;font-weight:700;color:${cfg.headerFg};letter-spacing:-0.3px">${cfg.name}</div>
    <div style="font-size:13px;color:${cfg.accent};margin-top:4px">${cfg.tagline}</div>
  </div>

  <div style="background:#ffffff;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E2DDD5;border-top:0">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1C2B1E">${headline}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#5A544E;line-height:1.6">${bodyText}</p>
    <a href="${link}" style="display:block;background:${cfg.btnBg};color:${cfg.btnFg};text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:600;letter-spacing:-0.2px">
      ${btnLabel}
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:#A09890;line-height:1.5">
      If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
      <span style="word-break:break-all;color:#5A544E;font-size:12px">${link}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#C0B8B0">If you didn&rsquo;t request this, you can safely ignore this email.</p>
  </div>

  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:20px">
    ${cfg.name} &middot; <a href="https://getveriqo.co.uk" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>
</div>
</body>
</html>`;
}
