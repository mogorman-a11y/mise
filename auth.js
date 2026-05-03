// auth.js — authentication (login, signup, logout, session)
// ──────────────────────────────────────────────────────────
// Uses Supabase Auth. supabaseClient must be initialised (supabase.js) first.
//
// NOTE: By default Supabase requires email confirmation on signup.
// For development, disable this in:
//   Supabase dashboard → Authentication → Providers → Email → "Confirm email" toggle

window.Mise = window.Mise || {};
window.Mise.auth = (function () {

  // Track which tab is active on the auth screen
  let _currentTab = 'signin';

  // ── Auth overlay HTML ──────────────────────────────────────────────────────
  function _buildAuthHTML() {
    var cfg = window.MISE_AUTH_CONFIG || {};
    var bgColor    = cfg.background   || '#f5f4f0';
    var appName    = cfg.name         || 'Veriqo';
    var tagline    = cfg.tagline      || 'Food Safety. Inspection Ready.';
    var submitBg   = cfg.submitColor  || '#2D7A3A';
    var nameColor  = cfg.nameColor    || '#1a1a18';
    var logoHTML   = cfg.logoHTML     ||
      '<svg width="48" height="48" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:12px">'
      + '<defs>'
      +   '<linearGradient id="abg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1B3A5C"/><stop offset="100%" stop-color="#1B5C72"/></linearGradient>'
      +   '<linearGradient id="asg" x1="10%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#52D05C"/><stop offset="100%" stop-color="#1EA040"/></linearGradient>'
      + '</defs>'
      + '<rect width="512" height="512" rx="112" fill="url(#abg)"/>'
      + '<path d="M278 82 Q146 112 146 112 L146 295 Q146 388 278 438 Q410 388 410 295 L410 112 Z" fill="#1B5C72"/>'
      + '<path d="M250 82 Q118 112 118 112 L118 295 Q118 388 250 438 Q382 388 382 295 L382 112 Z" fill="url(#asg)"/>'
      + '<polyline points="163,295 228,368 366,212" stroke="white" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
      + '</svg>';

    return '<div id="mise-auth" style="position:fixed;inset:0;background:'+bgColor+';z-index:9999;overflow-y:auto;-webkit-overflow-scrolling:touch">'
      + '<div style="max-width:390px;margin:0 auto;padding:48px 20px 40px">'

      // Logo
      + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:36px">'
      +   logoHTML
      +   '<div>'
      +     '<div style="font-size:26px;font-weight:700;color:'+nameColor+';letter-spacing:-0.5px">'+appName+'</div>'
      +     '<div style="font-size:13px;color:#888;margin-top:1px">'+tagline+'</div>'
      +   '</div>'
      + '</div>'

      // Tab toggle
      + '<div style="display:flex;background:#e8e8e4;border-radius:10px;padding:3px;margin-bottom:20px">'
      +   '<button id="auth-tab-signin" onclick="Mise.auth._tab(\'signin\')" style="flex:1;padding:9px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#fff;color:#1a1a18;box-shadow:0 1px 3px rgba(0,0,0,0.12);font-family:inherit;transition:all 0.15s">Sign in</button>'
      +   '<button id="auth-tab-signup" onclick="Mise.auth._tab(\'signup\')" style="flex:1;padding:9px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:transparent;color:#888;font-family:inherit;transition:all 0.15s">Create account</button>'
      + '</div>'

      // Form card
      + '<div style="background:#fff;border-radius:16px;border:1px solid #e5e4de;padding:20px 18px">'

      // Sign-up only fields (hidden initially)
      +   '<div id="auth-signup-fields" style="display:none">'
      +     '<input id="auth-business" type="text" placeholder="Business name" autocomplete="organization" '
      +       'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;margin-bottom:10px;outline:none;font-family:inherit;background:#fff">'
      +     '<input id="auth-chefname" type="text" placeholder="Your name" autocomplete="name" '
      +       'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;margin-bottom:10px;outline:none;font-family:inherit;background:#fff">'
      +   '</div>'

      // Email + password
      +   '<input id="auth-email" type="email" placeholder="Email address" autocomplete="email" '
      +     'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;margin-bottom:10px;outline:none;font-family:inherit;background:#fff">'
      +   '<div style="position:relative">'
      +     '<input id="auth-password" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')Mise.auth._submit()" '
      +       'style="width:100%;padding:12px 44px 12px 12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;outline:none;font-family:inherit;background:#fff;box-sizing:border-box">'
      +     '<button type="button" onclick="Mise.auth._togglePw()" tabindex="-1" '
      +       'style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;color:#555;z-index:2;line-height:0">'
      +       '<svg id="auth-pw-eye" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">'
      +         '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
      +       '</svg>'
      +     '</button>'
      +   '</div>'

      // Error/info message
      +   '<div id="auth-msg" style="display:none;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:10px"></div>'

      // Submit
      +   '<button id="auth-submit" onclick="Mise.auth._submit()" '
      +     'style="width:100%;padding:14px;background:'+submitBg+';color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:14px">Sign in</button>'

      // Forgot password (sign-in only)
      +   '<div id="auth-forgot-row" style="text-align:center;margin-top:11px">'
      +     '<button onclick="Mise.auth._forgot()" style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;font-family:inherit">Forgot password?</button>'
      +   '</div>'
      +   '<div id="auth-back-row" style="display:none;text-align:center;margin-top:11px">'
      +     '<button onclick="Mise.auth._tab(\'signin\')" style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;font-family:inherit">← Sign in with password</button>'
      +   '</div>'

      // Trial note (sign-up only)
      +   '<div id="auth-trial-note" style="display:none;text-align:center;margin-top:11px;font-size:12px;color:#888">14-day free trial &middot; No card required</div>'

      + '</div>'

      // Alt sign-in options (hidden in magic-link mode)
      + '<div id="auth-alt-options">'

      // Divider
      +   '<div style="display:flex;align-items:center;gap:10px;margin:16px 0">'
      +     '<div style="flex:1;height:1px;background:#e5e4de"></div>'
      +     '<span style="font-size:12px;color:#aaa">or</span>'
      +     '<div style="flex:1;height:1px;background:#e5e4de"></div>'
      +   '</div>'

      // Google button
      +   '<button onclick="Mise.auth._google()" '
      +     'style="width:100%;padding:13px;background:#fff;border:1px solid #e5e4de;border-radius:10px;font-size:15px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;margin-bottom:10px">'
      +     '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">'
      +       '<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C17.218 14.375 17.64 11.925 17.64 9.2z"/>'
      +       '<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>'
      +       '<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>'
      +       '<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>'
      +     '</svg>'
      +     'Continue with Google'
      +   '</button>'

      // Magic link button
      +   '<button onclick="Mise.auth._tab(\'magic\')" '
      +     'style="width:100%;padding:13px;background:#fff;border:1px solid #e5e4de;border-radius:10px;font-size:15px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit">'
      +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      +       '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>'
      +       '<polyline points="22,6 12,13 2,6"/>'
      +     '</svg>'
      +     'Email me a sign-in link'
      +   '</button>'

      + '</div>'

      + '</div></div>';
  }

  // ── init ───────────────────────────────────────────────────────────────────
  // Called once on page load. Shows auth screen immediately, then checks for
  // an existing session to avoid making the user log in every visit.
  async function init() {
    showAuthScreen(); // show immediately — removes itself if session found

    // Carte magic link: token_hash + type=magiclink delivered in URL query string.
    // The client calls verifyOtp() directly, bypassing Supabase's /verify redirect
    // so there is no PKCE code-exchange mismatch from server-generated admin links.
    var _sp = new URLSearchParams(window.location.search);
    var _tokenHash = _sp.get('token_hash');
    if (_tokenHash && _sp.get('type') === 'magiclink') {
      try {
        var _vr = await supabaseClient.auth.verifyOtp({ token_hash: _tokenHash, type: 'magiclink' });
        if (_vr.error) throw _vr.error;
        window.history.replaceState(null, '', window.location.pathname);
        if (_vr.data && _vr.data.session) { await onSignedIn(_vr.data.session.user); return; }
      } catch (_ve) {
        _setMsg('This sign-in link has expired or already been used. Please request a new one.', 'error');
      }
    }

    // Supabase appends #access_token=...&type=signup to the URL when a user
    // clicks their email confirmation link — detect it so we can show the
    // "Email confirmed" screen before dropping them into the app.
    var _urlFragment = (window.location.hash || '') + (window.location.search || '');
    var _isEmailConfirm = _urlFragment.includes('type=signup') || _urlFragment.includes('type=email_confirmation');

    // Must register onAuthStateChange BEFORE getSession so PASSWORD_RECOVERY fires correctly.
    var _signedIn = false;
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        _showPasswordResetForm();
        return;
      }
      if (session && !_signedIn) {
        _signedIn = true;
        if (_isEmailConfirm) await _showEmailConfirmed();
        await onSignedIn(session.user);
      }
    });

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && !_signedIn) {
        _signedIn = true;
        if (_isEmailConfirm) await _showEmailConfirmed();
        await onSignedIn(session.user);
      }
    } catch (e) {
      console.warn('[Veriqo] getSession error:', e);
    }
  }

  // ── _showPasswordResetForm ─────────────────────────────────────────────────
  // Shown when the user arrives via a password reset email link.
  // Lets them set a new password, then signs them in.
  function _showPasswordResetForm() {
    hideAuthScreen();
    if (document.getElementById('pw-reset-form')) return;

    var cfg = window.MISE_AUTH_CONFIG || {};
    var bg      = cfg.background   || '#f5f4f0';
    var btnBg   = cfg.submitColor  || '#1a1a18';
    var nameCol = cfg.nameColor    || '#1a1a18';
    var logoHtml = cfg.logoHTML || '<svg width="40" height="40" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:10px"><defs><linearGradient id="pwbg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1B3A5C"/><stop offset="100%" stop-color="#1B5C72"/></linearGradient><linearGradient id="pwsg" x1="10%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#52D05C"/><stop offset="100%" stop-color="#1EA040"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#pwbg)"/><path d="M250 82 Q118 112 118 112 L118 295 Q118 388 250 438 Q382 388 382 295 L382 112 Z" fill="url(#pwsg)"/><polyline points="163,295 228,368 366,212" stroke="white" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    var appName = cfg.name || 'Veriqo';

    var html = '<div id="pw-reset-form" style="position:fixed;inset:0;background:' + bg + ';z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">'
      + '<div style="max-width:360px;width:100%">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">'
      + logoHtml
      + '<div style="font-size:22px;font-weight:700;color:' + nameCol + ';letter-spacing:-0.3px">' + appName + '</div>'
      + '</div>'
      + '<div style="font-size:20px;font-weight:700;color:' + nameCol + ';margin-bottom:6px">Set a new password</div>'
      + '<div style="font-size:14px;color:#666;margin-bottom:20px">Enter your new password below.</div>'
      + '<div id="pw-reset-msg" style="display:none;margin-bottom:12px"></div>'
      + '<input id="pw-reset-input" type="password" placeholder="New password" autocomplete="new-password"'
      + ' style="width:100%;padding:13px 14px;border:1.5px solid #d5d4d0;border-radius:10px;font-size:15px;box-sizing:border-box;font-family:inherit;margin-bottom:12px;background:#fff;color:#1a1a18">'
      + '<button id="pw-reset-btn" onclick="Mise.auth._submitPasswordReset()"'
      + ' style="width:100%;padding:14px;background:' + btnBg + ';color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">Set new password</button>'
      + '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);

    // Allow Enter key to submit
    document.getElementById('pw-reset-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') Mise.auth._submitPasswordReset();
    });
  }

  // ── _submitPasswordReset ───────────────────────────────────────────────────
  async function _submitPasswordReset() {
    var input = document.getElementById('pw-reset-input');
    var btn   = document.getElementById('pw-reset-btn');
    var msg   = document.getElementById('pw-reset-msg');
    if (!input || !btn) return;

    var pw = input.value.trim();
    if (pw.length < 8) {
      msg.style.cssText = 'display:block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 12px;font-size:13px';
      msg.textContent = 'Password must be at least 8 characters.';
      return;
    }

    btn.textContent = 'Saving…';
    btn.disabled = true;

    try {
      var result = await supabaseClient.auth.updateUser({ password: pw });
      if (result.error) throw result.error;
      // updateUser fires SIGNED_IN via onAuthStateChange — just remove the form
      var el = document.getElementById('pw-reset-form');
      if (el) el.remove();
    } catch (err) {
      msg.style.cssText = 'display:block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 12px;font-size:13px';
      msg.textContent = err.message || 'Could not update password — please try again.';
      btn.textContent = 'Set new password';
      btn.disabled = false;
    }
  }

  // ── _togglePw ──────────────────────────────────────────────────────────────
  // Toggles the password field between hidden and visible, swapping the eye icon.
  function _togglePw() {
    var input = document.getElementById('auth-password');
    var icon  = document.getElementById('auth-pw-eye');
    if (!input || !icon) return;
    if (input.type === 'password') {
      input.type = 'text';
      // Eye-off (slash through eye) when password is visible
      icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      input.type = 'password';
      // Normal eye when password is hidden
      icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  }

  // ── _showEmailConfirmed ────────────────────────────────────────────────────
  // Shown when the user arrives via their email confirmation link.
  // Displays a brief success screen for 2.5 s then proceeds normally.
  function _showEmailConfirmed() {
    return new Promise(function(resolve) {
      hideAuthScreen();
      document.body.insertAdjacentHTML('beforeend',
        '<div id="veriqo-email-confirmed" style="position:fixed;inset:0;background:#f5f4f0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px;text-align:center">'
        + '<div style="width:76px;height:76px;background:#2D7A3A;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:4px">'
        +   '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        + '</div>'
        + '<div style="font-size:26px;font-weight:700;color:#1a1a18;letter-spacing:-0.5px">Email confirmed</div>'
        + '<div style="font-size:15px;color:#555;max-width:290px;line-height:1.6">Welcome to Veriqo. Setting up your account…</div>'
        + '<div style="margin-top:8px;width:36px;height:4px;background:#e5e4de;border-radius:2px;overflow:hidden">'
        +   '<div style="height:100%;background:#2D7A3A;border-radius:2px;animation:veriqo-prog 2.4s linear forwards"></div>'
        + '</div>'
        + '<style>@keyframes veriqo-prog{from{width:0}to{width:100%}}</style>'
        + '</div>'
      );
      // Clean up and continue after 2.5 s
      setTimeout(function() {
        var el = document.getElementById('veriqo-email-confirmed');
        if (el) el.remove();
        // Clear the token hash from the URL so a refresh doesn't re-trigger this
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        resolve();
      }, 2500);
    });
  }

  // ── _tab ───────────────────────────────────────────────────────────────────
  function _tab(tab) {
    _currentTab = tab;
    var isMagic  = tab === 'magic';
    var isSignup = tab === 'signup';

    var pwWrap   = document.getElementById('auth-password') && document.getElementById('auth-password').closest('div[style*="position:relative"]');
    if (pwWrap) pwWrap.style.display = isMagic ? 'none' : '';

    document.getElementById('auth-signup-fields').style.display = isSignup ? 'block' : 'none';
    document.getElementById('auth-forgot-row').style.display    = (!isSignup && !isMagic) ? 'block' : 'none';
    document.getElementById('auth-back-row').style.display      = isMagic ? 'block' : 'none';
    document.getElementById('auth-trial-note').style.display    = isSignup ? 'block' : 'none';
    document.getElementById('auth-submit').textContent          = isMagic ? 'Send magic link' : (isSignup ? 'Create account' : 'Sign in');
    document.getElementById('auth-submit').disabled             = false;
    var altOpts = document.getElementById('auth-alt-options');
    if (altOpts) altOpts.style.display = isMagic ? 'none' : 'block';

    if (!isMagic) {
      var active   = document.getElementById('auth-tab-' + tab);
      var inactive = document.getElementById('auth-tab-' + (isSignup ? 'signin' : 'signup'));
      if (active)   { active.style.background = '#fff'; active.style.color = '#1a1a18'; active.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)'; }
      if (inactive) { inactive.style.background = 'transparent'; inactive.style.color = '#888'; inactive.style.boxShadow = 'none'; }
    }

    _clearMsg();
  }

  // ── _submit ────────────────────────────────────────────────────────────────
  // Handles the main form button — routes to login() or signup().
  async function _submit() {
    if (_currentTab === 'magic') { await _sendMagicLink(); return; }

    var email    = (document.getElementById('auth-email').value    || '').trim();
    var password =  document.getElementById('auth-password').value || '';
    var btn      =  document.getElementById('auth-submit');

    if (!email || !password) { _setMsg('Please enter your email and password.', 'error'); return; }

    btn.textContent = _currentTab === 'signin' ? 'Signing in…' : 'Creating account…';
    btn.disabled = true;
    _clearMsg();

    try {
      if (_currentTab === 'signin') {
        await login(email, password);
      } else {
        var business = (document.getElementById('auth-business').value || '').trim();
        var chefname = (document.getElementById('auth-chefname').value || '').trim();
        await signup(email, password, business, chefname);
      }
    } catch (err) {
      _setMsg(_friendlyError(err.message), 'error');
      btn.textContent = _currentTab === 'signin' ? 'Sign in' : 'Create account';
      btn.disabled = false;
    }
  }

  // ── _sendMagicLink ─────────────────────────────────────────────────────────
  async function _sendMagicLink() {
    var email = (document.getElementById('auth-email').value || '').trim();
    if (!email) { _setMsg('Enter your email address.', 'error'); return; }
    var btn = document.getElementById('auth-submit');
    btn.textContent = 'Sending…'; btn.disabled = true;
    var redirectTo = window.location.origin + window.location.pathname;

    if (window.MISE_AUTH_CONFIG) {
      // Carte — send branded email via Vercel function (keeps Veriqo unchanged)
      try {
        var res = await fetch('/api/carte-magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, redirectTo: redirectTo })
        });
        var json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to send');
        _setMsg('Check your inbox — we\'ve sent you a Carte sign-in link.', 'ok');
        btn.textContent = 'Email sent ✓';
      } catch (err) {
        _setMsg(err.message || 'Something went wrong. Try again.', 'error');
        btn.textContent = 'Send magic link'; btn.disabled = false;
      }
    } else {
      // Veriqo — use Supabase OTP directly (unchanged)
      var result = await supabaseClient.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectTo } });
      if (result.error) {
        _setMsg(_friendlyError(result.error.message), 'error');
        btn.textContent = 'Send magic link'; btn.disabled = false;
      } else {
        _setMsg('Check your inbox — we\'ve sent you a sign-in link.', 'ok');
        btn.textContent = 'Email sent ✓';
      }
    }
  }

  // ── _forgot ────────────────────────────────────────────────────────────────
  async function _forgot() {
    var email = (document.getElementById('auth-email').value || '').trim();
    if (!email) { _setMsg('Enter your email address first.', 'error'); return; }
    try {
      await resetPassword(email);
      _setMsg('Reset link sent — check your inbox.', 'ok');
    } catch (err) {
      _setMsg(_friendlyError(err.message), 'error');
    }
  }

  // ── _google ────────────────────────────────────────────────────────────────
  async function _google() {
    try {
      await loginGoogle();
    } catch (err) {
      _setMsg(_friendlyError(err.message), 'error');
    }
  }

  // ── login ──────────────────────────────────────────────────────────────────
  async function login(email, password) {
    var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw result.error;
    await onSignedIn(result.data.user);
  }

  // ── signup ─────────────────────────────────────────────────────────────────
  async function signup(email, password, businessName, chefName) {
    var result = await supabaseClient.auth.signUp({ email: email, password: password });
    if (result.error) throw result.error;

    if (result.data.user && result.data.session) {
      // Email confirmation is disabled — signed in immediately
      await createProfile(result.data.user, businessName, chefName);
      await onSignedIn(result.data.user);
    } else {
      // Email confirmation is enabled — tell user to check their inbox
      _setMsg('Account created! Check your email to confirm, then sign in.', 'ok');
      var btn = document.getElementById('auth-submit');
      if (btn) { btn.textContent = 'Create account'; btn.disabled = false; }
    }
  }

  // ── loginGoogle ────────────────────────────────────────────────────────────
  async function loginGoogle() {
    var result = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (result.error) throw result.error;
    // Page redirects away — onAuthStateChange handles the return visit
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    if (window.posthog) posthog.reset();
    await supabaseClient.auth.signOut();
    // Clear in-memory app state
    if (typeof records !== 'undefined') records.length = 0;
    // Remove the account card from settings
    var el = document.getElementById('mise-account-card');
    if (el) el.remove();
    // Show the auth screen
    showAuthScreen();
  }

  // ── resetPassword ──────────────────────────────────────────────────────────
  async function resetPassword(email) {
    // Redirect to the current app (Veriqo = /app, Carte = /mise) so the
    // PASSWORD_RECOVERY event fires on the right page.
    var appPath = window.MISE_AUTH_CONFIG ? '/mise' : '/app';
    var result = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + appPath
    });
    if (result.error) throw result.error;
  }

  // ── internal: onSignedIn ───────────────────────────────────────────────────
  async function onSignedIn(user) {
    hideAuthScreen();
    _injectAccountCard(user);
    if (window.posthog) posthog.identify(user.id, { email: user.email });

    // Pull records + settings from Supabase, hydrate localStorage, then re-render
    if (window.Mise && window.Mise.sync) {
      await Mise.sync.loadAll(user.id);
    }

    // Check subscription — shows paywall if trial expired or cancelled
    if (window.Mise && window.Mise.subscription) {
      await Mise.subscription.check(user.id);
    }
    if (window.Mise && window.Mise.carteSubscription) {
      await Mise.carteSubscription.check(user.id);
    }

    // Re-render app with synced data
    if (typeof loadSettings       === 'function') loadSettings();
    // Reload today's records from localStorage — _pullRecords() resets the in-memory
    // records array to what Supabase returned; if the table was empty (e.g. just created)
    // that would clear all local records from view until the next save.
    if (typeof loadToday          === 'function') loadToday();
    if (typeof populateAllSelects === 'function') populateAllSelects();
    if (typeof renderChecklists   === 'function') renderChecklists();
    if (typeof renderAllSections  === 'function') renderAllSections();
    if (typeof updateDashboard    === 'function') updateDashboard();
    // Populate profile card in Settings with saved name/logo
    if (typeof loadProfileUI      === 'function') loadProfileUI();
  }

  // ── internal: showAuthScreen ───────────────────────────────────────────────
  function showAuthScreen() {
    if (document.getElementById('mise-auth')) return; // already visible
    document.body.insertAdjacentHTML('beforeend', _buildAuthHTML());
  }

  // ── internal: hideAuthScreen ───────────────────────────────────────────────
  function hideAuthScreen() {
    var el = document.getElementById('mise-auth');
    if (el) el.remove();
  }

  // ── internal: _injectAccountCard ──────────────────────────────────────────
  // Adds an "Account" card at the top of the Settings tab showing the user's
  // email and a Sign out button. Removed on logout.
  function _injectAccountCard(user) {
    if (document.getElementById('mise-account-card')) return;
    var settingsTab = document.getElementById('tab-settings');
    if (!settingsTab) return;

    var card = document.createElement('div');
    card.id = 'mise-account-card';
    card.className = 'card';
    card.style.marginBottom = '16px';
    card.innerHTML = '<div class="card-title">Account</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1a1a18">' + _esc(user.email) + '</div>'
      +     '<div style="font-size:12px;color:#888;margin-top:2px">Signed in</div>'
      +   '</div>'
      +   '<button onclick="Mise.auth.logout()" style="padding:8px 14px;background:#f0f0ec;border:1px solid #e5e4de;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;color:#1a1a18;font-family:inherit">Sign out</button>'
      + '</div>';

    settingsTab.insertBefore(card, settingsTab.firstChild);
  }

  // ── internal: createProfile ────────────────────────────────────────────────
  async function createProfile(user, businessName, chefName) {
    var trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    var result = await supabaseClient.from('profiles').insert({
      id: user.id,
      business_name: businessName || '',
      chef_name: chefName || '',
      subscription_status: 'trial',
      trial_ends_at: trialEnds
    });
    if (result.error) console.warn('[Veriqo] createProfile error:', result.error.message);
  }

  // ── internal: message helpers ──────────────────────────────────────────────
  function _setMsg(msg, type) {
    var el = document.getElementById('auth-msg');
    if (!el) return;
    el.textContent = msg;
    if (type === 'ok') {
      el.style.cssText = 'display:block;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:10px';
    } else {
      el.style.cssText = 'display:block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:10px';
    }
  }

  function _clearMsg() {
    var el = document.getElementById('auth-msg');
    if (el) el.style.display = 'none';
  }

  function _friendlyError(msg) {
    if (!msg) return 'Something went wrong — please try again.';
    if (msg.includes('Invalid login credentials'))   return 'Incorrect email or password.';
    if (msg.includes('Email not confirmed'))         return 'Please confirm your email address first.';
    if (msg.includes('User already registered'))     return 'An account with this email already exists — try signing in.';
    if (msg.includes('Password should be'))         return 'Password must be at least 6 characters.';
    if (msg.includes('Unable to validate email'))    return 'Please enter a valid email address.';
    return msg;
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Expose internal tab/form handlers so onclick attributes in injected HTML can call them
  return { init, login, signup, loginGoogle, logout, resetPassword, _submitPasswordReset, _tab, _submit, _forgot, _google, _togglePw };

})();
