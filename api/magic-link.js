// api/magic-link.js — Vercel serverless function
// Merged from: auth-link.js, carte-magic-link.js, yield-magic-link.js
// Handles all magic link and password reset emails for the Mise Labs suite.
// POST { email, app, type?, redirectTo? }
//   app:  'veriqo' | 'carte' | 'yield'  (defaults to 'veriqo')
//   type: 'magiclink' | 'recovery'       (defaults to 'magiclink')
//   redirectTo: optional URL override

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
  yield: {
    appUrl:   'https://getveriqo.co.uk/yield',
    name:     'Yield',
    tagline:  'Know your yield.',
    from:     'Yield <hello@getveriqo.co.uk>',
    accent:   '#C9A84C',
    btnBg:    '#C9A84C',
    btnFg:    '#0E0E0D',
    isDark:   true,
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, app, type = 'magiclink', redirectTo } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    if (!['magiclink', 'recovery'].includes(type)) return res.status(400).json({ error: 'invalid type' });

    const cfg = CFG[app] || CFG.veriqo;
    const dest = redirectTo || cfg.appUrl;

    const adminRes = await fetch(
      process.env.SUPABASE_URL + '/auth/v1/admin/generate_link',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, email, redirect_to: dest }),
      }
    );
    const adminData = await adminRes.json();
    if (!adminRes.ok) throw new Error(adminData.msg || adminData.message || JSON.stringify(adminData));

    const tokenHash = adminData.hashed_token;
    if (!tokenHash) throw new Error('Link generation failed — no token hash returned');

    const link = dest + (dest.includes('?') ? '&' : '?')
      + 'token_hash=' + encodeURIComponent(tokenHash) + '&type=' + type;

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
    console.error('[magic-link] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function _buildEmail(link, type, cfg) {
  if (cfg.isDark) return _buildDarkEmail(link, type, cfg);

  const isReset  = type === 'recovery';
  const headline = isReset ? 'Reset your password' : 'Sign in to ' + cfg.name;
  const bodyText = isReset
    ? 'Click the button below to reset your password. This link expires in 1 hour and can only be used once.'
    : 'Tap the button below to sign in to ' + cfg.name + '. This link expires in 1 hour and can only be used once.';
  const btnLabel = isReset ? 'Reset password &rarr;' : 'Sign in to ' + cfg.name + ' &rarr;';

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

function _buildDarkEmail(link, type, cfg) {
  const isReset  = type === 'recovery';
  const btnLabel = isReset ? 'Reset password &rarr;' : 'Sign in to ' + cfg.name + ' &rarr;';
  const bodyText = isReset
    ? 'Click the button below to reset your password. This link expires in 1 hour and can only be used once.'
    : 'Tap the button below to sign in to ' + cfg.name + '. This link expires in 1 hour and can only be used once.';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0E0E0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">
  <div style="background:#1A1A18;border-radius:16px 16px 0 0;padding:32px;text-align:center;border:1px solid #2A2A28;border-bottom:0">
    <div style="margin-bottom:14px">
      <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M26 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M16 17L16 28" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
      </svg>
    </div>
    <div style="font-size:22px;font-weight:700;color:#F0EDE6;letter-spacing:-0.3px">${cfg.name}</div>
    <div style="font-size:13px;color:${cfg.accent};margin-top:4px">${cfg.tagline}</div>
  </div>
  <div style="background:#1A1A18;padding:32px;border-radius:0 0 16px 16px;border:1px solid #2A2A28;border-top:0">
    <p style="margin:0 0 24px;font-size:16px;color:#D4D0C8;line-height:1.6">${bodyText}</p>
    <a href="${link}" style="display:block;background:${cfg.btnBg};color:${cfg.btnFg};text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.2px">
      ${btnLabel}
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:#6A6860;line-height:1.5">
      If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
      <span style="word-break:break-all;color:#8A8680;font-size:12px">${link}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#4A4840">If you didn&rsquo;t request this, you can safely ignore this email.</p>
  </div>
  <p style="text-align:center;font-size:12px;color:#4A4840;margin-top:20px">
    ${cfg.name} &middot; <a href="https://getveriqo.co.uk" style="color:#4A4840;text-decoration:none">getveriqo.co.uk</a>
  </p>
</div>
</body>
</html>`;
}
