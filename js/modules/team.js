// js/modules/team.js — Team Management dashboard (Settings > Team)
// Depends on: supabaseClient (global from supabase.js), toast (global from menus.js/haccp.js)

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var _members = [];       // cached team list from last fetch
  var _myRole  = null;     // calling user's role (from profile)

  // ── Token helper ───────────────────────────────────────────────────────────
  async function _getToken() {
    var res = await supabaseClient.auth.getSession();
    return res.data && res.data.session ? res.data.session.access_token : null;
  }

  // ── API calls ──────────────────────────────────────────────────────────────
  async function _apiFetch(method, body) {
    var token = await _getToken();
    if (!token) return { error: 'UNAUTHORIZED' };
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch('/api/team', opts);
    return res.json();
  }

  async function _loadTeam() {
    var data = await _apiFetch('GET');
    if (data.error) { console.error('[team] load error:', data.error); return []; }
    return data.data || [];
  }

  async function _invite(email, role) {
    return _apiFetch('POST', { action: 'invite', email: email, role: role });
  }

  async function _update(targetUserId, patch) {
    return _apiFetch('POST', Object.assign({ action: 'update', targetUserId: targetUserId }, patch));
  }

  async function _cancelInvite(targetUserId) {
    return _apiFetch('POST', { action: 'cancel-invite', targetUserId: targetUserId });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function _roleLabel(role) {
    if (role === 'owner') return 'Owner';
    if (role === 'admin') return 'Admin';
    return 'Staff';
  }

  function _roleBadgeStyle(role) {
    if (role === 'owner') return 'background:#eaf3de;color:#1a4a23;';
    if (role === 'admin') return 'background:#fff3cd;color:#7a5a00;';
    return 'background:#f0efe8;color:#5a5752;';
  }

  function _renderRow(m) {
    var isSelf    = m.is_self;
    var isPending = m.status === 'pending';
    var canManage = (_myRole === 'owner' || _myRole === 'admin') && !isSelf && m.role !== 'owner';

    var displayName = m.email || m.chef_name || m.id.slice(0, 8) + '…';
    var subLine = (m.chef_name && m.email && m.chef_name !== m.email)
      ? '<div style="font-size:12px;color:var(--vq-muted);margin-top:1px">' + _esc(m.email) + '</div>'
      : '';

    var badge = '<span style="display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;'
      + 'border-radius:100px;letter-spacing:0.04em;' + _roleBadgeStyle(m.role) + '">'
      + _roleLabel(m.role) + '</span>';

    var statusTag = isPending
      ? '<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;'
        + 'border-radius:100px;background:#fff3cd;color:#7a5a00;margin-left:6px">Pending</span>'
      : '';

    var actions = '';
    if (canManage) {
      if (isPending) {
        actions = '<button onclick="window.vqTeam.cancelInvite(\'' + m.id + '\')" '
          + 'style="font-size:12px;color:var(--vq-fail);background:none;border:none;'
          + 'cursor:pointer;font-family:inherit;padding:4px 0;font-weight:600">'
          + 'Cancel invite</button>';
      } else {
        var otherRole = m.role === 'admin' ? 'staff' : 'admin';
        var otherLabel = m.role === 'admin' ? 'Make Staff' : 'Make Admin';
        actions = '<div style="display:flex;gap:10px;align-items:center">'
          + '<button onclick="window.vqTeam.changeRole(\'' + m.id + '\',\'' + otherRole + '\')" '
          + 'style="font-size:12px;color:var(--vq-green);background:none;border:none;'
          + 'cursor:pointer;font-family:inherit;padding:4px 0;font-weight:600">'
          + otherLabel + '</button>'
          + '<button onclick="window.vqTeam.removeMember(\'' + m.id + '\')" '
          + 'style="font-size:12px;color:var(--vq-fail);background:none;border:none;'
          + 'cursor:pointer;font-family:inherit;padding:4px 0;font-weight:600">'
          + 'Remove</button>'
          + '</div>';
      }
    }

    return '<div id="team-row-' + m.id + '" style="display:flex;align-items:center;justify-content:space-between;'
      + 'gap:12px;padding:11px 0;border-bottom:1px solid var(--vq-rule)">'
      + '<div style="min-width:0;flex:1">'
      +   '<div style="font-size:14px;font-weight:500;color:var(--vq-ink);white-space:nowrap;'
      +   'overflow:hidden;text-overflow:ellipsis">' + _esc(displayName) + (isSelf ? ' <span style="font-size:11px;color:var(--vq-muted)">(you)</span>' : '') + '</div>'
      +   subLine
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
      +   badge + statusTag
      + '</div>'
      + '<div style="flex-shrink:0;min-width:90px;text-align:right">' + actions + '</div>'
      + '</div>';
  }

  function _render() {
    var list = document.getElementById('vq-team-list');
    var empty = document.getElementById('vq-team-empty');
    var count = document.getElementById('vq-team-count');
    if (!list) return;

    if (_members.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      if (count) count.textContent = '';
      return;
    }

    if (empty) empty.style.display = 'none';

    // Sort: owner first, then admin, then staff; pending last within each group
    var sorted = _members.slice().sort(function(a, b) {
      var order = { owner: 0, admin: 1, staff: 2 };
      var ro = (order[a.role] || 2) - (order[b.role] || 2);
      if (ro !== 0) return ro;
      if (a.status === 'pending' && b.status !== 'pending') return 1;
      if (b.status === 'pending' && a.status !== 'pending') return -1;
      return 0;
    });

    list.innerHTML = sorted.map(_renderRow).join('');

    var active = _members.filter(function(m) { return m.status !== 'pending'; }).length;
    var pending = _members.filter(function(m) { return m.status === 'pending'; }).length;
    var parts = [active + ' member' + (active !== 1 ? 's' : '')];
    if (pending) parts.push(pending + ' pending');
    if (count) count.textContent = parts.join(' · ');
  }

  // ── Escape helper (may not be defined in this scope) ──────────────────────
  function _esc(str) {
    if (typeof vqEsc === 'function') return vqEsc(str);
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Public actions (called from inline onclick) ────────────────────────────
  async function changeRole(targetId, newRole) {
    var btn = document.querySelector('#team-row-' + targetId + ' button');
    if (btn) btn.disabled = true;

    var data = await _update(targetId, { role: newRole });
    if (data.error) {
      toast('Could not update role — ' + data.error, 'err');
      if (btn) btn.disabled = false;
      return;
    }
    // Optimistic: update local state and re-render
    _members = _members.map(function(m) {
      return m.id === targetId ? Object.assign({}, m, { role: newRole }) : m;
    });
    _render();
    toast('Role updated ✓');
  }

  async function removeMember(targetId) {
    // Look the name up from cached members rather than passing it through the
    // inline onclick (which would re-decode HTML entities and reopen an injection).
    var _m = _members.find(function(x) { return x.id === targetId; });
    var displayName = _m ? (_m.email || _m.chef_name || _m.id.slice(0, 8) + '…') : 'this member';
    if (!confirm('Remove ' + displayName + ' from your team? They will lose access immediately.')) return;

    var row = document.getElementById('team-row-' + targetId);
    if (row) row.style.opacity = '0.4';

    var data = await _update(targetId, { remove: true });
    if (data.error) {
      toast('Could not remove member — ' + data.error, 'err');
      if (row) row.style.opacity = '1';
      return;
    }
    _members = _members.filter(function(m) { return m.id !== targetId; });
    _render();
    toast('Member removed');
  }

  async function cancelInvite(targetId) {
    var row = document.getElementById('team-row-' + targetId);
    if (row) row.style.opacity = '0.4';

    var data = await _cancelInvite(targetId);
    if (data.error) {
      toast('Could not cancel invite — ' + data.error, 'err');
      if (row) row.style.opacity = '1';
      return;
    }
    _members = _members.filter(function(m) { return m.id !== targetId; });
    _render();
    toast('Invite cancelled');
  }

  // ── Invite form submission ─────────────────────────────────────────────────
  async function submitInvite() {
    var emailEl = document.getElementById('vq-team-email');
    var roleEl  = document.getElementById('vq-team-role');
    var btn     = document.getElementById('vq-team-invite-btn');
    var email   = (emailEl ? emailEl.value : '').trim();
    var role    = roleEl ? roleEl.value : 'staff';

    if (!email || !email.includes('@')) {
      toast('Enter a valid email address', 'err');
      if (emailEl) emailEl.focus();
      return;
    }

    var orig = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

    var data = await _invite(email, role);

    if (data.error === 'FUP_LIMIT_REACHED') {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
      vqShowTeamFupModal();
      return;
    }

    if (data.error) {
      var msg = data.error === 'EMAIL_ALREADY_EXISTS'
        ? 'That email already has a Veriqo account'
        : 'Could not send invite — ' + data.error;
      toast(msg, 'err');
      if (btn) { btn.textContent = orig; btn.disabled = false; }
      return;
    }

    // Success — add optimistically and re-render
    if (data.data) {
      _members.push({
        id:        data.data.inviteeId,
        email:     email,
        chef_name: null,
        role:      role,
        status:    'pending',
        is_self:   false,
        invited_by: null,
      });
      _render();
    }

    if (emailEl) emailEl.value = '';
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    toast('Invite sent to ' + email + ' ✓');
  }

  // ── Init (called by window.modules.settings.init every settings visit) ────
  async function init() {
    var card = document.getElementById('vq-team-card');
    if (!card) return;

    // Always re-fetch the profile from Supabase so role/venue_id are current,
    // even if the user signed in before the backfill ran or before a role change.
    var profile = {};
    try {
      var uid = window.Mise && window.Mise.profile && window.Mise.profile.id
        ? window.Mise.profile.id
        : null;
      if (!uid) {
        var sess = await supabaseClient.auth.getSession();
        uid = sess.data && sess.data.session ? sess.data.session.user.id : null;
      }
      if (uid) {
        var res = await supabaseClient.from('profiles').select('role, venue_id, subscription_status').eq('id', uid).single();
        if (res.data) {
          profile = res.data;
          // Keep window.Mise.profile in sync so rest of app sees updated role
          if (window.Mise && window.Mise.profile) {
            window.Mise.profile.role     = profile.role;
            window.Mise.profile.venue_id = profile.venue_id;
          }
          // If the JWT claims are stale (minted before the role/venue backfill),
          // force a token refresh so API calls carry the correct claims.
          // Decode the JWT payload to check without a network call.
          try {
            var sessNow = await supabaseClient.auth.getSession();
            var tok = sessNow.data && sessNow.data.session ? sessNow.data.session.access_token : null;
            if (tok) {
              var jwtClaims = JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
              var claimRole  = jwtClaims.user_role;
              var claimVenue = jwtClaims.venue_id;
              if (claimRole !== profile.role || claimVenue !== profile.venue_id) {
                // JWT is out of date — refresh silently so API calls will pass
                await supabaseClient.auth.refreshSession();
              }
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
    _myRole = profile.role || null;

    // Only owners and admins see the team management card
    if (_myRole !== 'owner' && _myRole !== 'admin') {
      card.style.display = 'none';
      return;
    }

    // ── SUBSCRIPTION GATE (Option C — implement post-launch) ──────────────────
    // During testing and launch: all owners/admins get full Team access.
    //
    // When ready to gate:
    //   var status = profile.subscription_status;
    //   if (status === 'expired' || status === 'past_due') {
    //     // Show the card in read-only/locked state with an upgrade CTA
    //     // Disable the invite form and action buttons
    //     // Use window.Mise.subscription.startCheckout() for the upgrade flow
    //     card.style.display = 'block';
    //     _renderLockedState();
    //     return;
    //   }
    // Trial users (status === 'trial') get full access — no change needed there.
    // ─────────────────────────────────────────────────────────────────────────

    card.style.display = 'block';

    // Show loading state
    var list = document.getElementById('vq-team-list');
    if (list) list.innerHTML = '<div style="font-size:13px;color:var(--vq-muted);padding:12px 0">Loading…</div>';

    _members = await _loadTeam();
    _render();
  }

  // ── Expose globals ────────────────────────────────────────────────────────
  window.vqTeam = { changeRole: changeRole, removeMember: removeMember, cancelInvite: cancelInvite };
  window.vqTeamSubmitInvite = submitInvite;
  window.vqTeamInit = init;

  // Register with settings module so it runs on every settings visit
  if (window.modules && window.modules.settings) {
    var _origInit = window.modules.settings.init;
    window.modules.settings.init = function() {
      _origInit();
      init();
    };
  }
})();
