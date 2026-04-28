// api/carte-magic-link.js — Vercel serverless function
// ──────────────────────────────────────────────────────
// Generates a Supabase magic link server-side and sends a Carte-branded
// email via Resend. Called by auth.js when the user is on Carte (mise.html).
//
// Required environment variables (Vercel dashboard):
//   SUPABASE_URL              — https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (never expose in browser)
//   RESEND_API_KEY            — re_xxxxxxxxxxxx from resend.com

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, redirectTo } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const dest = redirectTo || 'https://getveriqo.co.uk/mise.html';

    // Generate magic link using service role key (server-side only)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: dest }
    });
    if (error) throw error;

    const link = data && data.properties && data.properties.action_link;
    if (!link) throw new Error('Magic link generation failed');

    // Send Carte-branded email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Carte <hello@getveriqo.co.uk>',
        to: [email],
        subject: 'Your Carte sign-in link',
        html: _buildEmail(link)
      })
    });

    if (!emailRes.ok) {
      const body = await emailRes.text();
      throw new Error('Resend error ' + emailRes.status + ': ' + body);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Mise] carte-magic-link error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function _buildEmail(link) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Carte sign-in link</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <!-- Header -->
  <div style="background:#1C2B1E;border-radius:16px 16px 0 0;padding:32px;text-align:center">
    <div style="display:inline-block;width:54px;height:54px;border:2px solid #C8A96E;border-radius:14px;line-height:54px;font-size:30px;font-weight:800;color:#C8A96E;text-align:center;margin-bottom:14px">C</div>
    <div style="font-size:22px;font-weight:700;color:#F5F0E8;letter-spacing:-0.3px">Carte</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:4px">Private chef. Perfectly organised.</div>
  </div>

  <!-- Body -->
  <div style="background:#ffffff;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E2DDD5;border-top:0">
    <p style="margin:0 0 24px;font-size:16px;color:#1C2B1E;line-height:1.6">
      Tap the button below to sign in to Carte. This link expires in 1 hour and can only be used once.
    </p>
    <a href="${link}"
       style="display:block;background:#1C2B1E;color:#C8A96E;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:600;letter-spacing:-0.2px">
      Sign in to Carte &rarr;
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:#A09890;line-height:1.5">
      If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
      <span style="word-break:break-all;color:#5A544E;font-size:12px">${link}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#C0B8B0">
      If you didn&rsquo;t request this, you can safely ignore this email.
    </p>
  </div>

  <!-- Footer -->
  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:20px">
    Carte &middot; <a href="https://getveriqo.co.uk/mise.html" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>

</div>
</body>
</html>`;
}
