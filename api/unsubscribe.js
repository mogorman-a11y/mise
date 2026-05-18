// api/unsubscribe.js — marketing email opt-out
// GET /api/unsubscribe?uid=<user_id>
// Sets email_opt_out = true on the profiles row, then renders a confirmation page.
// No auth required — the uid in the link is the only credential (same as a typical
// unsubscribe token, just not hashed since the consequence is benign).

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // Strip any accidental angle-bracket wrapping (e.g. uid=<uuid> from manual testing)
  const rawUid = req.query && req.query.uid;
  const uid = rawUid ? rawUid.replace(/^<+|>+$/g, '').trim() : null;
  const list = req.query && req.query.list;

  if (!uid) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(_page(
      'Invalid link',
      'This unsubscribe link appears to be incomplete. Please contact us at <a href="mailto:hello@getveriqo.co.uk" style="color:#C8A96E">hello@getveriqo.co.uk</a> and we\'ll remove you manually.'
    ));
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  if (list === 'starter') {
    const { error } = await supabase
      .from('starter_kit_leads')
      .update({ email_opt_out: true, unsubscribed_at: new Date().toISOString() })
      .eq('id', uid);
    if (error) {
      console.error('[unsubscribe] starter-kit Supabase error:', error.message);
      res.setHeader('Content-Type', 'text/html');
      return res.status(500).send(_page('Something went wrong', 'We couldn\'t process your request. Please contact us at <a href="mailto:hello@getveriqo.co.uk" style="color:#C8A96E">hello@getveriqo.co.uk</a> and we\'ll remove you manually.'));
    }
    console.log('[unsubscribe] starter-kit opted out uid:', uid);
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(_page("You've been unsubscribed", "You won't receive any more emails from The Private Chef Operating System mini-course."));
  }

  const { error } = await supabase
    .from('profiles')
    .update({ email_opt_out: true })
    .eq('id', uid);

  if (error) {
    console.error('[unsubscribe] Supabase error:', error.message);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(_page(
      'Something went wrong',
      'We couldn\'t process your request. Please contact us at <a href="mailto:hello@getveriqo.co.uk" style="color:#C8A96E">hello@getveriqo.co.uk</a> and we\'ll remove you manually.'
    ));
  }

  console.log('[unsubscribe] opted out uid:', uid);
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(_page(
    "You've been unsubscribed",
    "You won't receive any more marketing emails from Veriqo + Carte. Transactional emails (password resets, magic links) will still be sent when you request them."
  ));
};

function _page(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Veriqo</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center">
<div style="max-width:440px;margin:40px 20px;width:100%">
  <div style="background:#1C2B1E;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:22px;font-weight:700;color:#F5F0E8;letter-spacing:-0.3px">${title}</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">Veriqo + Carte</div>
  </div>
  <div style="background:#fff;border:1px solid #E2DDD5;border-top:0;border-radius:0 0 16px 16px;padding:32px">
    <p style="font-size:15px;color:#5A544E;line-height:1.65;margin:0 0 24px">${message}</p>
    <a href="https://getveriqo.co.uk" style="font-size:14px;color:#A09890;text-decoration:none">← Back to getveriqo.co.uk</a>
  </div>
</div>
</body>
</html>`;
}
