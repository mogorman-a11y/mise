# Veriqo + Carte — Project Reference

## Quick Context

| | Veriqo | Carte |
|---|---|---|
| **File** | `app.html` | `mise.html` |
| **Purpose** | HACCP food safety compliance | Private chef business management |
| **URL** | `getveriqo.co.uk/app` | `getveriqo.co.uk/mise` |
| **localStorage prefix** | `haccp_` | `mise_` |
| **Settings object** | `settings` → `haccp_settings` | `mSettings` → `mise_settings` |
| **Daily records** | `records[]` → `haccp_YYYY-MM-DD` | `mRecords[]` → `mise_YYYY-MM-DD` |
| **Sync module** | `sync.js` (v9) | `mise-sync.js` (v4) |
| **Auth module** | `auth.js` (v9) | `auth.js` (v9) |
| **Subscription module** | `subscription.js` (v5) | `carte-subscription.js` (v1) |

**Paths:**
- Working files: `/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/APPS/HACCP APP/files/`
- Deploy staging (git): `/private/tmp/mise-deploy/`
- Repo: `https://github.com/mogorman-a11y/mise` (branch: `main`)
- Supabase: `https://yixrwyfodipfcbhjcszp.supabase.co`

**Landing page:** `index.html` is a standalone marketing page served at `getveriqo.co.uk/`. It is NOT a copy of `app.html`. It has a small inline JS snippet that redirects already-authenticated users (detected via `sb-*-auth-token` in localStorage) straight to `/app`. Do not overwrite `index.html` with the app shell.

**Deploy:**
```bash
cp "files/app.html" /private/tmp/mise-deploy/app.html   # repeat for each changed file
git -C /private/tmp/mise-deploy add <files> && git -C /private/tmp/mise-deploy commit -m "Claude: description" && git -C /private/tmp/mise-deploy push origin main
# Vercel auto-deploys in ~30s
```

**Deploy directory gotcha:** `/private/tmp/mise-deploy` is wiped on reboot. If git commands fail with "not a git repository", re-clone:
```bash
rm -rf /private/tmp/mise-deploy && git clone https://github.com/mogorman-a11y/mise /private/tmp/mise-deploy
```

---

## Tech Stack

- **Frontend:** Single-file vanilla HTML/CSS/JS — no framework, no bundler
- **Auth:** Supabase Auth (email/password + Google OAuth + magic link) via shared `auth.js`
- **Cloud sync:** Supabase Postgres via `sync.js` (Veriqo) + `mise-sync.js` (Carte)
- **Transactional email:** Resend (`hello@getveriqo.co.uk`) — Carte magic link via `api/carte-magic-link.js`, Veriqo magic link via Supabase OTP
- **Subscription:** Stripe via `subscription.js` (Veriqo) + `carte-subscription.js` (Carte) + Supabase Edge Functions (`create-checkout`, `stripe-webhook`)
- **PWA:** `sw.js` (network-first for app pages, cache-first for assets), `manifest.json` (Veriqo), `mise-manifest.json` (Carte)
- **Hosting:** Vercel — `getveriqo.co.uk` DNS points to Vercel, previously GitHub Pages

---

## Vercel Configuration

`vercel.json` in repo root:
```json
{
  "version": 2,
  "builds": [
    { "src": "api/*.js", "use": "@vercel/node" },
    { "src": "**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1.js" },
    { "src": "/mise", "dest": "/mise.html" },
    { "src": "/app", "dest": "/app.html" }
  ]
}
```

`package.json` declares `@supabase/supabase-js` dependency for the serverless functions. No `engines` or `runtime` field — Vercel uses its default Node version.

**Vercel env vars required:**
- `SUPABASE_URL` — `https://yixrwyfodipfcbhjcszp.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — service_role secret from Supabase → Project Settings → API
- `RESEND_API_KEY` — from resend.com dashboard
- Stripe keys (for existing Veriqo subscription functions)

**Gotcha:** Vercel serves `api/*.js` functions at `/api/filename.js` (keeps extension) — the `routes` entry strips `.js` so `/api/carte-magic-link` works.

---

## Supabase Tables

All tables have RLS enabled (users can only access their own rows).

### Current tables

| Table | App | PK | Key columns |
|---|---|---|---|
| `profiles` | Both | `id` | `business_name`, `chef_name`, `subscription_status`, `subscription_plan`, `trial_ends_at`, `stripe_customer_id`, `logo`, `onboarded` |
| `settings` | Veriqo | `id` (user_id) | `config` (JSON), `updated_at` |
| `haccp_records` | Veriqo | `(user_id, date)` | `records` (JSON array) |
| `mise_settings` | Carte | `id` (user_id) | `config` (JSON), `updated_at` |
| `mise_records` | Carte | `(user_id, date)` | `records` (JSON array) |
| `push_subscriptions` | Veriqo | `user_id` | `endpoint`, `subscription` (JSON) |
| `leads` | Landing | `email` | `source` |

**Note:** `mise_records` was missing and had to be created on 2026-04-27. All Carte daily record sync was failing silently until this was done.

### Target shared tables (not yet applied)

`shared-suite-schema.sql` is drafted but not run. Target tables: `clients`, `staff`, `dishes`, `menus`, `menu_dishes`, `jobs`, `job_menus`, `attachments`, `business_settings`, `invoices`, `invoice_items`, `payments`, `expenses`, `mileage`, `tax_categories`.

---

## Auth

Shared `auth.js` module used by both apps. Per-app branding is configured via `window.MISE_AUTH_CONFIG` set in the HTML before `Mise.auth.init()`:

```javascript
// mise.html sets this before loading auth.js:
window.MISE_AUTH_CONFIG = {
  name: 'Carte', tagline: 'Private chef. Perfectly organised.',
  background: '#F5F0E8', submitColor: '#1C2B1E', nameColor: '#1C2B1E',
  logoHTML: '<svg ...gold C SVG...></svg>'
};
// app.html sets nothing — auth.js defaults to Veriqo branding
```

**Magic link flow:**
- Veriqo: calls `supabaseClient.auth.signInWithOtp()` directly (Supabase sends the email via Resend SMTP)
- Carte: `auth.js` POSTs `{ email, redirectTo }` to `/api/carte-magic-link` → Vercel function calls `auth.admin.generateLink()`, extracts `data.properties.hashed_token`, builds `https://getveriqo.co.uk/mise?token_hash=HASH&type=magiclink`, sends Carte-branded email via Resend

**Carte magic link auth callback:** `auth.js init()` detects `?token_hash=...&type=magiclink` in the URL and calls `supabaseClient.auth.verifyOtp({ token_hash, type: 'magiclink' })` directly. This bypasses Supabase's `/verify` redirect endpoint, avoiding a PKCE code-exchange mismatch that occurs because admin-generated links have no client-side PKCE verifier.

**Resend API keys (two separate keys):**
- `Carte Send` key → Vercel env var `RESEND_API_KEY` (used by `carte-magic-link.js`)
- `Veriqo` key → Supabase SMTP Password field (used for Veriqo OTP emails)
- Both keys show in resend.com → API keys. If Supabase SMTP stops working, the Veriqo key in Supabase may be stale — generate a new one and paste it into Supabase → Auth → SMTP Settings → Password.

**Supabase redirect URLs** (Authentication → URL Configuration): `https://getveriqo.co.uk`, `https://getveriqo.co.uk/app`, `https://getveriqo.co.uk/mise`, `https://getveriqo.co.uk/**` — all four are set.

**Login UI:** email/password form + Google OAuth button + "Email me a sign-in link" button (all apps). Magic link mode hides password field, shows back link.

---

## Sync Architecture

### How it works

Both apps use the same pattern:
1. **On sign-in:** pull Supabase → full-replace localStorage → refresh UI
2. **On save:** push to Supabase → update localStorage
3. **On tab focus:** re-pull Supabase (visibility change listener)

Supabase is the source of truth. localStorage is a write-through cache. Cloud data fully replaces local on pull — the pull clears old keys first, then writes fresh from Supabase.

### Cross-app settings sync (interim bridge)

While shared tables don't exist yet, dishes/menus/clients/credentials are shared by cross-pulling the other app's settings table on login.

**Veriqo login (`sync.js._pullSettings`):**
1. Fetches own `settings` row → full-replaces `settings` object + localStorage
2. Fetches Carte's `mise_settings` → `_mergeSuiteData(settings, carteConfig, 'veriqo')` (additive dedup by name)
3. Saves merged settings back to `settings` table
4. Calls `_mirrorSettingsToCarte(settings)` → reads `mise_settings`, merges, upserts back

**Carte login (`mise-sync.js._pullSettings`):**
1. Fetches own `mise_settings` → full-replaces `mSettings` + localStorage
2. Fetches Veriqo's `settings` → `_mergeSuiteData(mSettings, veriqoConfig, 'carte')` (additive dedup)
3. Saves merged settings back to `mise_settings` table
4. `_mirrorSettingsToVeriqo` is called from `saveSettings()` (on explicit save)

### Cross-app job record sync

- Veriqo job records (`type: 'job'`) are mirrored to `mise_records` with `sourceApp: 'veriqo'` prefix on IDs
- Carte job records are mirrored to `haccp_records` with `sourceApp: 'carte'` prefix
- Prefix check prevents re-import loops: a mirrored record is skipped if it already has the origin app's prefix
- Mirrored Carte jobs include `msg` and `status` fields so Veriqo can display them correctly
- **`mirrorJobToVeriqo` (mise.html) upserts** — replaces existing mirrored record by ID, so editing a job in Carte (e.g. adding a menu) propagates immediately to the Veriqo localStorage copy
- **`saveJobEdit` calls `mirrorJobToVeriqo`** with the updated record after saving
- **`_pullCarteJobs` (sync.js) upserts** — on every Supabase pull, existing Carte job entries in localStorage are replaced with the fresh Supabase data (not skipped if ID already present)

### Suite delete propagation

When a menu or dish is deleted in either app, it is also deleted from the other app's settings table in Supabase. This prevents the cross-pull from resurrecting deleted items on next login.

- `Mise.sync.deleteSuiteMenu(id)` / `Mise.sync.deleteSuiteDish(id)` — exported from both `sync.js` and `mise-sync.js`
- Called from `menuDelete()` and `dishDelete()` in `app.html`
- Called from `deleteMenu()` and `deleteDish()` in `mise.html`

### `_mergeSuiteData` — what gets shared

| Data | Veriqo key | Carte key | Merge logic |
|---|---|---|---|
| Clients/customers | `savedCustomers` | `savedClients` | Dedup by name (case-insensitive) |
| Dishes | `savedDishes` | `savedDishes` | Dedup by dish name |
| Menus | `savedMenus` | `savedMenus` | Dedup by menu name |
| Credentials | `credentials` | `credentials` | Dedup by name+expiry |

All merges are additive — items in target are never overwritten, only added if missing.

### Known sync gotcha: customers in Veriqo

Veriqo's `logCustomerJob()` stores customers as job records in `records[]`, NOT in `settings.savedCustomers`. So customers created via job logging in Veriqo won't appear in Carte's Clients list unless they are also explicitly added to `savedCustomers`. `getAddressBook()` in Veriqo does merge both sources for display, but the sync only mirrors `savedCustomers`.

---

## Veriqo (app.html) — What's Built

**Record types:** fridge, cooking, cooling, reheating, delivery, cleaning, probe, pest, illness, opening checklist, closing checklist, cross-contamination, job (menus), kitchenassess, allergen, transport, mobileset, credentials

**Key features:**
- Dashboard: OK/Warn/Fail stats, tap-to-filter, tile grid
- Settings cog in header (top-right, always visible) — not a dashboard tile
- All private chef tiles always visible: Menus, Customers, Kitchen assessment, Transport temps, Mobile setup, Credentials — under "Private chef" section label
- Tiles are compact (padding reduced, icons 32px)
- Record forms with pass/warn/fail threshold calculation
- Records view — day blocks, expandable, export .txt + print-to-PDF
- Settings: staff, unit names, alert thresholds, reminder checklists, brand profile (logo upload)
- CRM / Customers: address book, tap-to-edit cards, clickable phone/email/map
- **Next booking banner** — collapsible dark (`#1C2B1E`) banner above the stats row; shows soonest upcoming job (scans all `haccp_*` days for `type:'job'` with `eventDate >= TODAY`). First tap expands a detail panel: date/time, job type, covers, location (Google Maps link), phone, email, notes, menus with dish chips. Gold "View booking in Carte →" button at bottom. Hides if no upcoming jobs. `updateNextJobBanner()` / `toggleNextJobBanner()`. Alert strip excludes `type:'job'` records (they have no HACCP status field).
- Approved Supplier Register
- Menus & dish library (shared with Carte — see sync section)
- Transport temperature log (with client autofill)
- Credentials tracker (90-day expiry warning)
- Stripe paywall (14-day trial in prod, 1 year for beta accounts)
- PWA (installable, offline-first)
- Enter/Return key submits login form
- First-login welcome modal (references cog icon for Settings)
- App switcher pill → Carte (dark forest background, gold C icon, gold "Carte" text)

**Key JS patterns:**
- `saveSettings()` always calls `Mise.sync.saveSettings(settings)` if sync available
- `getAddressBook()` — merges `settings.savedCustomers` + historical job records, deduped
- `DISH_CATEGORIES = ['','Canapé','Starter','Fish course','Main','Side','Sauce','Pre-dessert','Dessert','Cheese','Petit four','Bread','Other']`
- `_sortByMealOrder(dishes)` — sorts by DISH_CATEGORIES index, uncategorised last
- Menu onclick handlers use quoted IDs: `onclick="menuEdit('${m.id}')"` — IDs are strings, not integers

---

## Carte (mise.html) — What's Built

**Tabs:** Home, Clients, Calendar, Menus, More (→ Transport, Assess, Allergen, Credentials, Settings, Save as app)

**Features:**
- Dashboard: greeting, next-booking card (tappable — calls `calViewJob(id)` to open Jobs tab with that booking expanded), stats strip, quick-action buttons, nav tile grid
- Clients CRM: add/edit/delete, tap-to-expand cards, clickable phone/email/maps
- Calendar: month grid, job indicators, unavailable dates, day detail panel, book-job button
  - Tapping a job in the calendar day panel calls `calViewJob(id)` → switches to Jobs tab and scrolls to that job card
  - `getAllJobsByDate()` deduplicates by ID (same pattern as `getAllJobs()`)
- Menus: dish library (same DISH_CATEGORIES as Veriqo), saved menus (multi-dish picker)
- Jobs tab: "＋ Book a New Job" button opens collapsible form (closes on save); upcoming jobs (soonest-first) shown immediately; "▼ View previous bookings" toggle at bottom for past jobs grouped by month. Cards: 3 states (collapsed / read-only / inline edit, fields prefixed `jedit-`). Mirrored jobs (`veriqo_` prefix) read-only. State vars: `_expandedJobId`, `_editingJobId`, `_newJobFormOpen`, `_pastJobsOpen`. Helpers: `_jobCardHTML(j)`, `_jobsByMonth(jobs)`. `calViewJob(id)` auto-opens past section for historical jobs.
- Transport: temp log with client autofill, warm-temp warning
- Kitchen Assessment: fridge/freezer temps, condition, notes
- Allergen Log: 14-allergen checkbox grid
- Credentials: certificate tracker with 90-day expiry warning
- Settings: profile, staff list; also reachable via gold cog in header (always visible)
- No Stripe paywall (Carte is free for now)
- PWA: `mise-manifest.json`, Carte icons (`icons/carte-192.png`, `carte-512.png`, `carte-apple-touch.png`), install banner on home tab, "Save as app" in More menu
- App switcher pill → Veriqo (semi-transparent background, Veriqo shield icon, "Veriqo" text)
- **Settings cog in header** — gold `#C8A96E` cog button (always visible, right of title, left of Veriqo pill), calls `showTab('settings')`
- Logo upload in Settings (`carte-logo-img`, `previewCarteLogo`, `clearCarteLogo`); stored in `mSettings.logo`; syncs to Veriqo
- Booking report PDF: `exportJobsPDF()` / `buildJobsPDF()` — Carte-branded, jobs by month, menus as sub-rows
- Menus on jobs: `job.menus = [{name, dishes:[...]}]` frozen snapshots; state-based editor using `_jobMenuState[prefix]` — "From your library" checkboxes + "Build a custom menu" section; `_getSelectedMenusSnapshot(prefix)` returns the snapshot for saving

**Key JS patterns:**
- `saveSettings()` always calls `Mise.sync.saveSettings(mSettings)` if sync available
- `saveProfile()` also updates `profiles` Supabase table (name, company, logo)
- `getAllJobs()` / `getAllTypeRecords(type)` scan all `mise_*` localStorage keys
- `getAddressBook()` — merges `mSettings.savedClients` + historical job records
- `saveDayRecords(ds, arr)` fires `Mise.sync.saveDay()`
- `saveJobEdit(id)` calls `mirrorJobToVeriqo(updatedRec)` after saving so menu changes propagate immediately

---

## Serverless Functions (`api/`)

| File | Purpose |
|---|---|
| `api/carte-magic-link.js` | Generates Supabase magic link server-side + sends Carte-branded email via Resend |
| `api/create-checkout.js` | Stripe checkout session (Veriqo subscription) |
| `api/stripe-webhook.js` | Stripe webhook handler |

---

## Branding

| | Veriqo | Carte |
|---|---|---|
| **Background** | `#f5f4f0` (light grey) | `#F5F0E8` (warm parchment) |
| **Header** | `#fff` with green accents | `#1C2B1E` (deep forest) |
| **Primary action** | `#1a1a18` (near-black) | `#1C2B1E` (forest) |
| **Accent** | `#2D7A3A` (green) | `#C8A96E` (gold) |
| **Secondary accent** | — | `#3A7D44` (action green) |
| **Logo** | Veriqo shield SVG | `C` arc path SVG — `#C8A96E` on `#1C2B1E`, rx="14" |

---

## Suite Direction

Three separate apps sharing one account and one business data layer:

| App | Core question |
|---|---|
| **Veriqo** | Am I compliant? |
| **Carte** | Am I organised? |
| **Finance** | Am I paid and profitable? |

Shared nouns (first-class data once migrated): clients, jobs, dishes, menus, staff, business settings, attachments.

**Migration phases:**
1. Review/run `shared-suite-schema.sql` in Supabase
2. Build `suite-sync.js` to load/save shared tables
3. Import existing clients/customers/dishes/menus/jobs into shared tables
4. Migrate Carte CRM, jobs, dishes, menus to shared tables
5. Migrate Veriqo customer/job/menu screens to shared tables; add optional FK links on HACCP records
6. Build Finance app on shared data from day one
7. App switcher, shared profile/business settings, suite landing, subscription packaging

**Open decisions:**
- Multi-staff per business, or one user = one business for now?
- Use `business_id` on shared records from the start?
- Job status values: `lead`, `confirmed`, `completed`, `cancelled`, `invoiced`?
- Menus on jobs: **decided — frozen snapshots** (`job.menus = [{name, dishes:[...full objects]}]`). Library edits don't affect past bookings.
- Finance: Stripe-powered invoices from day one, or manual payment tracking first?

---

## Roadmap / Next Steps

### Short term
- [ ] Test Carte checkout end-to-end with a real payment (use promo code for 100% off)

### Medium term (suite migration)
- [ ] Run `shared-suite-schema.sql` in Supabase
- [ ] Build `suite-sync.js`
- [ ] Import legacy clients/dishes/menus/jobs into shared tables
- [ ] Migrate Carte + Veriqo to shared tables

### Long term
- [ ] Finance app
- [ ] Suite landing page at `getveriqo.co.uk`
- [ ] Subscription packaging

### Done (2026-05-03, session 2)
- [x] **Carte paywall + Suite pricing** — `carte-subscription.js` (v1): Carte-branded dark paywall with Carte-only (£12/mo, £120/yr) and Suite (£20/mo, £200/yr) options. `subscription.js` (v5): plan-aware Veriqo access, Carte pill hidden for Veriqo-only subscribers, suite upgrade nudge. `auth.js` (v9): calls `Mise.carteSubscription.check()` after sync if present. `app.html`: `id="carte-switcher-btn"`, `renderSubscriptionCard` shows plan name and suite upgrade for Veriqo-only active subscribers. `mise.html`: `id="veriqo-switcher-btn"`, loads `carte-subscription.js`. Edge functions updated: `create-checkout` accepts `{app, period}` params and routes to correct Stripe price; `stripe-webhook` writes `subscription_plan` on checkout. `profiles` table has new `subscription_plan` column (values: `null`=trial/legacy, `veriqo`, `carte`, `suite`). Paywall upsell: Veriqo subscriber hitting Carte sees "Upgrade to Suite" as primary CTA; Carte subscriber hitting Veriqo sees the same in reverse.

### Done (2026-05-03)
- [x] **SEO / LLMO / GEO visibility overhaul** — `index.html` rewritten as a standalone marketing landing page with `<meta name="description">`, OG tags, Twitter Card, JSON-LD structured data (`Organization` + `SoftwareApplication` for both apps), ~300 words of crawlable body copy, and a logged-in redirect to `/app`. `app.html` and `mise.html` both got meta description, canonical URL, `noindex` (auth-gated pages), and OG tags. New `llms.txt` at root describes both apps in plain text for AI crawler discoverability. `sitemap.xml` updated to include `/mise` and refreshed `lastmod` dates. Google Search Console: sitemap submitted at `https://getveriqo.co.uk/sitemap.xml`.

### Done (2026-05-02, session 3)
- [x] **Deleted `api/test.js`** — debug stub removed from repo and deployed
- [x] **Next booking banner in Carte is tappable** — `#dash-next` has `onclick="calViewJob(this.dataset.jobId)"`. `data-job-id` set when banner renders. "View →" label added top-right. `:active` opacity fade for touch feedback.
- [x] **Redesigned Carte Jobs tab** — "＋ Book a New Job" button leads the tab; form is collapsible (hidden by default, closes on save). Upcoming bookings shown immediately below sorted soonest-first. Past jobs behind "▼ View previous bookings" toggle at the bottom. Extracted `_jobCardHTML(j)` and `_jobsByMonth(jobs)` helpers to avoid duplication. `calViewJob` auto-opens past section for historical jobs.

### Done (2026-05-02, session 2)
- [x] **Next booking banner in Veriqo** — collapsible dark banner shows soonest upcoming Carte job; tap to expand detail panel. `updateNextJobBanner()` / `toggleNextJobBanner()`.
- [x] **Fixed alert strip "job · undefined"** — excluded `type:'job'` records from HACCP alert strip filter.
- [x] **Redesigned job menu editor in Carte** — state-based UX (`_jobMenuState[prefix]`); attached menus as removable cards; library checkboxes; custom builder with inline quick-add.
- [x] **Fixed sync upserts** — `mirrorJobToVeriqo`, `saveJobEdit`, and `_pullCarteJobs` were all add-only; now replace by ID so edits propagate correctly.

---

## Autonomous Development Rules

- Read files before editing. Make minimal targeted changes. Don't refactor beyond the task.
- Commit message format: `Claude: <short description>`
- Never delete working functionality, remove tables, expose secrets, or skip RLS.
- If uncertain about a destructive action, stop and explain.
- Bump `?v=N` query string on script tags when changing `sync.js`, `mise-sync.js`, `auth.js`, `subscription.js`, or `carte-subscription.js` (cache busting).
- After edits: copy files to `/private/tmp/mise-deploy/`, `git add`, `git commit`, `git push`.
- Priority order: reliability > workflow completion > usability > feature expansion > polish.
