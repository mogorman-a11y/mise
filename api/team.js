// api/team.js — Team management for multi-venue Veriqo
//
// Single endpoint, action-dispatched via POST body { action }.
//
//   POST /api/team  { action: 'invite',        email, role }
//   POST /api/team  { action: 'update',        targetUserId, role? | remove? }
//   POST /api/team  { action: 'cancel-invite', targetUserId }
//
// All requests require:
//   Authorization: Bearer <supabase_access_token>
//   Content-Type: application/json
//
// All responses are JSON:
//   Success → { success: true, data?: any }
//   Error   → { error: 'ERROR_CODE_STRING' }
//
// Named error codes (for frontend to handle specifically):
//   UNAUTHORIZED        — no/invalid token
//   FORBIDDEN           — caller lacks owner/admin role
//   FUP_LIMIT_REACHED   — venue has >= 30 active members; invite blocked
//   TARGET_NOT_FOUND    — targetUserId not in this venue
//   CANNOT_MODIFY_OWNER — admins cannot update or remove an owner row
//   INVALID_ACTION      — unknown action value
//   BAD_REQUEST         — missing required fields
//
// ── PREREQUISITE ──────────────────────────────────────────────────────────────
// profiles.status column must exist before deploying this file.
// Run once in Supabase SQL editor (or add to a follow-up migration):
//
//   ALTER TABLE public.profiles
//     ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
//
// ── FUNCTION CAP NOTE ─────────────────────────────────────────────────────────
// Vercel Hobby plan allows 12 serverless functions. api/generate-bio.js was
// merged into api/parse-menu.js as the 'bio' action (2026-07-22, VQ-006) —
// that was the suggested candidate for exactly this headroom. If this file
// still pushes the count over the cap, exclude another function in
// .vercelignore or upgrade to Vercel Pro.
//
// ── ENV VARS REQUIRED ─────────────────────────────────────────────────────────
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// =============================================================================

'use strict';

const { createClient } = require('@supabase/supabase-js');

// ── Supabase service-role client (singleton, matches existing api/* pattern) ──

let _sb;
function getSB() {
  if (!_sb) {
    _sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return _sb;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Verify the Bearer token with Supabase and return the caller's user id.
 * Returns null if the token is missing, expired, or invalid.
 *
 * @param {string} token
 * @returns {Promise<string|null>}
 */
async function verifyUser(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

/**
 * Decode the JWT payload to read custom claims embedded by the
 * custom_access_token_hook (venue_id, user_role).
 *
 * Safe to call after verifyUser() has confirmed the token is genuine —
 * Supabase validated the signature; we are only reading the payload.
 *
 * @param {string} token
 * @returns {{ venue_id: string|null, user_role: string|null }}
 */
function jwtClaims(token) {
  try {
    const payload = token.split('.')[1];
    // Base64url → base64 padding
    const padded = payload + '=='.slice(0, (4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    return {
      venue_id:  decoded.venue_id  || null,
      user_role: decoded.user_role || null,
    };
  } catch {
    return { venue_id: null, user_role: null };
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

/**
 * Invite a new team member to the caller's venue.
 *
 * @param {{ email: string, role: 'admin'|'staff' }} body
 * @param {string} callerId
 * @param {{ venue_id: string, user_role: string }} claims
 * @param {import('http').ServerResponse} res
 */
async function inviteTeamMember(body, callerId, claims, res) {
  const { email, role } = body;

  if (!email || !role) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }
  if (!['admin', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }

  // Only owner or admin may invite
  if (!['owner', 'admin'].includes(claims.user_role)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (!claims.venue_id) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const sb = getSB();

  // ── Fair-use policy: count active (non-pending) members in this venue ──────
  const { count, error: countErr } = await sb
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', claims.venue_id)
    .eq('status', 'active');

  if (countErr) {
    console.error('[team/invite] count error:', countErr.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  if (count >= 30) {
    return res.status(403).json({ error: 'FUP_LIMIT_REACHED' });
  }

  // ── Send the invite via Supabase Auth admin ───────────────────────────────
  // If the email already exists as a pending (uninvited) user, delete and
  // re-invite so the owner can resend without manually cancelling first.
  const REDIRECT = 'https://getveriqo.co.uk/app';
  let { data: inviteData, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: REDIRECT, data: { venue_id: claims.venue_id, role } }
  );

  if (inviteErr) {
    const alreadyExists = inviteErr.message?.toLowerCase().includes('already');
    if (alreadyExists) {
      // Look up the existing user — if they're a pending invite in this venue,
      // delete the stale auth record and resend. If they're an active member
      // of any venue, block the invite.
      const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const existing = (users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());

      if (existing) {
        const existingProfile = await sb.from('profiles')
          .select('venue_id, status')
          .eq('id', existing.id)
          .maybeSingle();
        const prof = existingProfile.data;

        const isPendingInThisVenue = prof
          && prof.venue_id === claims.venue_id
          && prof.status === 'pending';

        if (isPendingInThisVenue) {
          // Safe to delete and resend
          await sb.auth.admin.deleteUser(existing.id);
          await sb.from('profiles').delete().eq('id', existing.id);
          // Re-invite
          ({ data: inviteData, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(
            email,
            { redirectTo: REDIRECT, data: { venue_id: claims.venue_id, role } }
          ));
        } else if (prof && prof.venue_id) {
          // Active member of some venue — block
          return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS' });
        } else {
          // Has a Veriqo account but no venue — block, they should sign in themselves
          return res.status(409).json({ error: 'EMAIL_ALREADY_EXISTS' });
        }
      }
    }

    // If still erroring after the resend attempt
    if (inviteErr) {
      console.error('[team/invite] inviteUserByEmail error:', inviteErr.message);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  }

  const inviteeId = inviteData?.user?.id;
  if (!inviteeId) {
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  // ── Insert a pending profile row so the team dashboard can list it ─────────
  // The invitee's auth record exists; we pre-populate their profile so the
  // team list shows the invite immediately. status='pending' until they
  // accept the email link and complete sign-in.
  const { error: profileErr } = await sb
    .from('profiles')
    .upsert(
      {
        id:                  inviteeId,
        venue_id:            claims.venue_id,
        role,
        invited_by:          callerId,
        status:              'pending',
        subscription_status: 'active',
        subscription_plan:   'pro',
        // Populate empty defaults so the row is valid
        business_name: '',
        chef_name:     '',
      },
      { onConflict: 'id' }
    );

  if (profileErr) {
    console.error('[team/invite] profile upsert error:', profileErr.message);
    // Invite email was sent — don't fail the whole request; log and continue.
    // The invited user can still accept; the pending row will be created on
    // their first sign-in by auth.js createProfile().
  }

  // ── Branded invite email via Resend ──────────────────────────────────────
  // Supabase already sends its own invite email with the magic link.
  // We send a second, branded email so the invitee knows it's from Veriqo
  // and understands what they're being invited to.
  try {
    const { data: inviterProf } = await sb
      .from('profiles')
      .select('business_name, chef_name')
      .eq('id', callerId)
      .maybeSingle();
    const businessName = (inviterProf && inviterProf.business_name) || 'your team';
    const inviterName  = (inviterProf && inviterProf.chef_name)     || 'Your team owner';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Veriqo <hello@getveriqo.co.uk>',
        to:      [email],
        subject: inviterName + ' has invited you to join ' + businessName + ' on Veriqo',
        html:    _buildInviteEmail(inviterName, businessName, role),
      }),
    });
  } catch (emailErr) {
    // Non-fatal — Supabase's own invite email was already sent
    console.warn('[team/invite] branded email error:', emailErr.message);
  }

  return res.status(200).json({
    success: true,
    data: { inviteeId, email, role, status: 'pending' },
  });
}

function _buildInviteEmail(inviterName, businessName, role) {
  const roleLabel = role === 'admin' ? 'Admin' : 'Staff';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Veriqo Invite</title></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 20px 24px">

  <div style="background:#1C2B1E;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.4px">You're invited to Veriqo</div>
    <div style="font-size:13px;color:#C8A96E;margin-top:6px;font-weight:500">${_esc(businessName)}</div>
  </div>

  <div style="background:#ffffff;padding:32px;border-radius:0 0 16px 16px;border:1px solid #E2DDD5;border-top:0">
    <p style="margin:0 0 18px;font-size:15px;color:#5A544E;line-height:1.65">Hi there,</p>
    <p style="margin:0 0 18px;font-size:15px;color:#5A544E;line-height:1.65">
      <strong>${_esc(inviterName)}</strong> has invited you to join <strong>${_esc(businessName)}</strong> on Veriqo as a <strong>${roleLabel}</strong>.
    </p>
    <p style="margin:0 0 18px;font-size:15px;color:#5A544E;line-height:1.65">
      Veriqo is food safety and kitchen management for private chefs — HACCP logs, menus, jobs, and more. You'll share the same workspace as your team.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#15803d;margin-bottom:4px">Check your inbox for a sign-in link</div>
      <div style="font-size:13px;color:#5A544E;line-height:1.55">We've sent you a separate email with a one-click sign-in link. Click it to accept the invite and set up your account.</div>
    </div>
    <p style="margin:0;font-size:13px;color:#A09890;line-height:1.6">
      If you weren't expecting this invite or don't recognise ${_esc(businessName)}, you can safely ignore both emails.
    </p>
  </div>

  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:14px">Questions? Reply to this email — we read everything.</p>
  <p style="text-align:center;font-size:12px;color:#A09890;margin-top:6px">
    Veriqo &middot; <a href="https://getveriqo.co.uk" style="color:#A09890;text-decoration:none">getveriqo.co.uk</a>
  </p>
</div>
</body>
</html>`;
}

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Update a team member's role or remove them from the venue.
 *
 * @param {{ targetUserId: string, role?: string, remove?: boolean }} body
 * @param {string} callerId
 * @param {{ venue_id: string, user_role: string }} claims
 * @param {import('http').ServerResponse} res
 */
async function updateTeamMember(body, callerId, claims, res) {
  const { targetUserId, role, remove } = body;

  if (!targetUserId) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }
  if (!remove && !role) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }

  // Only owner or admin may update
  if (!['owner', 'admin'].includes(claims.user_role)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (!claims.venue_id) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const sb = getSB();

  // Fetch the target profile — must belong to the same venue
  const { data: target, error: fetchErr } = await sb
    .from('profiles')
    .select('id, role, venue_id')
    .eq('id', targetUserId)
    .eq('venue_id', claims.venue_id)
    .single();

  if (fetchErr || !target) {
    return res.status(404).json({ error: 'TARGET_NOT_FOUND' });
  }

  // Block: admins cannot modify an owner; owners cannot demote themselves
  // via this action (ownership transfer is a separate, deliberate flow)
  if (target.role === 'owner') {
    return res.status(403).json({ error: 'CANNOT_MODIFY_OWNER' });
  }

  // Build update payload
  let patch;
  if (remove) {
    // Remove from venue: null out venue_id and role; reset status to 'active'
    // so the account remains valid for re-invitation later.
    patch = { venue_id: null, role: 'staff', status: 'active' };
  } else {
    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({ error: 'BAD_REQUEST' });
    }
    patch = { role };
  }

  const { error: updateErr } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', targetUserId);

  if (updateErr) {
    console.error('[team/update] profile update error:', updateErr.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  return res.status(200).json({ success: true });
}

/**
 * Cancel a pending invite by deleting the placeholder profile row.
 * Only removes rows with status='pending' — won't touch accepted members.
 *
 * @param {{ targetUserId: string }} body
 * @param {string} callerId
 * @param {{ venue_id: string, user_role: string }} claims
 * @param {import('http').ServerResponse} res
 */
async function cancelInvite(body, callerId, claims, res) {
  const { targetUserId } = body;

  if (!targetUserId) {
    return res.status(400).json({ error: 'BAD_REQUEST' });
  }

  // Only owner or admin may cancel invites
  if (!['owner', 'admin'].includes(claims.user_role)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (!claims.venue_id) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const sb = getSB();

  // Delete only if:
  //  - belongs to this venue (prevents cross-venue deletion)
  //  - status is 'pending' (prevents cancelling an accepted member by mistake)
  const { error: deleteErr, count } = await sb
    .from('profiles')
    .delete({ count: 'exact' })
    .eq('id', targetUserId)
    .eq('venue_id', claims.venue_id)
    .eq('status', 'pending');

  if (deleteErr) {
    console.error('[team/cancel-invite] delete error:', deleteErr.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  if (count === 0) {
    // Row didn't exist, wrong venue, or invite already accepted — not an error
    // from the caller's perspective; the invite is gone either way.
    return res.status(404).json({ error: 'TARGET_NOT_FOUND' });
  }

  // Also revoke the pending auth invite so they can't accept it after cancellation
  const { error: revokeErr } = await getSB().auth.admin.deleteUser(targetUserId);
  if (revokeErr) {
    // Non-fatal: log it. Profile row is gone; worst case is a stale auth record
    // that will expire naturally.
    console.error('[team/cancel-invite] revokeUser error:', revokeErr.message);
  }

  return res.status(200).json({ success: true });
}

// ── GET /api/team — list team members for the caller's venue ─────────────────
//
// Returns:
//   { success: true, data: [{ id, email, chef_name, role, status, invited_by }] }
//
// Joins profiles (service role) with auth.admin.listUsers() to resolve emails.
// Only returns profiles belonging to the caller's venue_id JWT claim.

async function listTeamMembers(callerId, claims, res) {
  if (!claims.venue_id) {
    // Solo user — no venue yet
    return res.status(200).json({ success: true, data: [] });
  }

  const sb = getSB();

  // Fetch all profiles for this venue
  const { data: profiles, error: profilesErr } = await sb
    .from('profiles')
    .select('id, chef_name, role, status, invited_by')
    .eq('venue_id', claims.venue_id);

  if (profilesErr) {
    console.error('[team/list] profiles error:', profilesErr.message);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }

  if (!profiles || profiles.length === 0) {
    return res.status(200).json({ success: true, data: [] });
  }

  // Resolve emails via auth admin — listUsers fetches up to 1000 (fine for <=30 cap)
  const { data: { users }, error: usersErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = {};
  if (!usersErr && users) {
    users.forEach(function(u) { emailMap[u.id] = u.email; });
  }

  const team = profiles.map(function(p) {
    return {
      id:         p.id,
      email:      emailMap[p.id] || null,
      chef_name:  p.chef_name   || null,
      role:       p.role,
      status:     p.status,
      invited_by: p.invited_by  || null,
      is_self:    p.id === callerId,
    };
  });

  return res.status(200).json({ success: true, data: team });
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://getveriqo.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // ── Verify caller ──────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const callerId = await verifyUser(token);
  if (!callerId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  // ── Read venue_id and user_role from JWT claims ────────────────────────────
  // The custom_access_token_hook embedded these when Supabase issued the token.
  // verifyUser() already confirmed the token is genuine, so decoding is safe.
  const claims = jwtClaims(token);

  // ── Dispatch ───────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    return listTeamMembers(callerId, claims, res);
  }

  const body = req.body || {};
  const action = body.action;

  switch (action) {
    case 'invite':
      return inviteTeamMember(body, callerId, claims, res);

    case 'update':
      return updateTeamMember(body, callerId, claims, res);

    case 'cancel-invite':
      return cancelInvite(body, callerId, claims, res);

    default:
      return res.status(400).json({ error: 'INVALID_ACTION' });
  }
};
