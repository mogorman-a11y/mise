// api/yield-magic-link.js — Vercel serverless function
// ──────────────────────────────────────────────────────
// Generates a Supabase magic link server-side and sends a Yield-branded
// email via Resend. Called by auth.js when the user is on Yield (yield.html).
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

    const dest = redirectTo || 'https://getveriqo.co.uk/yield';

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

    const tokenHash = data && data.properties && data.properties.hashed_token;
    if (!tokenHash) throw new Error('Magic link generation failed — no token hash');

    // Send token_hash directly in the URL so the client calls verifyOtp() itself.
    // This bypasses Supabase's /verify redirect entirely, avoiding the PKCE
    // code-exchange mismatch that occurs with server-generated admin links.
    const yieldLink = dest + (dest.includes('?') ? '&' : '?')
      + 'token_hash=' + encodeURIComponent(tokenHash) + '&type=magiclink';

    // Send Yield-branded email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Yield <hello@getveriqo.co.uk>',
        to: [email],
        subject: 'Your Yield sign-in link',
        html: _buildEmail(yieldLink)
      })
    });

    if (!emailRes.ok) {
      const body = await emailRes.text();
      throw new Error('Resend error ' + emailRes.status + ': ' + body);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Yield] yield-magic-link error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function _buildEmail(link) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Yield sign-in link</title>
</head>
<body style="margin:0;padding:0;background:#0E0E0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <!-- Header -->
  <div style="background:#1A1A18;border-radius:16px 16px 0 0;padding:32px;text-align:center;border:1px solid #2A2A28;border-bottom:0">
    <div style="margin-bottom:14px">
      <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M26 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
        <path d="M16 17L16 28" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
      </svg>
    </div>
    <div style="font-size:22px;font-weight:700;color:#F0EDE6;letter-spacing:-0.3px">Yield</div>
    <div style="font-size:13px;color:#C9A84C;margin-top:4px">Know your yield.</div>
  </div>

  <!-- Body -->
  <div style="background:#1A1A18;padding:32px;border-radius:0 0 16px 16px;border:1px solid #2A2A28;border-top:0">
    <p style="margin:0 0 24px;font-size:16px;color:#D4D0C8;line-height:1.6">
      Tap the button below to sign in to Yield. This link expires in 1 hour and can only be used once.
    </p>
    <a href="${link}"
       style="display:block;background:#C9A84C;color:#0E0E0D;text-decoration:none;text-align:center;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.2px">
      Sign in to Yield &rarr;
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:#6A6860;line-height:1.5">
      If the button doesn&rsquo;t work, copy and paste this link into your browser:<br>
      <span style="word-break:break-all;color:#8A8680;font-size:12px">${link}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#4A4840">
      If you didn&rsquo;t request this, you can safely ignore this email.
    </p>
  </div>

  <!-- Footer -->
  <p style="text-align:center;font-size:12px;color:#4A4840;margin-top:20px">
    Yield &middot; <a href="https://getveriqo.co.uk/yield" style="color:#4A4840;text-decoration:none">getveriqo.co.uk</a>
  </p>

</div>
</body>
</html>`;
}
