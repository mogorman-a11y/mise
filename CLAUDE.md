# Mise Labs Suite — Project Reference

## ⚠ UNIFICATION COMPLETE (2026-05-17)

Three separate apps (Veriqo HACCP, Carte Menus, Yield Costing) have been merged into **one unified Veriqo PWA** at `getveriqo.co.uk/app`. Sub-brand names "Carte" and "Yield" are retired. "Veriqo" is now a kitchen management system, not just a HACCP app.

**New file structure (all inside `files/`):**
```
app.html                        ← unified shell (5 module panels + nav)
js/
  core/
    subscription.js (v1)        ← merged 2-tier starter/pro logic + canAccess()
    sync.js (v12)               ← unchanged (was already unified in a prior session)
    supabase.js                 ← unchanged
  modules/
    dashboard.js (v1)           ← NEW: cross-module KPIs + locked widgets
    haccp.js (v1)               ← extracted from old app.html inline script
    menus.js (v1)               ← extracted from mise.html inline script
    costing.js (v1)             ← extracted from yield.html inline script
css/
  tokens.css                    ← NEW: all --vq-* design tokens
  shell.css                     ← NEW: nav, auth overlay, tease screens, nudges
  dashboard.css                 ← NEW
  haccp.css                     ← extracted from app.html <style>
  menus.css                     ← extracted from mise.html <style>
  costing.css                   ← extracted from yield.html <style>
```

**Retired files** (still on disk for reference, no longer loaded or deployed-to by routing):
`mise.html`, `yield.html`, `mise-sync.js`, `yield-sync.js`, `carte-subscription.js`, `yield-subscription.js`, `mise-manifest.json`, `yield-manifest.json`

**`/mise` and `/yield` routes** now 301 → `/app` (updated in `vercel.json`).

**New Supabase tables (migration `veriqo_unification_phase7` applied 2026-05-17):**
- `kitchens` (id, name, owner_user_id, created_at)
- `kitchen_members` (kitchen_id, user_id, role, joined_at)
- `kitchen_id UUID` FK added to: `profiles`, `clients`, `dishes`, `menus`, `menu_dishes`, `jobs`, `haccp_records`, `mise_records`, `quotes`, `costings`, `invoices`, `payments`
- `profiles` gained: `starter_module TEXT`, `default_module TEXT`
- On signup: `auth.js createProfile()` auto-creates a `kitchens` row + `kitchen_members` owner row

**Subscription plan cleanup:**
- Old plan names (`veriqo`, `suite`, `suite-all`, `carte`, `yield`) all normalised → `'pro'` by `stripe-webhook` v18
- New values: `null` (trial), `'starter'` (one module), `'pro'` (all modules)
- `subscription.js canAccess(moduleName)`: trial → all; pro+active → all; starter+active → dashboard/settings + whichever module matches `starter_module`; expired/past_due → dashboard/settings only

**Deploy chain changed** — see Deploy section below.

**UI/UX Round 4 (2026-05-18):**
- **Full polish pass complete** — 11-item pass covering icons, tokens, nav, buttons, headers, empty states, typography, and copy. Key changes:
  - `vqIcon(name, size)` helper added to `app.html` — returns pre-baked Lucide-style inline SVG strings; used throughout for all icon rendering (no CDN dependency)
  - `tokens.css`: `--vq-muted` darkened `#888888 → #5a5752` (WCAG AA ~5.1:1 on cream); `--vq-subtle: #7a7870`; added `--vq-subtle-decorative: #aaaaaa`; full `--color-*` semantic alias block; `--vq-text-xs` → `--vq-text-2xl` type scale
  - `shell.css`: nav `border-top` restored; active pill background `rgba(45,122,58,0.18)`; active label green + bold; inactive labels use `--color-text-secondary`; `.vq-module-greeting` / `.vq-module-greeting-hello` / `.vq-module-greeting-biz` CSS classes added; tease-icon updated for SVG
  - `menus.css` + `haccp.css` + `costing.css`: btn-primary → green, btn-secondary → green border; `.vq-btn` button system (primary/secondary/destructive/neutral/full) defined in `menus.css`; `.card-title` promoted to 14px sentence-case + `.card-sublabel` added for small all-caps
  - Module headers: large 56px logo blocks removed from HACCP and Menus home screens; `.vq-module-greeting` blocks added (populated by `showModule()` with time-based greeting + business name from `veriqo_profile`)
  - "Open Tabs" → "Open Invoices" throughout `costing.js` and `app.html`
  - Profile PDF button relocated from orphaned Menus home position → top of Clients list tab
  - Stat label pluralisation (`Client/Clients`, `Upcoming/Upcoming`) in `menus.js`
  - Nav haptic: `navigator.vibrate(10)` added to `showModule()` at top
  - Header cogs removed from Menus and Costing modules; HACCP retains its cog (links to HACCP settings tab)
  - HACCP settings tab cleaned: Business profile card, Subscription card, Daily reminders card removed (duplicates of main Settings module); Account & subscription help card also removed
  - Costing background `--bg` aligned `#F5F0E8 → #f5f4f0` to match Veriqo/HACCP/Menus; `--surface-el` and `--surface-deep` updated to match; `--border` updated to `#e5e4de`
  - Costing header date alignment fixed (inner div given `flex:1`)

**UI/UX Round 3 (2026-05-17):**
- **Branding purge complete** — all legacy Carte gold (`#C8A96E`) and Yield gold (`#C9A84C`) references removed from `app.html`, `menus.js`, `costing.js`, and `haccp.js`. Every hardcoded colour replaced with Veriqo green (`#2D7A3A` on light, `#7ACC8A` on dark `#1C2B1E` banner). Includes dynamic content built at runtime by `updateNextJobBanner()` in `haccp.js` — that was the last holdout (menu name, location, phone, email links all now `#7ACC8A`). Also renamed all "Carte", "Yield", "YIELD QUOTE" strings to "Veriqo"/"Menus"/"COSTING QUOTE" throughout.
- **Nav bar redesign** — `shell.css` mobile bottom nav now uses a soft upward `box-shadow` instead of hard `border-top`; active tab shows a rounded green pill (`--vq-green-light` = `#EAF3DE`) via `::before` pseudo-element (`inset: 7px 5px; border-radius: 14px`); active icon lifts 1px (`transform: translateY(-1px)`) with `transition: 0.2s`; active label goes `font-weight: 700`. Desktop sidebar: `::before` disabled (`display:none`) — sidebar keeps its existing full-row `background: var(--vq-green-light)`. SW bumped `veriqo-v20` → `veriqo-v21`.

**UI/UX Round 2 (2026-05-17):**
- **Unified module headers** — all three module panels (HACCP, Menus, Costing) now use the same static Costing-style header: Veriqo shield SVG logo + `"Veriqo "` + muted sub-label span (e.g. `"HACCP"`, `"Menus"`, `"Costing"`), off-white `var(--vq-bg)` background (not `--vq-surface`), green `#2D7A3A` gear/settings icon. The sub-label is updated dynamically by each module's tab-switch function. Date text (right-aligned, muted) is injected by `showModule()` in a IIFE when switching to that panel.
- **Costing green theme** — `costing.css` remaps `--gold: var(--vq-green)`, `--gold-dim: var(--vq-green-dark)`, `--gold-bg: var(--vq-green-pale)`. All costing UI (active nav, buttons, form focus rings) now uses Veriqo green instead of the legacy Yield gold.
- **Dashboard auto-loads** — on every login and every `showModule('dashboard')` call, `window.modules.dashboard.render()` is invoked. The `init()` one-time setup is still guarded, but `render()` fires each visit. "Pick up where you left off" toggle in Settings stores `'1'` in `localStorage.vq_resume_module`; last visited module stored in `localStorage.vq_last_module`.
- **`vq:sync-complete` event** — `sync.js _refreshAppViews()` now dispatches `document.dispatchEvent(new CustomEvent('vq:sync-complete'))`. `dashboard.js` re-renders on this event.

---

## Quick Context

**One app, five modules:**

| Module | localStorage prefix | Purpose |
|---|---|---|
| Dashboard | — | Cross-module KPIs, upcoming jobs, locked module widgets |
| HACCP | `haccp_` | Food safety compliance records |
| Menus | `mise_` | Dish library, menus, client CRM, bookings |
| Costing | `yield_` | Job costing, quotes, invoices, P&L |
| Settings | — | Profile, billing, team |

**App URL:** `getveriqo.co.uk/app` (single shell, routing via `showModule(name)`)

**Key objects:**
- `window.Mise.sync` — unified sync (pull/push for all modules)
- `window.Mise.subscription.canAccess(moduleName)` — paywall gate
- `window.Mise.onSignedIn(user)` — called by auth.js post sign-in; fetches the `profiles` row first, then calls `sync.loadAll(uid)` + `subscription.check(profile)` + `showModule()`
- `window.MISE_AUTH_CONFIG = { name: 'Veriqo', appUrl: '/app', logoUrl: '/icons/icon-192.png' }`

**Paths:**
- Working files: `/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/Claude Projects/Mise Lab Suite/files/`
- Supabase: `https://yixrwyfodipfcbhjcszp.supabase.co`

**⚠ CRITICAL — edit only files inside `files/`.** The root `Mise Lab Suite/` directory contains only brand assets, docs, and an `_archive/` folder of old prototype drafts. These are NOT production.

**Landing pages:** `index.html` is the Veriqo marketing homepage at `getveriqo.co.uk/`. Do not overwrite it with an app shell. SEO product pages:

| File | Route | Purpose |
|---|---|---|
| `index.html` | `/` | Suite homepage |
| `veriqo-landing.html` | `/veriqo` | Veriqo product marketing page |
| `carte-landing.html` | `/carte` | Carte product marketing page |
| `yield-info.html` | `/yield-info` | Yield product marketing page (not `/yield` — that's the live app) |
| `resources.html` | `/resources` | Resource hub index |
| `resources/how-to-price-a-bespoke-dinner-party.html` | `/resources/how-to-price-a-bespoke-dinner-party` | First SEO article |

App mockup screenshots (real device PNGs, 390×844 iPhone 14 Pro viewport) live in `files/images/`: `veriqo-interface.png`, `veriqo-allergens.png`, `veriqo-dashboard.png`, `carte-interface.png`, `carte-calendar.png`, `carte-menus.png`, `yield-interface.png`, `yield-costing.png`, `yield-quotes.png`. Homepage cards use `.app-card .mockup-img { width:200px; aspect-ratio:auto; object-fit:initial }` to show phones at natural portrait size; product pages use `aspect-ratio:9/19; object-fit:cover; max-height:340px` in the `.feature-split` grid.

## Deploy chain — read this first

**As of 2026-05-17 the deploy chain is `vercel --prod` directly from `files/`.** The old git-based mise-deploy flow is retired.

```
files/  (working tree, edits live here)
  ↓ vercel deploy --prod  (from inside files/ directory)
Vercel project "files"  (prj_lMBGlA1dkPtLSm3bUn9KZtAKpuWG)
  ↓ auto-routes to
www.getveriqo.co.uk  +  getveriqo.co.uk
```

**To ship anything:**
```bash
cd "/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/Claude Projects/Mise Lab Suite/files"
vercel deploy --prod
```
Vercel CLI must be authenticated (`vercel whoami` → `mogorman-a11y`). The `.vercel/project.json` in `files/` points to the correct project (`prj_lMBGlA1dkPtLSm3bUn9KZtAKpuWG`).

**Domains** — `www.getveriqo.co.uk` and `getveriqo.co.uk` are registered as production domains on the `files` project, so each `vercel deploy --prod` automatically routes traffic to the new deployment with no manual step. If traffic ever stops updating after a deploy, re-add the domains:
```bash
cd "/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/Claude Projects/Mise Lab Suite/files"
vercel domains add www.getveriqo.co.uk --force
vercel domains add getveriqo.co.uk --force
```

**⚠ Old `mise` Vercel project still exists** — do not deploy to it. It is stale and no longer owns the live domains.

**Supabase Edge Functions** (stripe-webhook, create-checkout, etc.) are deployed separately:
```bash
cd "/Users/michael/.../Mise Lab Suite/files"
supabase functions deploy stripe-webhook --project-ref yixrwyfodipfcbhjcszp
```
stripe-webhook is currently on **v18** (includes `normalisePlan()` for legacy → `'pro'` mapping).

---

## Tech Stack

- **Frontend:** Single-file vanilla HTML/CSS/JS — no framework, no bundler. One file per app. All three apps are responsive: mobile layout (≤767px) uses a bottom tab bar / tile grid; desktop (≥768px) switches to a wider layout — Carte and Yield get a fixed 200px sidebar nav, Veriqo widens its tile grid to 4 columns.
- **Auth:** Supabase Auth (email/password + Google OAuth + magic link) via shared `auth.js`. Each app sets `window.MISE_AUTH_CONFIG` before calling `Mise.auth.init()`. Auth fires `window.Mise.onSignedIn(user)` on confirmation.
- **Cloud sync:** Supabase Postgres. `sync.js` (Veriqo), `mise-sync.js` (Carte), `yield-sync.js` (Yield). Pattern: pull on sign-in → localStorage cache → push on save.
- **Transactional email:** Resend (`hello@getveriqo.co.uk`) via `api/magic-link.js` (consolidated magic link + reset for all three apps — `auth.js` calls `/api/magic-link`), `api/welcome-email.js` (instant signup welcome + starter-kit Day 1), `api/trial-emails.js` (Veriqo/Carte trial drip days 5/10/13 + starter-kit Days 2–7), and `api/yield-reminders.js` (Yield payment reminders at -7/-3/0/+3 days — cron via GitHub Actions). Marketing emails respect `email_opt_out` on `profiles` — users opt out via `api/unsubscribe.js`. Note: `api/auth-link.js`, `api/carte-magic-link.js`, `api/yield-magic-link.js` still exist on disk in `files/` but are NOT in mise-deploy/api/ (and so not live) — superseded by `api/magic-link.js` since auth.js v26.
- **Subscription:** Stripe via per-app subscription modules + Supabase Edge Functions (`create-checkout`, `upgrade-subscription`, `stripe-webhook`, `create-portal-session`).
- **PWA:** `sw.js` (network-first for app pages, cache-first for assets; cache name `veriqo-v21`), `manifest.json` (Veriqo), `mise-manifest.json` (Carte), `yield-manifest.json` (Yield).
- **Hosting:** Vercel — `getveriqo.co.uk` DNS. **⚠ Gotcha:** Vercel redirects the apex domain → `www.getveriqo.co.uk` (307). All server-side API calls (GitHub Actions curl, etc.) must use `https://www.getveriqo.co.uk/api/...` — curl without `-L` silently hits "Redirecting..." and the function never runs.

---

## Vercel Configuration

`vercel.json` in repo root (current actual state):
```json
{
  "version": 2,
  "builds": [
    { "src": "api/*.js", "use": "@vercel/node" },
    { "src": "**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1.js" },
    { "src": "/veriqo", "dest": "/veriqo-landing.html" },
    { "src": "/carte", "dest": "/carte-landing.html" },
    { "src": "/yield-info", "dest": "/yield-info.html" },
    { "src": "/resources", "dest": "/resources.html" },
    { "src": "/resources/(.*)", "dest": "/resources/$1.html" },
    { "src": "/mise", "status": 301, "dest": "/app" },
    { "src": "/yield", "status": 301, "dest": "/app" },
    { "src": "/app", "dest": "/app.html" },
    { "src": "/pay", "dest": "/pay.html" },
    { "src": "/event", "dest": "/event.html" },
    { "src": "/client-intake", "dest": "/client-intake.html" }
  ]
}
```

**Note:** Uses `builds` + `routes` format (not `rewrites`). All app routes are explicitly listed. `sw.js` caches all app shell files including `event.html`.

**Vercel cron** — `vercel.json` includes a cron entry for `api/trial-emails.js` (09:00 UTC daily). Trial emails are NOT run via GitHub Actions.

**Vercel env vars required** — set via CLI, not the dashboard (dashboard silently saves empty strings):
```bash
cd "/Users/michael/.../Mise Lab Suite/files"
echo "VALUE" | vercel env add VAR_NAME production
```
- `SUPABASE_URL` — **must be** `https://yixrwyfodipfcbhjcszp.supabase.co` (bare project URL, no `/rest/v1/` path)
- `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` JWT from Supabase Dashboard → Settings → API
- `RESEND_API_KEY`, `CRON_SECRET`
- Stripe keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_VERIQO_MONTHLY_PRICE_ID`, `STRIPE_VERIQO_ANNUAL_PRICE_ID`, `STRIPE_CARTE_MONTHLY_PRICE_ID`, `STRIPE_CARTE_ANNUAL_PRICE_ID`, `STRIPE_SUITE_MONTHLY_PRICE_ID`, `STRIPE_SUITE_ANNUAL_PRICE_ID`, `STRIPE_YIELD_MONTHLY_PRICE_ID`, `STRIPE_YIELD_ANNUAL_PRICE_ID`, `STRIPE_SUITE_ALL_MONTHLY_PRICE_ID`, `STRIPE_SUITE_ALL_ANNUAL_PRICE_ID`

**⚠ `api/magic-link.js` uses direct `fetch` to Supabase admin API** (not the `@supabase/supabase-js` SDK). The SDK's `auth.admin.generateLink` throws "Invalid path specified in request URL" on Vercel serverless — the SDK is removed from this file as of 2026-05-18. Do not re-add the SDK import here.

**Supabase Edge Function secrets** (set via Supabase Dashboard → Edge Functions → Secrets):
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_THIN`
- `STRIPE_PRICE_ID` (Veriqo monthly legacy), `STRIPE_PRICE_ID_ANNUAL`, `STRIPE_PRICE_ID_CARTE_MONTHLY`, `STRIPE_PRICE_ID_CARTE_ANNUAL`, `STRIPE_PRICE_ID_SUITE_MONTHLY`, `STRIPE_PRICE_ID_SUITE_ANNUAL`
- `STRIPE_PRICE_ID_YIELD_MONTHLY`, `STRIPE_PRICE_ID_YIELD_ANNUAL`, `STRIPE_PRICE_ID_SUITE_ALL_MONTHLY`, `STRIPE_PRICE_ID_SUITE_ALL_ANNUAL`

**⚠ Stripe webhook routing:** The live webhook goes to the Supabase edge function (`stripe-webhook`), NOT to `api/stripe-webhook.js` (Vercel). Both exist but only the Supabase one is registered in Stripe Dashboard. The Supabase edge function reads `session.metadata.plan` set by `create-checkout`. The Vercel stub is implemented but not wired to Stripe.

**Gotcha:** Vercel serves `api/*.js` at `/api/filename.js` — the routes entry strips `.js`.

---

## Supabase Tables

All tables have RLS enabled (users can only access their own rows).

### Live tables

| Table | App | Key columns |
|---|---|---|
| `profiles` | All | `business_name`, `chef_name`, `subscription_status`, `subscription_plan`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`, `logo`, `onboarded`, `yield_settings` (jsonb), `email_opt_out` (boolean, default false) |
| `settings` | Veriqo | `config` (JSON) |
| `haccp_records` | Veriqo | `(user_id, date)`, `records` (JSON array) |
| `mise_settings` | Carte | `config` (JSON) |
| `mise_records` | Carte | `(user_id, date)`, `records` (JSON array) |
| `quotes` | Yield | `id` (TEXT PK), `user_id`, `client_name`, `event_date`, `status`, `quote_data` (JSONB — full quote object including extras/flags), `created_at`. RLS: users manage own. Service role used by `api/get-quote.js`. Draft quotes are NOT exposed to clients. |
| `costings` | Yield | `id` (TEXT PK), `user_id`, `costing_data` (JSONB — full costing object), `created_at`. RLS: users manage own. Synced via `yield-sync.js` `saveCosting()`/`deleteCosting()`/`_pullCostings()`. Replaces localStorage-only MVP. |
| `invoices` | Yield | `id` (TEXT PK), `user_id`, `quote_id`, `job_id`, `inv_number`, `type` (deposit/balance), `total`, `paid_total` (default 0), `status` (default 'draft'), `due_date`, `invoice_date`, `client_name`, `notes`, `created_at`. **⚠ Columns after `type` were added via ALTER TABLE — confirm they exist before debugging saves.** |
| `payments` | Yield | `user_id`, `invoice_id`, `job_id`, `amount`, `paid_at`, `method`, `ref` |
| `push_subscriptions` | Veriqo | `endpoint`, `subscription` (JSON) |
| `leads` | Landing | `email`, `source` |
| `freelancer_access` | Veriqo | `id` (UUID PK), `token` (TEXT UNIQUE, UUID default), `job_id` (TEXT FK → jobs), `owner_user_id` (UUID FK → auth.users), `can_edit` (BOOLEAN default false), `expires_at` (TIMESTAMPTZ — job_date + 3 days), `created_at`. RLS: `chef_own` policy — chef manages own rows only. Token is public-safe; entire access model is token-gated, no auth required for the freelancer. |
| `client_intake_tokens` | Carte | `id` (UUID PK), `token` (TEXT UNIQUE, UUID default), `owner_user_id` (UUID FK → auth.users), `label` (TEXT — chef's optional note e.g. "Wedding enquiry"), `expires_at` (TIMESTAMPTZ — null = no expiry), `used_at` (TIMESTAMPTZ — stamped on submission, one-use), `created_at`. RLS: `chef_own` — chef manages own rows. Token is public-safe; anon key + SECURITY DEFINER RPCs handle unauthenticated access. |

**✅ DONE (2026-05-09):** `shared-suite-schema.sql` was run in Supabase. The following shared tables are live with RLS enabled: `business_settings`, `clients`, `staff`, `dishes`, `menus`, `menu_dishes`, `jobs`, `job_menus`, `attachments`, `invoice_items`, `expenses`, `mileage`, `tax_categories`. Note: `invoices` and `payments` were already live with a different structure and were excluded from the schema run. Suite migration Phases 1-3 now complete — all apps use shared tables directly.

**✅ DONE (2026-05-11) — Phase 1 suite migration:** `clients`, `dishes`, `menus`, `menu_dishes` PKs changed from UUID to TEXT (to match Carte's short alphanumeric IDs). All FK columns updated to TEXT. Existing Carte data migrated from `mise_settings.config` JSONB → shared row-based tables (3 clients, 20 dishes, 5 menus, 5 menu_dishes). `mise-sync.js` v6 writes to shared tables on every save. Key schema notes: `savedMenus[i].dishIds` is a numeric integer array (not dish objects); dish IDs in `savedDishes` are also numeric integers stored as TEXT in the shared table.

**Freelancer Access RPCs (SECURITY DEFINER — called with anon key from `event.html`):**

| RPC | Args | Returns | Notes |
|---|---|---|---|
| `get_job_for_freelancer` | `p_token TEXT` | `JSONB {job, can_edit, client}` | Validates token + expiry; joins `clients` by `owner_user_id + name`; returns null on invalid/expired |
| `log_freelancer_haccp` | `p_token TEXT, p_date TEXT, p_record JSONB` | void | Appends record to chef's `haccp_records` row (upserts with `||` concat); raises `invalid_token` on bad token |
| `update_job_for_freelancer` | `p_token TEXT, p_covers TEXT, p_notes TEXT` | void | Updates `jobs` table; raises `invalid_token` or `edit_not_permitted` |

**Client Intake RPCs (SECURITY DEFINER — called with anon key from `client-intake.html`):**

| RPC | Args | Returns | Notes |
|---|---|---|---|
| `get_intake_config` | `p_token TEXT` | `JSONB {is_valid, chef_name, business_name, logo, label}` | Returns branding for public page; `is_valid:false` + `reason` on invalid/expired/used token |
| `submit_intake_form` | `p_token TEXT, p_data JSONB` | `JSONB {success, client_id}` | Inserts into `clients` with `source='intake'`, stamps `used_at` — one-use; raises `invalid_token` on bad/used token |

**Add missing columns if not present:**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS yield_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
```

**⚠ Invoices table — run this if invoices aren't saving (columns may be missing):**
```sql
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS total         numeric,
  ADD COLUMN IF NOT EXISTS paid_total    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status        text    DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS due_date      date,
  ADD COLUMN IF NOT EXISTS invoice_date  date,
  ADD COLUMN IF NOT EXISTS client_name   text,
  ADD COLUMN IF NOT EXISTS notes         text,
  ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();
```
Confirmed 2026-05-08: all 13 columns present and verified in Supabase Table Editor.

---

## Auth

All three apps use shared `auth.js` (v26). Per-app branding via `window.MISE_AUTH_CONFIG` set in each HTML file before scripts load.

**The correct auth init pattern (used in all three apps):**
```javascript
// Define callback BEFORE calling auth.init()
window.Mise = window.Mise || {};
window.Mise.onSignedIn = async function(user) {
  // init sync, load data, render app, check subscription
};
document.addEventListener('DOMContentLoaded', function() {
  window.Mise.auth.init(window.MISE_AUTH_CONFIG);
});
```
auth.js (v15) calls `window.Mise.onSignedIn(user)` once the session is confirmed — there is an explicit check in auth.js's internal `onSignedIn` function:
```javascript
if (window.Mise && typeof window.Mise.onSignedIn === 'function') {
  await window.Mise.onSignedIn(user);
  return;
}
```
This is a generic hook that lets each app own its own init. Without it, the app's `onSignedIn` callback is never called — all data load and rendering is dead code. Do not load data or render the app outside this callback.

**⚠ `app.html` `onSignedIn` correct flow (as of 2026-05-17):** auth.js passes the Supabase user object (has `.id`/`.email` only — no `subscription_status`, `trial_ends_at`, `chef_name`). `onSignedIn` must fetch the `profiles` row separately before calling `subscription.check()`:
```javascript
window.Mise.onSignedIn = function(user) {
  var uid = user.id || user.user_id || '';
  supabaseClient.from('profiles').select('*').eq('id', uid).single()
    .then(function(r) {
      var profile = r.data || {};
      profile.id = uid;
      window.Mise.profile = profile;
      localStorage.setItem('veriqo_profile', JSON.stringify(profile));
      return profile;
    })
    .catch(function() { return { id: uid }; })
    .then(function(profile) {
      return Promise.all([
        window.Mise.sync.loadAll(uid),        // NOT pullAll — that function doesn't exist
        window.Mise.subscription.check(profile)
      ]).then(function() {
        // apply lock badges, then showModule(defaultModule || lastModule || 'dashboard')
      });
    });
};
```
Critical gotchas: (1) `sync.js` exports `loadAll` not `pullAll` — calling `pullAll` is a silent TypeError. (2) Passing the raw auth user object (no profile fields) to `subscription.check()` will leave `subscription_status` undefined, treating every user as expired.

**Magic link / password reset flows:**

| Path | Sends email via | Lands on |
|---|---|---|
| Veriqo magic link | `api/magic-link.js` (type=magiclink, app=veriqo) | `/app?token_hash=...&type=magiclink` |
| Carte magic link | `api/magic-link.js` (type=magiclink, app=carte) | `/mise?token_hash=...&type=magiclink` |
| Yield magic link | `api/magic-link.js` (type=magiclink, app=yield) | `/yield?token_hash=...&type=magiclink` |
| Password reset (all apps) | `api/magic-link.js` (type=recovery) | respective app URL |

All flows use `api/magic-link.js` — a single consolidated handler. `auth.js` detects the app via `window.MISE_AUTH_CONFIG.name` and sends `{ email, type, app }` to `/api/magic-link`. The server calls the Supabase admin API directly via `fetch` (not SDK). All flows use `token_hash` + `verifyOtp` — flow-type independent, works cross-browser.

**⚠ App detection in `auth.js`** (`_sendMagicLink` and `_forgot`): uses explicit name checks — `name === 'Yield'` → yield, `name === 'Carte'` → carte, else → veriqo. Do not use a truthy `window.MISE_AUTH_CONFIG` check as the fallback — that incorrectly assigns Carte branding to Veriqo users.

**Supabase Auth email templates (updated 2026-05-17):** All four system emails (Confirm Signup, Magic Link, Password Reset, Email Change) use the Veriqo design system — off-white `#f5f4f0` background, white card, 4px `#2D7A3A` green top accent, "Veriqo**qo**" wordmark. Applied directly in Supabase Dashboard → Authentication → Email Templates. Template variable for the action link is `{{ .ConfirmationURL }}`.

| Template | Subject | CTA |
|---|---|---|
| Confirm signup | "Confirm your Veriqo account" | "Confirm my account →" |
| Magic link | "Your Veriqo sign-in link" | "Sign in to Veriqo →" |
| Password reset | "Reset your Veriqo password" | "Reset my password →" |
| Email change | "Confirm your new Veriqo email address" | "Confirm new email →" |

**Auth session rules (v26):** (auth.js bumped to v26 to route Yield magic links separately)
- `signOut()` always uses `{ scope: 'local' }` — clears only the current browser session; does NOT globally invalidate the refresh token. This means logging out on one device/app does not kick the user out elsewhere.
- `onAuthStateChange` handles `SIGNED_OUT` only if the user was already inside the app (`_signedIn === true`) — prevents the login screen re-appearing during the init phase while `getSession()` is still resolving.

`_showingResetForm` flag in auth.js blocks `onSignedIn` from firing while the password reset form is showing. Cleared after `updateUser({password})` succeeds.

**Supabase redirect URLs set:** `https://getveriqo.co.uk`, `/app`, `/mise`, `/**`

---

## Subscription & Paywall

### Plans and pricing

| Plan value | Monthly | Annual | Access |
|---|---|---|---|
| `null` | — | — | Trial — all modules. `trial_ends_at = null` means unlimited trial (no expiry set). |
| `starter` | £12 | £120 | Dashboard + Settings + one module (set in `profiles.starter_module`) |
| `pro` | £28 | £280 | All five modules |

`subscription_plan` on `profiles`. Always lowercase. Legacy values (`veriqo`, `suite`, `suite-all`, `carte`, `yield`) are normalised → `'pro'` by stripe-webhook v18's `normalisePlan()`.

### Access rules

| Status | Plan | Dashboard | HACCP | Menus | Costing | Settings |
|---|---|---|---|---|---|---|
| trial (in date) | any | ✅ | ✅ | ✅ | ✅ | ✅ |
| `active` | `pro` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `active` | `starter` | ✅ | if `starter_module='haccp'` | if `starter_module='menus'` | if `starter_module='costing'` | ✅ |
| expired / `past_due` | any | ✅ read-only | ❌ tease | ❌ tease | ❌ tease | ✅ |

Locked modules show a tease screen (`buildTeaseScreen(name)` in `app.html`) with a personalised preview and "Upgrade to Veriqo Pro →" CTA. Inline nudges (`HACCP_NUDGE_MAP`, `MENUS_NUDGE_MAP`) fire dismissible banners pointing users at locked modules when relevant actions are taken.

### Checkout/upgrade flow

New subscriber → `create-checkout` edge function → Stripe Checkout → `stripe-webhook` writes `subscription_status='active'` + `subscription_plan`. Existing active subscriber → `upgrade-subscription` edge function swaps Stripe price with prorations (no second subscription created).

**⚠ `subscription.js` null trial fix:** `inTrial` must treat `null trial_ends_at` as unlimited:
```javascript
var inTrial = status === 'trial' && (!trialEnd || trialEnd > new Date());
// NOT: status === 'trial' && trialEnd && trialEnd > new Date()
// The second form wrongly marks null-expiry accounts as expired.
```

### ⚠ TO REVISIT — Pricing & checkout audit (2026-05-17)

Audited Stripe products and edge functions. Current state has several gaps to resolve:

**Stripe products vs checkout paths:**
- `create-checkout` edge function only accepts `app = 'veriqo' | 'carte' | 'suite'` — maps to env vars `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_CARTE_*` / `STRIPE_PRICE_ID_SUITE_*`
- `suite-all` products exist in Stripe (£28/mo, £280/yr) but **no checkout path leads to them** — the env vars `STRIPE_PRICE_ID_SUITE_ALL_MONTHLY/ANNUAL` are set as Supabase secrets but `create-checkout` never reads them
- No `starter` checkout flow exists — `starter` plan can only be set manually on `profiles.subscription_plan`

**Actual Stripe prices (all GBP):**

| Product | Price |
|---|---|
| Veriqo Monthly (`prod_ULD61xzkqvND08`) | £12/mo |
| Veriqo Annual (`prod_UOc5u93wE3f0Sk`) | £120/yr |
| Suite Monthly (`prod_URpCnw6TQYttex`) | £20/mo |
| Suite Annual (`prod_URpC7qDP52zlYg`) | £200/yr |
| Suite All Monthly (`prod_UU8Q5UON91gjtY`) | £28/mo |
| Suite All Annual (`prod_UU8RE2LR2fEf07`) | £280/yr |
| Yield Monthly (`prod_UU8KZIjIqiC9UY`) | £12/mo |
| Yield Annual (`prod_UU8K3dXhEmZkkB`) | £120/yr |
| Chef to CEO Founding Member (`prod_UVMNnvTMPHiR5A`) | £67/mo |

**Questions to answer:**
1. Now that Carte/Yield are retired sub-brands, should the pricing simplify to just Veriqo (£12/mo) with a single upgrade path?
2. Should `create-checkout` be updated to drop `carte`/`suite` params and only offer `veriqo`?
3. Is `suite-all` still the intended £28 "all modules" product, or is that being retired along with the sub-brands?
4. Should `starter` get a self-serve checkout path?

### Monitoring users
```sql
CREATE VIEW profiles_with_email AS
SELECT p.id, u.email, p.business_name, p.chef_name,
       p.subscription_status, p.subscription_plan,
       p.trial_ends_at, p.stripe_customer_id, p.onboarded, u.created_at
FROM profiles p JOIN auth.users u ON u.id = p.id;
```

---

## Sync Architecture

**Pattern (all three apps):**
1. Sign-in → pull Supabase → full-replace localStorage → render UI
2. Save → push to Supabase → update localStorage
3. Tab focus → re-pull Supabase (Veriqo + Carte only — see below)

Supabase is source of truth. localStorage is a write-through cache.

### Cross-app real-time sync

All three apps share the same Supabase tables. Data written in one app is visible in another as soon as that app re-pulls. The practical effect when switching browser tabs:

| App | Trigger | Behaviour |
|---|---|---|
| Veriqo | `visibilitychange` (tab focus) | Re-pulls records + settings (dishes/menus via `_pullSharedLibrary`) |
| Carte | `visibilitychange` (tab focus) | Re-pulls records + settings (dishes/menus/clients/jobs) |
| Yield | Sign-in only | Pulls once on load; no automatic focus re-pull |

**Example:** Add a dish in Carte → switch to Veriqo tab → Veriqo re-pulls and the dish appears immediately. Yield will see it next sign-in. This is intentional — Yield is primarily read-only for shared library data.

### Suite shared tables (Phase 1-3 complete — 2026-05-11)

All three apps now read from and write to the shared row-based tables. No JSONB cross-sync bridge remains. **Backfill complete (2026-05-11):** all existing users' dishes, menus, menu_dishes, and jobs migrated from JSONB blobs into shared tables.

Post-backfill state: dishes=20/2users, menus=5/3users, menu_dishes=26/3users, jobs=13/4users.

| Data | Table | Notes |
|---|---|---|
| Clients | `clients` | TEXT PK (Carte uid); `notes` = diet field |
| Dishes | `dishes` | TEXT PK; `name` = Carte `dish` field |
| Menus | `menus` | TEXT PK; joined with `menu_dishes` |
| Menu dishes | `menu_dishes` | UUID PK; `menu_id`/`dish_id` TEXT FK; Carte stores dishIds as numeric TEXT |
| Jobs | `jobs` | TEXT PK; `metadata` JSONB holds `client_name`, `menus[]`, `tabDepositPaid/Paid/Closed` |

**Key schema note:** `savedMenus[i].dishIds` in Carte are numeric integers stored as TEXT in the shared table. Dish IDs are also numeric-as-TEXT (from `Date.now()`). Veriqo dish IDs follow the same pattern. `menu_dishes.id` is UUID (only column not converted to TEXT).

### yield-sync.js — how it works (v9)

Yield reads jobs from the shared `jobs` table only (Phase 3 complete). No `mise_records` bridge.

Key methods:
- `saveQuote(quote)` — updates localStorage immediately, then awaits upsert to `quotes` Supabase table with full error logging. Powers the `/pay` client portal. `vatEnabled`/`vatRate` are stamped onto the quote in `updateQuoteStatus()` before every save so the client portal always reflects current VAT settings.
- `_pullQuotes()` — on sign-in, restores `yield_quotes` localStorage from `quotes` table.
- `_pullJobs()` — reads from `jobs` table; maps shared columns back to Yield format (`eventDate`, `client`, `covers`, `jobType`, `tabDepositPaid/Paid/Closed` from `metadata`).
- `syncTabStatusToCarte(jobKey, depositPaid, balancePaid)` — fetches `jobs.metadata`, merges tab payment flags, writes back to `jobs` table.
- `syncQuoteToCarte(quote)` — upserts to `jobs` table with `source:'yield'` so Carte sees the quoted event. Called on initial quote creation AND on every subsequent edit or status change (for standalone quotes with `event_date`).
- `removeQuoteFromCarte(quoteId)` — deletes from `jobs` table (date param no longer needed).
- `pullProfile()` — reads `business_name`, `chef_name`, `logo` from `profiles` table; caches to `yield_profile`.
- `saveProfile(data)` — pushes profile fields to `profiles` table and updates `yield_profile` cache.

---

## Veriqo (app.html) — What's Built

**Desktop layout (≥768px):** No sidebar — Veriqo uses tile-based navigation (home screen grid). `.app` widens to `max-width: 960px`; `.tile-grid` expands from 2 to 4 columns. No JS changes needed.

**Record types:** fridge, cooking, cooling, reheating, delivery, cleaning, probe, pest, illness, opening/closing checklists, cross-contamination, job (menus), kitchen assessment, allergen, transport, mobile setup, credentials.

**Key features:**
- Dashboard: OK/Warn/Fail stats, tap-to-filter tile grid, next booking banner (collapsible, tappable detail, "View in Carte →")
- Next job banner: shows allergen matrix print button (`📋 Print Allergen Matrix`) when the job has at least one menu — `_printNextJobAllergenMatrix(job)`, `#printAllergenContainer`
- Next job banner: shows `🔗 Share with Freelancer` button for Carte-sourced jobs (`job._fromCarte === true`). Opens `#shareFreelancerModal` bottom sheet — "Allow edit" checkbox + "Generate Link" button inserts a row into `freelancer_access` and constructs `https://www.getveriqo.co.uk/event?t=TOKEN`. Copy Link / Send via Email (mailto:) buttons. State vars: `_shareJobId`, `_shareJobEventDate`, `_freelancerLink`. Functions: `openShareFreelancerModal(jobId, eventDate)`, `closeShareFreelancerModal()`, `generateFreelancerLink()`, `copyFreelancerLink()`, `mailtoFreelancerLink()`.
- N/A toggle on fridge temperature input and cleaning chemical input — `toggleNA(inputId, btn)` toggles `data-na='1'` + disabled state; bypasses `isNaN` validation in `logFridge()`, saves `chem:'N/A'` in `logCleaning()`; resets after save
- Records: day blocks, expandable, export .txt + print-to-PDF
- Settings: staff, thresholds, reminders, brand profile (logo upload), cog always visible in header
- CRM: address book, tap-to-edit, clickable phone/email/map
- Menus & dish library (DISH_CATEGORIES shared with Carte)
- Approved Supplier Register, Transport log, Credentials tracker (90-day warning)
- Stripe paywall (14-day trial), PWA, welcome modal, app switcher pill → Carte (Yield pill is `display:none` until launch)

**Key JS:** `saveSettings()` always calls `Mise.sync.saveSettings()`. `getAddressBook()` merges savedCustomers + job records. Menu onclick handlers use quoted string IDs. `getAllJobs()` scans all localStorage `mise_YYYY-MM-DD` keys — use this to find a job by ID across all dates.

---

## Carte (mise.html) — What's Built

**Desktop layout (≥768px):** Fixed 200px sidebar (`#1C2B1E` dark green, `border-right: 1px solid #2E4030`) replaces the bottom nav. Sidebar buttons: `snav-home`, `snav-clients`, `snav-calendar`, `snav-menus`, `snav-more` — active state set by `showTab()` alongside the existing `nav-{tab}` buttons. Content area: `margin-left: 200px`, sections use `padding: 24px 32px 40px`. Bottom nav hidden, toast repositioned to `bottom: 24px`.

**Tabs:** Home, Clients, Calendar, Menus, More (Transport, Assess, Allergen, Credentials, Settings, Save as app).

**Key features:**
- Dashboard: greeting, next-booking card (tappable → `calViewJob(id)`), stats strip, quick-action buttons
- Clients CRM: add/edit/delete, clickable phone/email/maps
- Calendar: month grid, job indicators, unavailable dates, day detail panel
- Jobs tab: collapsible "＋ Book a New Job" form; upcoming soonest-first; "▼ View previous bookings" toggle; 3 card states (collapsed / read-only / inline edit `jedit-` prefix); `_jobCardHTML(j)` + `_jobsByMonth(jobs)` helpers
- **Event Templates** (`#newJobTemplate` select): System templates (Private Dinner / Wedding / Corporate) + **personal saved templates** under a "My Templates" `<optgroup>` pre-fill the Notes textarea (`#job-notes`). System templates only fill notes; personal templates also set job type, covers, and time. Selecting a template always replaces (not appends). `CARTE_TEMPLATES` object + `applyEventTemplate()` in script. **Personal templates:** stored in `mSettings.savedTemplates[]` (`{id:'tpl_<timestamp>', name, jobType, notes, covers, time}`). Save from the new-job form ("💾 Save as template" button above Save Booking) or from any expanded past-job card. Managed (delete) in Settings → My Templates card. `renderTemplateDropdown()` rebuilds the optgroup; `renderTemplatesList()` renders the settings card. `openSaveTemplateModal(source)` / `confirmSaveTemplate()` / `closeSaveTemplateModal()` control the name-input modal (`#saveTemplateModal`). `removeUserTemplate(id)` deletes. Wired into `loadProfileUI()` and `showTab('jobs')`.
- **First Inquiry Scripts** (`#scriptModal`, 3 stages, auto-opens on new lead): Tabbed modal with Stage 1 (Initial Qualifying Response), Stage 2 (The Proposal — two priced options, deposit CTA), Stage 3 (The Confirmation — booked details, payment instructions). Tab buttons `#scriptTab1/2/3` + panels `#scriptPanel1/2/3` via `switchScriptTab(n)`. Copy-to-clipboard with 2s gold flash. **Auto-opens at Stage 1** whenever `addClient()` is called (new lead added). `showScriptModal(stage)`, `closeScriptModal()`, `copyScript()`.
- **Balance warning & payment tracking:** Dashboard banner (`#dash-balance-warn`) appears when any upcoming job has unpaid balance within 3 days of event date — shows client name + "is tomorrow / in N days" text, taps through to Jobs tab. Job cards get amber `⚠ Balance due` pill and gold border highlight when flagged. Payments section in expanded non-editing card: Deposit + Balance toggle rows calling `toggleJobPayment(id, field)` which flips `j.tabDepositPaid`/`j.tabBalancePaid`, calls `saveDayRecords()` + `Mise.sync.saveJob()`, re-renders dashboard + job list, toasts confirmation. Reuses `daysUntil(dateStr)` helper and the pre-existing `tabDepositPaid`/`tabBalancePaid` schema fields in `jobs.metadata`.
- **AI Bio Writer persistence:** Generated bio is saved to `mSettings.bio` + `saveSettings()` immediately on success. `loadProfileUI()` pre-fills `#pdfBio` textarea from `mSettings.bio`. Textarea has `onblur` to save manual edits to `mSettings.bio`. Modal button changes to "Regenerate ↺" after first generation and stays open — a "Done →" button closes it. `openBioWriterModal()` resets button to "Generate Bio" on open.
- Notes field (`#job-notes`) is a `<textarea>` (was `<input>`) — needed for multi-line template content; `.value` read/write unchanged.
- Menus: dish library, saved menus, frozen snapshots on jobs (`job.menus = [{name, dishes:[...]}]`)
- Settings: profile, logo upload, staff, subscription card, Help + Privacy/Legal tabs; gold cog in header
- Booking report PDF: `exportJobsPDF()` / `buildJobsPDF()`
- **Positioning One-Pager PDF** (`📄 Create Profile PDF`): `showProfileGeneratorModal()` → modal → `generatePositioningPDF()`. Pulls `mSettings.businessName/chefName/logo` directly. Container: `#printProfileContainer`, modal: `#profileGenModal`.
- **Auto-Allergen Matrix** (`📋 Print Allergen Matrix` on expanded job cards): `generateAllergenMatrix(jobId)` — finds job via `getAllJobs()`, collects dishes from `job.menus`, cross-references `mSettings.savedDishes`, builds landscape 14-column grid using `ALLERGENS_14`, triggers print. Container: `#printAllergenContainer`.
- **Post-Event Follow-up** (`✉️ Draft Follow-up Email` on past job cards only): `draftFollowUpEmail(jobId)` — looks up client email in `mSettings.savedClients`, opens pre-filled `mailto:` with personalised review + rebooking template. Button hidden for future jobs.
- **📋 Client Intake Form** (`📋 Send Intake Form` button in Clients tab): chef generates a branded shareable link → client fills in name, email, phone, address, dietary requirements, preferences → client record auto-created in `clients` table with `source='intake'`. Modal: `#intakeFormModal` — label input + expiry radio (7 days / 30 days / no expiry) + generate/copy/mailto buttons. Token stored in `client_intake_tokens` table (inserted via authenticated `supabaseClient` with RLS). Public page: `client-intake.html` at `/client-intake?t=TOKEN` — anon Supabase client calls `get_intake_config(token)` on load (branding), `submit_intake_form(token, data)` on submit (one-use). State vars: `_intakeLink`. Functions: `openIntakeFormModal()`, `closeIntakeFormModal()`, `generateIntakeLink()`, `copyIntakeLink()`, `mailtoIntakeLink()`. New clients appear in Clients list on next Carte load (re-pull on tab focus).
- **✨ Magic Menu Importer:** `api/parse-menu.js` serverless function — accepts POST `{ image: base64, mimeType }`, calls OpenAI `gpt-4o` vision API with a strict system prompt, returns `{ menuName, dishes: [{ name, category, allergens[] }] }`. Allergens are inferred from the UK 14-major list. In `mise.html`: `✨ Magic Import (Photo of Menu)` button in the Menus tab triggers a hidden `<input type="file" accept="image/*">` (`#magic-import-input`); `handleMagicImport(event)` reads the file as base64 DataURL, POSTs to `/api/parse-menu`, deduplicates against `mSettings.savedDishes` by lowercased name, saves new dishes + creates a new saved menu entry with the AI-extracted name (deduping menu names with numeric suffix), calls `saveSettings()`, re-renders dish library + menu list, shows toast `✨ N dishes imported into "Menu Name"`. Requires `OPENAI_API_KEY` env var on Vercel.
- **✨ Scan Label (Allergen Scanner):** `#scan-label-btn` + hidden `#scan-label-input` in the "Add Dish to Library" card (Menus tab), sitting alongside the Add Dish button. `handleScanLabel(event)` POSTs to `/api/ai-scan` with `type:'label'`; on success auto-fills `#dish-name` with the product name and calls `setDishAllergens()` to tick the correct checkboxes. User reviews and clicks Add Dish to confirm. Only declared allergens (not inferred) are returned — correct behaviour for UK compliance.
- **Job Menu Builder Modal** (`#jobMenuBuilderModal`): replaces the old inline checkbox dish list in the New/Edit Job form. `+ Attach or Build a Menu` dashed-border button calls `openJobMenuBuilder(prefix)` where `prefix` is `'log'` (new job form) or the job ID (edit mode). Modal has two tabs — **Library** (shows `mSettings.savedMenus` as clickable cards; tapping one pushes it to `_jobMenuState[prefix]`) and **Custom** (menu name input + searchable dish list with tap-to-select; "Add to Job" pushes custom menu to `_jobMenuState[prefix]`). State vars: `_jmbPrefix`, `_jmbSelectedDishes`, `_jobMenuState` (keyed by prefix). `switchMenuBuilderTab(tab)` toggles panels. `closeJobMenuBuilder()` hides modal. `saveJobEdit()` reads `_jobMenuState[jobId]` to persist menus on the job record.
- PWA: `mise-manifest.json`, app switcher pill → Veriqo (Yield pill is `display:none` until launch)

**App switcher navigation:** `openVeriqo()` → `/app`, `openYield()` → `/yield`. Always use clean Vercel routes (not raw filenames like `app.html`) — raw filenames bypass Vercel routing and can cause session issues.

**Job card structure:** dishes are `{dish, allergens, category}` — property is `d.dish` not `d.name`. Job fields: `j.client`, `j.eventDate`, `j.eventTime`, `j.covers`, `j.jobType`, `j.location` directly. No `getJobClient()`/`getJobDate()` helpers in Carte (those are Yield-only).

**Key JS:** `saveJobEdit(id)` calls `Mise.sync.saveJob(updatedRec)` after saving. `logJob()` calls `Mise.sync.saveJob(rec)`. `deleteJob(id)` calls `Mise.sync.deleteJob(id)`. State vars: `_expandedJobId`, `_editingJobId`, `_newJobFormOpen`, `_pastJobsOpen`.

**Yield job editing in Carte:** `_fromYield` jobs show the full inline edit form (including "+ Attach or Build a Menu"). `isMirrored` only suppresses editing for `veriqo_`-prefixed records (read-only HACCP mirror records from Veriqo). When `saveJobEdit` saves a Yield-sourced job, `mise-sync.js`'s `saveJob` preserves `source: rec.source || 'carte'` so the job stays filterable by `source='yield'` in `_pullSharedJobs`.

---

## Yield (yield.html) — What's Built

**Desktop layout (≥768px):** Fixed 200px white sidebar (`border-right: 1px solid var(--border)`) replaces the bottom nav. Sidebar buttons: `snav-dashboard`, `snav-quotes`, `snav-invoices`, `snav-jobs`, `snav-settings` — active state set by `showScreen()` alongside the existing `nav-{screen}` buttons. Content area: `margin-left: 200px`, screens use `padding: 24px 32px 40px`. Bottom nav hidden, toast repositioned to `bottom: 24px`.

**Screens:** Dashboard, Costing, Quotes, Invoices, Jobs, Settings.

**Core concept — the Tab:** A tab is the financial record for a job, opened when quoted and closed when the final balance is received. Every chef knows what running a tab means. UI terminology: "Open tab", "Close tab", "Tab closed", "View tab".

**What's built:**
- Full design system (dark gold theme, Instrument Serif/Sans, responsive 500px)
- Auth: `window.Mise.onSignedIn` callback pattern, paywall via `yield-subscription.js`
- **Dashboard:** 4 KPI cards with colour-coded trend indicators (revenue ↑ green / ↓ red; open tabs amber/red threshold); 6-month SVG revenue bar chart (`renderRevenueChart()`, gold bars from `yPayments`); "Record Payment" quick-action button (`showRecordPaymentModal()` + `savePaymentRecord()`); upcoming jobs dot indicators (grey = Quoted, gold = Deposit Paid, green = Fully Paid); real average food cost % from `yCostings`
- **Costing:** all inputs, real-time calculation (`total ÷ (1 − margin%)`), HMRC £0.45/mile, per-row ingredient line totals; 10-metric live Cost Analysis panel (food cost, food+wastage buffer, travel cost, labour cost, effective hourly rate + 5 more); Hours vs Profit Efficiency Ring (circular inline SVG gauge vs target hourly rate); delete button on saved costing rows; "Load from Menu Library" button (pulls `mSettings.savedMenus` from Carte localStorage); import from costing library (`showCostingLibraryModal()` + `importCostingIngredients(id)`); traffic-light gauges (`updateGauge(id, value, max, higherIsBetter)`); save/load costings (synced to Supabase `costings` table via `yield-sync.js`); market benchmarks panel. **VAT section** in Cost Analysis: when `ySettings.vatEnabled`, shows VAT amount and Quote inc. VAT below the 10 metrics. **✨ Scan Receipt:** `#scan-receipt-btn` + hidden `#scan-receipt-input` in the ingredients header. `handleScanReceipt(event)` POSTs to `/api/ai-scan` with `type:'receipt'`; appends each extracted line item as a new ingredient row via `addIngredient()` with live price pre-filled, then calls `calculateCosting()`. Non-destructive — appends to existing rows.
- **Quotes:** list + status badges (`_quoteBadgeClass()`), lifecycle `draft → sent → accepted → declined/expired`; working filter (All / Active / Accepted / Declined) via `filterQuotes(status)` + `_quoteFilter` state; Extras section in quote builder (staffing, equipment, travel, gratuity, custom) — `addExtra()`, `removeExtra()`, `_collectExtras()`; `getQuoteTotal(quote)` helper (base + extras); quote detail modal (`showQuoteDetail(id)`) with Tab Summary (catering subtotal, extras lines, grand total, deposit %, balance, payment terms); "Send to Client" email compose panel (`showSendQuoteEmailPanel()` + `sendQuoteEmail()`) → marks as Sent; payment flags (`depositPaid`/`balancePaid`/`overdue`); auto-create deposit + balance invoices on accept (`_createInvoicesFromQuote()`); standalone quotes sync to Carte calendar; PDF export
- **Magic Link copy** in quote detail modal: `copyMagicLink(event)` copies `/pay?q={quoteId}` to clipboard (Clipboard API + `execCommand` fallback), gold confirmation flash.
- **Client Payment Portal (`/pay`):** `pay.html` — branded client-facing page; fetches `GET /api/get-quote?q={quoteId}`; renders event details, catering subtotal + extras breakdown, grand total, deposit/balance chips (green ✓ when paid), chef payment instructions; draft quotes return 403 with "not sent yet" message; "Pay Online" button stubbed (Stripe ready). `api/get-quote.js` — service-role serverless function; bypasses RLS; returns safe public fields only; also reads `profiles.yield_settings` for `defaultDepositPct` + `paymentInstructions`.
- **Invoices:** auto-populated from accepted quotes; sequential invoice numbers (`INV-001` format) via `_nextInvoiceNumber()` using `ySettings.invoicePrefix` + `ySettings.invoiceCounter`; clickable rows → Invoice Detail Modal with 5-step Tab Timeline Strip (Quoted → Accepted → Deposit Paid → Balance Paid → Tab Closed, `.tl-dot.done` / `.tl-dot.complete` CSS classes); "Mark as Paid" modal (`showMarkPaidModal()` + `saveMarkPaid()`) — date, method, ref → writes to `yPayments`, updates `paid_total`, calls `syncTabStatusToCarte`; "Tab closed 🎉" gold toast when both invoices fully paid; "Send Invoice" email compose panel (`showSendInvoiceEmailPanel()` + `sendInvoiceEmail()`); overdue detection from `due_date`; filter by status (`filterInvoices(status)`); PDF with logo + bank details via `_pdfStyles()`
- **Jobs:** expandable cards (`_buildJobCardHTML()`, `toggleJob(id)`, `_expandedJobId` state); upcoming / past split (past sorted most-recent-first, grouped by month with `▼ View previous jobs` toggle via `togglePastJobs()`, `_pastJobsOpen` state); inside expanded card: 5-step Tab Timeline Strip (same CSS classes as invoices, state derived live from `yQuotes` flags), Financial Summary (Total Quoted / Received / Outstanding), conditional action buttons (no quote → Open Tab; accepted + no invoices → Create Invoice via `createJobInvoices(jobId)`; unpaid invoice → Record Payment via `showMarkPaidModal()`; always → View in Carte →)
- **Settings:** 5 tabs; logged-in email (`_userEmail`); business/chef name + logo sync to `profiles` table via `saveProfile()`; bank details local-only; invoice Prefix + Next Invoice # fields (`invoicePrefix`, `invoiceCounter` in `ySettings`); subscription card
- Modals: `showModal(id)` / `closeModal(id)`, backdrop tap-outside dismiss, `position:relative` on `.modal-card`
- `yield-sync.js` v11, `yield-subscription.js` v4

**Job data normalisation (Carte vs shared):** Carte jobs use `eventDate`, `client`, `guests`, `jobType`. Shared jobs use `job_date`, `client_name`, `covers`, `event_type`. Use helper functions `getJobDate(j)`, `getJobClient(j)`, `getJobCovers(j)`, `getJobType(j)` throughout.

---

## Serverless Functions

### Vercel (`api/`)

**Source of truth = `mise-deploy/api/`**. Verify with `ls /private/tmp/mise-deploy/api/`. The table below lists the 12 live functions (Vercel Hobby cap). Functions present in `files/api/` but absent from this table are not deployed.

| File | Purpose |
|---|---|
| `api/magic-link.js` | **Consolidated magic link + password reset for all three apps.** `auth.js` v26 calls `/api/magic-link`. POST `{ email, app, type }` → Supabase admin `generateLink` + branded Resend email. Replaces the legacy per-app `auth-link.js` / `carte-magic-link.js` / `yield-magic-link.js` (still in `files/` but no longer deployed). |
| `api/welcome-email.js` | Instant welcome email — called fire-and-forget from `auth.js` `createProfile()` on signup; POST `{ email, name }`. Also handles `source='starter-kit'` → upserts to `starter_kit_leads` + sends Day 1. |
| `api/trial-emails.js` | Trial drip emails at days 5, 10, 13 + Starter Kit days 2–7 — GitHub Actions cron daily 09:00 UTC, secured by `CRON_SECRET`. Skips users with `email_opt_out=true`. Includes unsubscribe link in footer. |
| `api/feature-blast.js` | One-shot broadcast to all users — skips `email_opt_out=true` users. Includes unsubscribe link in footer. Trigger via GitHub Actions `workflow_dispatch`. (Intentionally deployed despite being admin-only — the file is small and easier to leave in than gate.) |
| `api/unsubscribe.js` | GET `/api/unsubscribe?uid=<user_id>` — sets `email_opt_out=true` on `profiles`, renders styled confirmation page. Also `?list=starter` branch updates `starter_kit_leads`. No auth required (uid is the credential). |
| `api/get-quote.js` | Yield client portal — GET `/api/get-quote?q={quoteId}` → service-role fetch from `quotes` table → returns safe public fields + chef profile (including `card_payments_enabled` flag for Stripe Connect). Returns 404 if not found, 403 if still draft. No auth required. |
| `api/parse-menu.js` | Carte + Veriqo Magic Menu Importer — POST `{ image: base64, mimeType }` → OpenAI `gpt-4o` vision → `{ menuName, dishes: [{name, category, allergens[]}] }`. Used by `handleMagicImport()` (Carte) and `handleVeriqoMagicImport()` (Veriqo). Requires `OPENAI_API_KEY`. |
| `api/ai-scan.js` | Dual-mode vision scanner — POST `{ type: 'label'\|'receipt', image: base64, mimeType }` → OpenAI `gpt-4o`. `type='label'`: food safety compliance mode → `{ ingredientName, allergens[] }` (declared allergens only, validated against UK 14 list); used by Carte's `handleScanLabel()` and Veriqo's `handleVeriqoScanLabel()`. `type='receipt'`: procurement auditor mode → `{ vendor, items: [{ itemName, unit, pricePerUnit }] }`; used by Yield's costing receipt scan. Merged into one function to stay within Hobby plan 12-function limit. |
| `api/generate-bio.js` | Carte AI Bio Writer — POST `{ yearsExperience, training, cuisineSpecialism, signatureDishes, targetClient, tone, businessName, chefName }` → OpenAI `gpt-4o` text mode → `{ bio: string }`. ~110–160 words, 3 paragraphs, third person, British English. Used by `openBioWriterModal()` / `generateBio()` in `mise.html` to fill `#pdfBio` inside the Positioning One-Pager. |
| `api/yield-reminders.js` | Yield payment reminders — POSTs from GitHub Actions cron daily 09:00 UTC. Queries `invoices` due at -7, -3, 0, +3 days (excluding `status='paid'`), sends chef-facing branded reminder via Resend (`Yield <hello@getveriqo.co.uk>`) to `auth.users.email` of `invoice.user_id`. Respects `profiles.email_opt_out`. |
| `api/create-checkout.js` | Stub — live subscription-checkout logic is in the Supabase edge function (also named `create-checkout`). The Vercel stub is deployed but unused; no client code calls it. Kept on disk so the Vercel project doesn't drop below the 12-function deploy quirk. |
| `api/stripe-webhook.js` | Stub — live Stripe webhook is the Supabase edge function (`https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/stripe-webhook`). Stripe Dashboard webhooks point at the Supabase URL, not this Vercel handler. |

**Function count:** 12 (the Hobby cap). To add one, you must consolidate or remove an existing function in `mise-deploy/api/`. Do not push a 13th — the deploy will fail.

### Feature TODOs

One remaining unbuilt feature from the original roadmap:

| Feature | App | Notes |
|---------|-----|-------|
| **Client Pay button (Stripe Connect)** | Yield | Chef connects their own Stripe account (Express Connect, OAuth flow). Platform creates Checkout Sessions on behalf of connected account. Client pays deposit or balance directly into chef's Stripe account — platform never holds funds. Webhook (extend existing Supabase `stripe-webhook` edge function) auto-updates `depositPaid`/`balancePaid` in `quotes` table. New `api/*.js` endpoint needed — merge or remove an existing function first (Hobby plan limit: 12). No per-transaction cost to platform; chef pays standard Stripe rates (~1.5% + 20p UK cards). **Status: code written locally, paused pending Stripe ID verification for live mode (2026-05-17).** |

### Supabase Edge Functions

| Function | Purpose |
|---|---|
| `create-checkout` | Creates Stripe Checkout session; maps `{app, period}` to price env var |
| `upgrade-subscription` | Swaps price on existing subscription with prorations — prevents double-billing |
| `stripe-webhook` | Handles `checkout.session.completed`, writes `subscription_status` + `subscription_plan` to `profiles`; supports `yield`, `suite-all`, `suite`, `carte`, `veriqo` plans. Reads `session.metadata.plan` set by `create-checkout`. Requires 4 new Supabase secrets: `STRIPE_PRICE_ID_YIELD_MONTHLY`, `STRIPE_PRICE_ID_YIELD_ANNUAL`, `STRIPE_PRICE_ID_SUITE_ALL_MONTHLY`, `STRIPE_PRICE_ID_SUITE_ALL_ANNUAL`. |
| `create-portal-session` | Returns Stripe billing portal URL |
| `send-push-notifications` | Web Push to subscribed devices |
| `capture-lead` | Writes to `leads` table from landing page |
| `send-trial-reminders` (v5) | Sends trial-expiry warning emails at 3 days and 1 day remaining. Triggered by Supabase `pg_cron` daily. Fetches `chef_name` + `business_name` from `profiles`. Email design: off-white `#f5f4f0` background, white card, 4px green `#2D7A3A` top accent, "Veriqo**qo**" wordmark, urgency badge (green at 3 days / red at 1 day), personalised greeting, features table, green CTA "Keep my account — £12/month →", annual plan footnote. Subject lines: "Your Veriqo trial ends in 3 days" / "Your Veriqo trial ends tomorrow". |

---

## Branding

| | Veriqo | Carte | Yield |
|---|---|---|---|
| **Background** | `#f5f4f0` | `#F5F0E8` | `#0E0E0D` (legacy; Costing module in unified app now uses `#f5f4f0`) |
| **Primary accent** | `#2D7A3A` (green) | `#C8A96E` (gold) | `#C9A84C` (gold) |
| **Logo** | Shield SVG | `C` arc, `#C8A96E` on `#1C2B1E` | `Y` branch SVG — two lines to centre point, one line down, `#C9A84C` |
| **Tagline** | — | Private chef. Perfectly organised. | Know your yield. |
| **Font** | System sans | System sans | Instrument Serif (display) + Instrument Sans (UI) |

Yield Y logo SVG (used in nav, auth screen, paywall):
```svg
<path d="M6 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
<path d="M26 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
<path d="M16 17L16 28" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>
```

---

## Roadmap

### Yield — remaining build (in priority order)

**Infrastructure (do first):**
- [x] Run `shared-suite-schema.sql` in Supabase SQL editor — verify all tables exist with RLS
- [x] Add `/yield` route to `vercel.json`
- [x] Add `/pay` route to `vercel.json` (client payment portal)
- [x] Add `yield.html`, `yield-sync.js`, `yield-subscription.js` to `sw.js` cache list
- [x] Add `STRIPE_YIELD_*` and `STRIPE_SUITE_ALL_*` price IDs to Vercel env vars
- [x] Update `stripe-webhook` edge function to accept `yield` and `suite-all` plans (via Supabase secrets; function reads `session.metadata.plan`)
- [x] When Yield launches: un-hide `#yield-switcher-btn` in both `app.html` and `mise.html`; `subscription.js` (v9) and `carte-subscription.js` (v6) now show it conditionally on trial/suite-all/yield plans

**Dashboard:**
- [x] Revenue bar chart (inline SVG, 6 months, gold bars from `yPayments`)
- [x] "Record Payment" quick action button (3rd button on dashboard)
- [x] Dot indicators on upcoming jobs (grey/gold/green dots per tab status)
- [x] Colour-coded metrics (revenue: green if up vs last month; open tabs: amber/red)
- [x] Real food cost % calculated from saved costings

**Costing:**
- [x] Full 10-metric live panel: food+wastage buffer, travel cost, labour cost, effective hourly rate
- [x] Hours vs profit efficiency ring (circular SVG, % of target hourly rate)
- [x] Working "Send to Quotes →" bridge (stores prefill, switches screen, opens modal)
- [x] Import ingredients from saved costing library (`showCostingLibraryModal()` + `importCostingIngredients()`)
- [x] "Load from menu library" modal (pulls `mSettings.savedMenus` from Carte localStorage)
- [x] Delete button on saved costings rows
- [x] Save costings to Supabase via `Mise.yieldSync.saveCosting()` — `costings` table live with RLS (2026-05-11)

**Quotes:**
- [x] Status cycling (Draft → Sent → Accepted → Declined → Expired) via `updateQuoteStatus()`
- [x] Quote detail modal — click row to open; edit, amend, send, accept buttons
- [x] `depositPaid` / `balancePaid` / `overdue` flags visible in badge and detail
- [x] Auto-create deposit + balance invoices on quote acceptance (`_createInvoicesFromQuote`)
- [x] Standalone quotes sync to Carte calendar via `syncQuoteToCarte()`
- [x] "Tab opened" gold indicator when quote accepted — gold-bordered toast fires on `updateQuoteStatus('accepted')` (2026-05-12)
- [x] Extras section (line items: staffing, equipment, travel, gratuity, custom)
- [x] Tab summary section (total, deposit %, balance, payment terms)
- [x] Working filter (All / Active / Accepted / Declined)
- [x] "Send to Client" email compose panel → marks as Sent

**Invoices:**
- [x] Table auto-populated from accepted quotes (deposit + balance)
- [x] Overdue row tinting (auto-detected from `due_date`, not stored flag)
- [x] Working filter (All / Outstanding / Paid / Overdue) via `filterInvoices()`
- [x] White PDF with business details, logo, bank details via `_pdfStyles()` helper
- [x] Invoice detail modal with tab timeline strip
- [x] "Mark as Paid" modal (date, method, ref → `payments` table + `syncTabStatusToCarte`)
- [x] "Tab closed 🎉" gold toast when final payment received
- [x] Sequential invoice numbers (INV-001 format, prefix + counter from Settings)
- [x] "Send Invoice" email compose panel

**Jobs:**
- [x] Horizontal step tracker timeline (Quoted → Accepted → Deposit Paid → Balance Paid → Tab Closed) — state derived live from `yQuotes` flags
- [x] Expanded card with action buttons (Open Tab / Create Invoice / Record Payment / View in Carte →)
- [x] Past jobs collapsed by month with "▼ View previous jobs" toggle (`togglePastJobs()`, `_pastJobsOpen`)
- [x] Financial summary below timeline (Total Quoted / Received / Outstanding)

**Nav:**
- [x] Replace top nav with sticky `.app-header` (Y-branch SVG logo left, settings cog right) + fixed `.bottom-nav` tab bar (Home, Quotes, Invoices, Jobs, Settings)
- [x] App switcher pills in header — pills exist in HTML; fixed `_updateSwitcher()` to use `display:'flex'` (was `''`) so flex layout renders. Show for trial + suite/suite-all users. (2026-05-11)

**Settings:**
- [x] Logged-in email displayed (from `_userEmail`)
- [x] Business name + chef name sync to `profiles` table (shared with Carte + Veriqo)
- [x] Logo sync to `profiles` table
- [x] VAT toggle + rate — Settings UI, save/load, costing panel VAT section, quote Tab Summary VAT breakdown, invoice creation uses VAT-inclusive totals. (2026-05-11)
- [x] Bank details stored locally only (never synced to Supabase) — UI fields (Account Name, Bank Name, Sort Code, Account Number) + `savePaymentSettings()` + `copyBankDetails()` all confirmed live
- [x] Invoice number prefix + counter (`invoicePrefix` + `invoiceCounter` in `ySettings`, editable in Settings Defaults tab)
- [x] Defaults tab: invoice prefix + counter confirmed live; email template textareas remain a future enhancement
- [x] Payment tab: currency selector + "Copy bank details" button confirmed live
- [x] `api/yield-magic-link.js` serverless function (Yield-branded magic link email)

**Reminders cron:**
- [x] `api/yield-reminders.js` — checks invoices due at -7, -3, 0, +3 days, sends via Resend, respects `email_opt_out`. Chef-facing reminder (greets `business_name`, references `client_name` in body). (2026-05-12)
- [x] Wired into `.github/workflows/trial-emails.yml` as a second step alongside trial emails — POST to `https://www.getveriqo.co.uk/api/yield-reminders` with `Authorization: Bearer ${CRON_SECRET}`, daily 09:00 UTC. (2026-05-12)

### Suite migration
- [x] Phase 1 (2026-05-11): Migrate Carte clients/dishes/menus/menu_dishes from JSONB → shared row-based tables. PKs converted UUID→TEXT. `mise-sync.js` v6 writes to shared tables on every save going forward.
- [x] Phase 2 (2026-05-11): `sync.js` v10 — Veriqo reads dishes/menus from shared tables via `_pullSharedLibrary()` (replaces `mise_settings` JSONB cross-pull). Adds `saveDish`, `deleteDish`, `saveMenu`, `deleteMenu` writing to shared tables. Removes `_mirrorSettingsToCarte` and all bridge merge helpers. `app.html` wired at all 5 save/delete call sites.
- [x] Phase 3 (2026-05-11): `jobs.id` converted UUID→TEXT. `mise-sync.js` v7 adds `saveJob`/`deleteJob` writing to shared `jobs` table; removes all JSONB bridge mirror functions. `mise.html` wired at all 3 job save/delete points. `yield-sync.js` v9: `_pullJobs` reads shared `jobs` table only; `syncTabStatusToCarte` writes to `jobs.metadata`; `syncQuoteToCarte`/`removeQuoteFromCarte` write to `jobs` table. `sync.js` v11: `_pullCarteJobs` and `_mirrorJobsToCarte` removed. All bridge code gone.
- [x] **`sync.js` v12 (2026-05-15):** Added `_pullSharedJobs(userId)` — queries shared `jobs` table on sign-in and after tab focus, and injects each job as a synthetic `{type:'job', _fromCarte:true, ...}` record into the corresponding `haccp_YYYY-MM-DD` localStorage key. This feeds Veriqo's `updateNextJobBanner()` which previously only saw records logged directly in Veriqo. Must run AFTER `_pullRecords` (which wipes all `haccp_` date keys) — ordering in `loadAll()` and the `visibilitychange` handler preserved this.
- [x] Suite landing page at `getveriqo.co.uk` — three-app hero, parallel Veriqo/Carte/Yield app cards, Suite-All pricing block (£28/mo vs £12/mo single), C2C secondary CTA band. Updated JSON-LD with Yield as a FinanceApplication. (2026-05-14)

### Completed milestones
- **2026-05-18** — **UI/UX Polish Pass (11 items).** Full product polish: `vqIcon()` SVG helper (offline-safe, no CDN); WCAG AA contrast fix (`--vq-muted: #5a5752`); semantic token aliases + type scale in `tokens.css`; nav active state strengthened + haptic; `.vq-btn` system propagated to all modules; large logo blocks removed from HACCP/Menus home screens + greeting blocks added; "Open Tabs" → "Open Invoices"; Profile PDF relocated to Clients tab; stat label pluralisation; header cogs removed from Menus + Costing; HACCP settings stripped to module-only config (Business profile, Subscription, Daily reminders, Account & subscription cards removed — those live in the main Settings tab); costing background aligned to `#f5f4f0`; costing header date right-alignment fixed.
- **2026-05-17** — **Branding purge + nav bar redesign.** (1) All legacy Carte gold (`#C8A96E`) and Yield gold (`#C9A84C`) fully removed from `app.html`, `menus.js`, `costing.js`, and `haccp.js`. Dynamic content in `updateNextJobBanner()` (haccp.js) was the last holdout — link colours (location/phone/email/menu name) changed to `#7ACC8A` (light green legible on `#1C2B1E` banner). All "Carte"/"Yield" text strings updated to "Veriqo"/"Menus"/"Costing" throughout. (2) Shell nav (`shell.css`) redesigned: hard `border-top` replaced with soft `box-shadow: 0 -1px 0 rgba(0,0,0,0.06), 0 -4px 20px rgba(0,0,0,0.07)`; active tab gets a rounded green pill via `::before` pseudo-element (`inset: 7px 5px; border-radius: 14px; background: var(--vq-green-light)`); active icon lifts 1px and label goes bold; desktop sidebar disables the pill and icon-lift via `@media (min-width:768px)`. SW bumped to `veriqo-v21`.
- **2026-05-17** — **Carte: personal event templates, 3-stage inquiry scripts, balance warning, AI Bio Writer persistence.** (1) **Personal event templates:** `mSettings.savedTemplates[]` — save from new-job form or past-job card via `#saveTemplateModal`, apply from `#newJobTemplate` dropdown ("My Templates" optgroup), manage/delete in Settings. Filling a custom template sets job type + covers + time, not just notes (unlike system templates). (2) **3-stage inquiry scripts:** `#scriptModal` rewritten with 3 tab buttons + panels — Stage 1 qualifying, Stage 2 proposal (two priced options), Stage 3 confirmation. Auto-opens at Stage 1 whenever a new lead is added via `addClient()`. (3) **Balance warning:** Dashboard banner shows client name + days until event when balance is unpaid within 3 days. Job cards get amber pill + gold border. Payments section in expanded card (Deposit/Balance toggles → `toggleJobPayment()`) writes to `jobs.metadata` via `Mise.sync.saveJob()`. (4) **AI Bio Writer persistence:** generated bio saves to `mSettings.bio`; `#pdfBio` pre-fills on settings load; `onblur` persists manual edits; button becomes "Regenerate ↺" and modal stays open; "Done →" button closes.
- **2026-05-15** — **Carte modal/PDF features broken (missing `</script>` tag) + `_pullSharedJobs` definitive fix.** (1) Four Carte features silently did nothing — PDF allergen matrix, First Inquiry Script modal, Attach/Build a Menu modal, and Create Profile PDF — all broken by a single missing `</script>` closing tag. The `<script>` block at line 3517 of `mise.html` was never closed, so the HTML parser consumed all subsequent HTML (all four modal divs + print containers) as script text. `document.getElementById()` returned null for every affected element. Fixed by inserting `</script>` between the end of `draftFollowUpEmail()` and the modal HTML. Also changed `generateAllergenMatrix`'s `alert()` to `toast()` — `alert()` blocks the thread on iOS and appears broken. (2) Yield→Carte banner "still not fixed" after prior session's deploy: dirty Yield jobs accidentally written into `mise_records` by the old `saveDayRecords` were being restored by `_pullRecords` *without* the `_fromYield` flag; the previous fix's check `existing[idx]._fromYield` then treated them as Carte-own and refused to overwrite with fresh Yield data. Fix: `_pullSharedJobs` now checks `j.source === 'carte'` on the record from the `jobs` table (reliable, not affected by dirty localStorage), and skips only those — all others (source='yield' or null) are always injected/updated. `mise-sync.js` bumped v8→v9.
- **2026-05-15** — **Carte/Yield bug fixes.** (1) Yield quote edit wasn't updating the Carte banner: `syncQuoteToCarte` was only called on initial quote creation and status change — not when the user edited quote details (client name, date, covers). Fixed: edit branch of `saveQuote()` in `yield.html` now calls `syncQuoteToCarte(updQ)` after save, same as the create path. (2) Yield-sourced jobs in Carte had no Edit button (and therefore no "Attach or Build a Menu"): `isMirrored` was `true` for any `_fromYield` job, suppressing the edit form. Fixed in `mise.html`: `isMirrored` now only applies to `veriqo_`-prefixed records. (3) Editing a Yield job in Carte was overwriting `source:'yield'` with `source:'carte'` in the shared `jobs` table, breaking `_pullSharedJobs`'s filter. Fixed in `mise-sync.js`: `saveJob` now uses `source: rec.source || 'carte'`.
- **2026-05-15** — **SEO/CRO — product pages, resource hub, real screenshots shipped.** New pages: `veriqo-landing.html` (`/veriqo`), `carte-landing.html` (`/carte`), `yield-info.html` (`/yield-info`), `resources.html` (`/resources`), `resources/how-to-price-a-bespoke-dinner-party.html`. Each product page has SEO title/meta/canonical/OG/JSON-LD, hero + features + pricing + CTA sections, and a `.feature-split` grid with mockup screenshots. `index.html` updated with CTA subtext, CSS fix for portrait phone display on homepage cards, and PNG image references. 9 real app screenshots taken via Chrome DevTools iPhone 14 Pro viewport (390×844) stored in `files/images/` replacing hand-drawn SVG mockups. `vercel.json` updated with 5 new routes. Testimonials section deferred (placeholder copy not yet live).
- **2026-05-15** — **Freelancer Access shipped.** Veriqo next-booking banner was not showing jobs booked in Carte. Root cause: `updateNextJobBanner()` scanned only `haccp_YYYY-MM-DD` keys, but Carte jobs live in the shared `jobs` Supabase table. Fix: `sync.js` v12 adds `_pullSharedJobs(userId)` which queries the `jobs` table on sign-in and tab-focus and injects synthetic `{type:'job', _fromCarte:true}` records into `haccp_` localStorage (runs AFTER `_pullRecords` so it doesn't get wiped). Banner now shows Carte events. **Freelancer share flow:** Share button (`🔗 Share with Freelancer`) added to Veriqo's next-job banner (visible only when `job._fromCarte === true`). Opens `#shareFreelancerModal` — "Allow editing" checkbox, "Generate Link" inserts a row in `freelancer_access` (token UUID, expires job_date+3 days), displays the `https://www.getveriqo.co.uk/event?t=TOKEN` URL, Copy + Send via Email buttons. New `freelancer_access` Supabase table with RLS + 3 SECURITY DEFINER RPCs: `get_job_for_freelancer(p_token)` (returns job + client details joined from `clients` table + `can_edit` flag), `log_freelancer_haccp(p_token, p_date, p_record)` (appends to chef's `haccp_records` using chef's `owner_user_id`), `update_job_for_freelancer(p_token, p_covers, p_notes)` (updates `jobs` table when `can_edit=true`). **`event.html` (new):** Full Veriqo-styled freelancer access page — green palette, Veriqo shield logo, "Your Name" field (persisted to localStorage, signs all records), client banner (name, address, phone, email, dietary notes — pulled from `clients` table), event details card, menu & allergens section (dish chips + allergen pills), 8 HACCP tabs (Fridge, Cooked Food, Cooling, Reheating, Deliveries, Cleaning, Transport, Kitchen Assessment) each with Veriqo-matching form fields and temperature thresholds, session log below each tab, optional "Update Event Details" edit section when `can_edit=true`, Veriqo CTA at bottom. `vercel.json` `/event` route added. `sw.js` bumped to `veriqo-v18`, `event.html` + `event` added to `APP_SHELL`. No new Vercel functions used — all data ops via SECURITY DEFINER RPCs on anon key.
- **2026-05-14** — `index.html` rewritten as a three-app suite landing page, then iterated with prominent Chef to CEO promo block + pricing CTAs. Veriqo-led, two-app story replaced with parallel app cards for Veriqo, Carte, and Yield, plus a Pricing section (Single app £12/mo vs Suite £28/mo highlighting the £8/mo / £56/yr saving) and a Chef to CEO promo section. Header nav now lists all three apps (Carte hides on narrow screens to keep the bar one line). JSON-LD updated with Yield as a `FinanceApplication`. Title + Open Graph + Twitter card all rewritten for the three-app story. **Pricing CTAs:** Single-app card has three brand-coloured buttons (Veriqo green / Carte gold-on-dark-green / Yield gold-on-black) for "Start free trial → pick your app". Suite card has one prominent full-width gold-on-dark "Start 14-day free trial →" button pointing at `/app`. All four buttons enter the same Supabase trial sign-up — plan choice (£12 vs £28) happens at conversion, not at sign-up. **Chef to CEO section:** Started as a slim secondary CTA band, then promoted to a full feature section with centered Chef to CEO logo (`/icons/c2c-logo.png`, copied from `My Drive/Claude Projects/Chef to CEO/Branding & Assets/` and cropped to 533×440 to drop dead whitespace, sized to `max-width: 500px` in the page, `mix-blend-mode: multiply` so the PNG's white background blends seamlessly with the cream section background). Three pillar strip — Freedom · Creativity · Legacy — pulled from the programme's own tagline. Gold-on-dark "See the programme →" CTA linking to `https://cheftoceo.co.uk`. Trust line: "A sister programme to Veriqo · Carte · Yield, built on the same chef-first principles." **Footer:** "Side Order Catering" now hyperlinks to `https://www.sideordercatering.co.uk`. Closes Notion task `Build Suite landing page at getveriqo.co.uk` (was High priority, due 2026-08-01). No deploy-chain caveats — `index.html` is a static HTML asset, not an api function, so the standard mise-deploy git push handles it.
- **2026-05-14** — Deploy-chain tidy. Discovered that direct `vercel deploy --prod` from `files/` (which the AI Bio Writer ship had used) was being silently reverted by every subsequent `git push` to mise-deploy — Vercel auto-deploys from the GitHub repo on each push and treats *that* repo's `api/` as authoritative, not the most recent CLI deploy. `/api/generate-bio` had been 404ing in production since the next push after Bio Writer landed. Fix: copied `generate-bio.js` into `mise-deploy/api/` and pushed (commit `c73aba2`) so it survives auto-deploys. Then: deleted orphan `files/api/parse-label.js` + `files/api/parse-receipt.js` (never lived in mise-deploy, never deployed); rewrote `files/.vercelignore` as advisory-only with a banner explaining it does not control production; restructured CLAUDE.md with a new `## Deploy chain — read this first` section that names `mise-deploy/api/` as the single source of truth and warns against the two failure modes that caused this (HTML-only pushes silently un-deploying API endpoints, and `.vercelignore` being treated as authoritative). Functions table rewritten to list only the 12 actually-live functions in the right order, with corrected descriptions (notably: `magic-link.js` is the consolidated handler since auth.js v26; legacy per-app magic-link files are in `files/` only, not deployed).
- **2026-05-14** — AI Vision in Veriqo Menus. `✨ Scan Label (Photo)` button in the dish builder of the Menus tab calls `/api/ai-scan` (type='label') → auto-fills `#menu-dish-name` and ticks allergen checkboxes (via `_setMenuDishAllergenCheckboxes`). `✨ Magic Import (Photo of Menu)` button at the top of Create-a-menu calls `/api/parse-menu` → fills `#menu-name` (if blank) + appends to `_menuDishes` + re-renders via `menuRenderDishes()`. New helper `_normaliseAllergenForVeriqo()` maps API allergen vocabulary (`Cereals with gluten` / `Sulphites`) to Veriqo's `ALLERGENS_14` (`Cereals containing gluten` / `Sulphur dioxide`). Zero new Vercel endpoints — both call existing live functions. Suite-shared `dishes`/`menus` tables mean additions flow to Carte automatically via `Mise.sync.saveDish`. Images only (no pdf.js dependency, unlike Carte's variant). SW bumped to `veriqo-v16`. **Reality check while building:** `.vercelignore` lists `api/ai-scan.js` as excluded but production curl shows `/api/ai-scan` returns 400 (live), `/api/parse-label` returns 404 (NOT live). The CLAUDE.md "Vercel api" table entries for `parse-label.js`/`parse-receipt.js` and the `.vercelignore` `Superseded by parse-label.js + parse-receipt.js` comment are misleading — `ai-scan.js` is the actual live dual-mode endpoint.
- **2026-05-14** — Re-enable Emails toggle shipped in Carte + Veriqo Settings. New "Email preferences" card with a single toggle wired to `loadEmailPreferences()` + `setEmailPref(optedIn)` in both `mise.html` and `app.html`; reads/writes `profiles.email_opt_out` directly via the signed-in Supabase client under existing RLS — no new API endpoint or function-count cost. Closes the last item under "Email opt-out — remaining TODOs". Stale comment in `auth.js:190` referencing the superseded `api/carte-magic-link.js` rewritten to point at the consolidated `api/magic-link.js`. SW bumped to `veriqo-v15`.
- **2026-05-14** — Carte AI Bio Writer shipped. New endpoint `api/generate-bio.js` (OpenAI `gpt-4o` text mode, ~110-160 word, 3-paragraph third-person bio in British English). New `#bioWriterModal` in `mise.html` collects 6 structured fields (years, training, cuisine specialism, signature dishes, target client, tone) plus auto-passes `mSettings.businessName`/`chefName`. `✨ Write with AI` button next to the Chef Bio textarea inside the Positioning One-Pager modal opens it; success writes the returned bio into `#pdfBio` (existing PDF pipeline unchanged). SW bumped to `veriqo-v14`. Function-count headroom regained by adding `api/carte-magic-link.js` + `api/yield-magic-link.js` to `.vercelignore` (both superseded by `api/magic-link.js` since auth.js v26). ~~**Current Vercel function count:** 11 active (17 files, 6 excluded via `.vercelignore`...)~~ — **correction (2026-05-14 tidy):** this claim was wrong. `.vercelignore` was never authoritative; live function set is whatever is in `mise-deploy/api/`. See §Deploy chain. Verified end-to-end against live `www.getveriqo.co.uk/api/generate-bio` with a Sam Carter / Le Cordon Bleu prompt → 167-word, three-paragraph bio returned.
- **2026-05-12** — Private Chef Starter Kit 7-day email nurture sequence built and live. `api/welcome-email.js` extended with `source='starter-kit'` branch: validates `stage` + `eventsPerMonth`, upserts to `starter_kit_leads` Supabase table (project `yixrwyfodipfcbhjcszp`), sends Day 1 via Resend with stage-variant subject/body (employed vs established), sets `last_email_sent=1`. `api/trial-emails.js` extended with `_sendStarterKitEmails()` — days 2-7 loop queries leads by `last_email_sent = day-1` and sends the next email; Day 6 segmented by `events_per_month` (0-3/4-10/10+). `api/unsubscribe.js` extended with `?list=starter` branch targeting `starter_kit_leads`. No new API files added (Vercel Hobby cap). Landing page at `cheftoceo.co.uk/starter` (React, `src/pages/starter.tsx`), confirmation at `/starter-sent`.
- **2026-05-12** — Yield payment reminders live in production. `api/yield-reminders.js` (185 lines) handles -7/-3/0/+3 day windows around invoice `due_date`, queries `invoices` excluding `status='paid'`, fetches chef email via `supabase.auth.admin.getUserById(user_id)`, sends chef-facing branded reminder via Resend (`Yield <hello@getveriqo.co.uk>`), respects `profiles.email_opt_out`, includes unsubscribe link. Subject lines vary by window (overdue / due today / due tomorrow / due in N days). Cron wired in `.github/workflows/trial-emails.yml` as a second `curl` step after trial emails — POSTs to `https://www.getveriqo.co.uk/api/yield-reminders` with `Authorization: Bearer ${CRON_SECRET}`, daily 09:00 UTC. Verified end-to-end on 2026-05-12: 5 reminders fired for INV-001/013/015/017/019 hitting the -7/-3/0/+3 window in the same tick and delivered to chef inbox.
- **2026-05-11** — Suite migration Phases 1-3 complete: All three apps now read/write shared Postgres tables (`clients`, `dishes`, `menus`, `menu_dishes`, `jobs`). All JSONB cross-sync bridge code removed from `sync.js` (v11), `mise-sync.js` (v7), `yield-sync.js` (v9). PKs on clients/dishes/menus/jobs converted UUID→TEXT to match Carte's alphanumeric IDs. Tab payment status moves from `mise_records` to `jobs.metadata`. Quote-as-job sync (`syncQuoteToCarte`) writes to `jobs` table.
- **2026-05-11** — Yield Tranche 1: Costings to Supabase (`yield-sync.js` v8 — `saveCosting`/`deleteCosting`/`_pullCostings()`; `costings` table with RLS created and live). App switcher pills fixed (`yield-subscription.js` v4 — `_updateSwitcher` now sets `display:'flex'`). VAT system: costing panel shows VAT + inc-VAT metric block; quote Tab Summary shows Subtotal/VAT/Total inc. VAT with deposit+balance on billable total; `_createInvoicesFromQuote` applies VAT to invoice totals.
- **2026-05-11** — AI Vision sprint: `api/ai-scan.js` dual-mode endpoint (type='label' → allergen scanner; type='receipt' → procurement scanner). Carte: `✨ Scan Label (Photo)` button in dish library card auto-fills dish name + ticks allergen checkboxes from a packaging label photo. Yield: `✨ Scan Receipt` button in Costing ingredients header appends supplier line items with live prices. Merged into one function to stay within Vercel Hobby plan 12-function limit (was hitting 13). SW bumped to `veriqo-v13`. Vercel auto-deploy via GitHub was silently broken — established working deploy via Vercel CLI; future pushes should auto-trigger again. **⚠ Hobby plan limit:** 12 serverless functions maximum. Current count: exactly 12 (16 files, 4 excluded via `.vercelignore`: `ai-scan.js`, `auth-link.js`, `create-checkout.js`, `feature-blast.js`). Do not add new `api/*.js` files without excluding an existing one first.
- **2026-05-09** — Visual sprint + Suite Migration backend + subscription fixes: Replaced Yield top nav with sticky `.app-header` (Y-branch SVG logo left, settings cog right) and fixed `.bottom-nav` 5-tab bar (Home, Quotes, Invoices, Jobs, Settings). `showScreen()` patched to use `getElementById('nav-' + screenId)` with null guard (Costing has no nav button). Ran `shared-suite-schema.sql` — 13 shared tables now live in Supabase with RLS. `subscription.js` (v9) and `carte-subscription.js` (v6) updated to handle `suite-all` plan and conditionally show Yield switcher pill. `yield-subscription.js` v3: rewrote `check()` as async with its own Supabase fetch (sets `window.Mise.profile` directly; no longer relies on `pullProfile()`); fixed paywall button calling `suite-all` instead of `suite`; fixed `hasSuite` to include `suite-all`. Fixed critical "Loading subscription info" bug — two root causes: (1) `window.Mise.profile` was never set by Yield's own code path (only `yield-sync.pullProfile()` ran, which sets `yProfile` not `window.Mise.profile`); (2) subscription card element had `id="subscription-info"` but `renderYieldSubscriptionCard()` looked for `id="yield-subscription-card"` — renamed in HTML. Confirmed live Stripe checkout opens and subscription card renders. Added 4 Supabase edge function secrets for new price IDs.
- **2026-05-09** — Yield magic link built: `api/yield-magic-link.js` — dark-gold Yield-branded email (Y SVG logo, `#C9A84C` CTA button, dark `#0E0E0D` theme) via Resend; redirects to `/yield`. `auth.js` updated to v26: branches on `MISE_AUTH_CONFIG.name === 'Yield'` to call `/api/yield-magic-link` instead of `/api/carte-magic-link` (previously all non-Veriqo apps were routed to the Carte endpoint). SW bumped to `veriqo-v12`.
- **2026-05-08** — Auth hang fixed on all 3 apps: root cause was unversioned `@supabase/supabase-js@2` CDN tag silently pulling in a breaking v2 release that made `getSession()` block on a network call. Pinned all three apps to `@2.39.3/dist/umd/supabase.js`; bumped SW to `veriqo-v11`. Confirmed working on Veriqo and Carte. Do not un-pin without testing auth across all apps.
- **2026-05-08** — Yield silent save failure fixed: diagnosed via DevTools that `yieldSync.init()` was never called because an `if (sb)` guard in `onSignedIn` silently skipped it whenever `supabaseClient` was falsy (stale SW cache scenario). Removed the guard so `init(sb, user.id)` always fires before any data load or render. Bumped SW cache to `veriqo-v10` to force all browsers to drop old cached `yield.html`. Supabase CDN already pinned to `@2.39.3`. Confirmed working.
- **2026-05-08** — Yield Jobs tab sprint: expandable job cards (`_buildJobCardHTML()`, `toggleJob()`, `_expandedJobId`); 5-step Tab Timeline Strip (state derived live from `yQuotes.depositPaid`/`balancePaid`); Financial Summary block (Quoted / Received / Outstanding); conditional action buttons (`createJobInvoices(jobId)` wrapper); past jobs grouped by month under `▼ View previous jobs` toggle (`togglePastJobs()`, `_pastJobsOpen`). Client Payment Portal: `quotes` Supabase table (`id`, `user_id`, `client_name`, `event_date`, `status`, `quote_data` JSONB) with RLS; `yield-sync.js` v3 — `saveQuote()` now upserts to Supabase (fire-and-forget) + `_pullQuotes()` restores on sign-in; 6 save points wired in `yield.html`; `api/get-quote.js` service-role endpoint (404 if not found, 403 if draft); `pay.html` full client portal (event details, extras breakdown, deposit/balance status chips, payment instructions, "Pay Online" stub); `/pay` route in `vercel.json`.
- **2026-05-08** — Yield Sprint 1 (Dashboard & Costing): colour-coded KPI trend indicators; 6-month SVG revenue bar chart (`renderRevenueChart()`); "Record Payment" quick action (`showRecordPaymentModal()`, `savePaymentRecord()`); upcoming jobs dot indicators (grey/gold/green); real food cost % from `yCostings`; 10-metric Cost Analysis panel (food+wastage, travel, labour, effective hourly rate); Hours vs Profit Efficiency Ring (circular SVG); delete button on saved costings; "Load from Menu Library" (`mSettings.savedMenus`). Yield Sprint 2 (Quotes & Invoices): Extras in quote builder (`addExtra()`, `removeExtra()`, `_collectExtras()`); `getQuoteTotal()` (base + extras); Tab Summary block in quote detail; working quote filter (`filterQuotes()`, `_quoteFilter`); "Send to Client" email compose (`showSendQuoteEmailPanel()`, `sendQuoteEmail()`); sequential invoice numbers (`_nextInvoiceNumber()`, `ySettings.invoicePrefix`/`invoiceCounter`); Invoice Detail Modal with 5-step Tab Timeline Strip; "Mark as Paid" (`showMarkPaidModal()`, `saveMarkPaid()`) writing to `yPayments` + `syncTabStatusToCarte`; "Tab closed 🎉" toast; "Send Invoice" email compose; clickable invoice rows; invoice prefix/counter in Settings Defaults.
- **2026-05-08** — Veriqo: N/A toggle on fridge temperature and cleaning chemical fields (`toggleNA()`); allergen matrix print button on next job banner (`_printNextJobAllergenMatrix(job)`, `#printAllergenContainer`); per-tile Settings accordion — each of 20 dashboard tiles has a banner card with a show/hide toggle (`toggleTile(key, checked)`, `syncTileToggles()`) and an expandable dropdown for tile-specific config (units, thresholds, staff, suppliers, checklists); `settings.enabledTiles` persistence; `updateDashboard()` hides/shows tile elements by `id="tile-{key}"`. Carte: Auto-Allergen Matrix on expanded job cards (`generateAllergenMatrix(jobId)`); Post-Event Follow-up email draft on past job cards (`draftFollowUpEmail(jobId)`); customisable dashboard toggles (`mSettings.dashboardConfig` — `showNextBooking`, `showStats`, `showQuickActions`; gold toggle variant `.toggle-slider`; `toggleDashWidget()`, `loadSettingsToggles()`). Yield: Magic Link copy button in quote detail modal (`copyMagicLink(event)`, `window._currentQuoteId`). Both apps: Yield switcher button hidden (`display:none`) until launch.
- **2026-05-06** — Auth session persistence fixed: removed `flowType: 'implicit'` from `supabase.js`; `signOut()` → `{ scope: 'local' }`; `SIGNED_OUT` handler conditional on `_signedIn`; SW cache → `veriqo-v7`; `auth.js` → v15, `supabase.js` → v6
- **2026-05-06** — Carte: Positioning One-Pager PDF (`generatePositioningPDF()`), event templates dropdown, First Inquiry Scripts modal, notes field → `<textarea>`, app switcher URLs fixed to clean routes; ✨ Magic Menu Importer (`api/parse-menu.js` + `handleMagicImport()` in `mise.html`) — OpenAI `gpt-4o` vision extracts dishes/categories/allergens from a menu photo; Job Menu Builder Modal (`#jobMenuBuilderModal`, `openJobMenuBuilder(prefix)`, Library + Custom tabs, `_jobMenuState`)
- **2026-05-06** — Email unsubscribe system: `api/unsubscribe.js`, `trial-emails.js` + `feature-blast.js` respect `email_opt_out`
- **2026-05-05** — Email system fixed end-to-end (Vercel apex→www redirect root cause); trial drip days 5/10/13; `feature-blast.js` broadcast; Stripe CHEF20 coupon
- **2026-05-05** — Yield built: full app (costing, quotes, invoices, jobs, settings), auth hook, `yield-sync.js` v2, `yield-subscription.js` v1
- **2026-05-04** — Trial emails moved to GitHub Actions cron (Vercel free plan has no crons)
- **2026-05-02/03** — Initial suite build: Yield scaffold, Carte paywall + suite pricing, auth v12 + magic links, Stripe webhook, SEO overhaul, Carte Jobs tab redesign

---

## Known Issues & Active Debugging (as of 2026-05-08)

### 1. ✅ RESOLVED — Yield saves silently failing (quotes, invoices, payments not persisting)

**Symptom:** Invoices, quotes, and payments created in the UI disappeared on hard refresh. No error toast visible.

**Root cause (confirmed via DevTools):** `yieldSync.init()` was never being called. Inside `onSignedIn`, the init call was guarded by `if (sb)` — if `supabaseClient` was falsy (e.g. stale SW cache serving an old file), `_sb` and `_uid` stayed null, `isReady()` returned false, and every save function silently returned early before touching Supabase. The SW was also caching old code and blocking hard refreshes.

**Fix applied (2026-05-08):**
- Removed the `if (sb)` inner guard in `onSignedIn` — `init(sb, user.id)` now always fires
- Bumped SW cache from `veriqo-v9` → `veriqo-v10` to force all clients to drop stale cached `yield.html`
- Supabase CDN was already pinned to `@2.39.3` (no change needed)

**Invoices table SQL** — if invoices stop saving again after a schema reset, run:
```sql
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS total         numeric,
  ADD COLUMN IF NOT EXISTS paid_total    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status        text    DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS due_date      date,
  ADD COLUMN IF NOT EXISTS invoice_date  date,
  ADD COLUMN IF NOT EXISTS client_name   text,
  ADD COLUMN IF NOT EXISTS notes         text,
  ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();
```

---

### 2. ✅ RESOLVED — Auth "Signing you in…" screen stuck (all 3 apps)

**Root cause:** The CDN tag `@supabase/supabase-js@2` was unversioned — a recent v2 release changed `getSession()` to internally await a network token-refresh call, blocking auth init for 2–10s.

**Fix applied (2026-05-08):** Pinned all three apps to `@2.39.3/dist/umd/supabase.js`. Confirmed working on Veriqo and Carte immediately after deploy. SW bumped to `veriqo-v11`.

**Auth history (for context):** auth.js went through v21–v25 trying to solve this with loading screens, fallback timers, and Promise.race — none fully resolved it because the underlying cause was the unversioned CDN tag pulling in a breaking Supabase release. v25 with Promise.race remains in place and is now stable on the pinned version.

**⚠ Do not un-pin the CDN tag.** If Supabase JS ever needs upgrading, test auth thoroughly on all three apps before deploying.

---

## Autonomous Development Rules

- Read files before editing. Make minimal targeted changes. Don't refactor beyond the task.
- Commit message format: `Claude: <short description>`
- Never delete working functionality, remove tables, expose secrets, or skip RLS.
- If uncertain about a destructive action, stop and explain.
- Bump `?v=N` on script tags when changing `auth.js`, `supabase.js`, `sync.js`, `mise-sync.js`, `yield-sync.js`, `subscription.js`, `carte-subscription.js`, or `yield-subscription.js`. Also bump the SW cache name (`veriqo-vN`) in `sw.js` when deploying auth or supabase changes so all devices get fresh files immediately.
- After edits: copy files to `/private/tmp/mise-deploy/`, `git add`, `git commit`, `git push`.
- Priority order: reliability > workflow completion > usability > feature expansion > polish.
- All three HTML files may be edited for app-specific features. Avoid touching auth/sync/subscription wiring in any file unless explicitly asked.
