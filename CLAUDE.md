# Veriqo + Carte — Project Reference

## Two-App Architecture

One GitHub repo, one Supabase project, one Vercel deployment. Two standalone apps.

| | Veriqo | Carte |
|---|---|---|
| **File** | `app.html` | `mise.html` |
| **Purpose** | HACCP food safety compliance (any commercial kitchen) | Private chef business management |
| **URL** | `getveriqo.co.uk/app` | `getveriqo.co.uk/mise.html` |
| **localStorage prefix** | `haccp_` | `mise_` |

---

## Tech Stack

- **Frontend:** Single-file vanilla HTML/CSS/JS — no framework, no bundler, no npm
- **Auth:** Supabase Auth (email/password + Google OAuth + magic link) via shared `auth.js`
- **Cloud sync:** Supabase Postgres via `sync.js` (Veriqo) and `mise-sync.js` (Carte)
- **Subscription:** Stripe paywall via `subscription.js` + `api/` Vercel serverless functions (Veriqo only — Carte has no paywall yet)
- **PWA:** Service worker (`sw.js`), manifest (`manifest.json`), icons in `icons/`
- **Hosting:** Vercel (auto-deploys from `main` within ~30 seconds)
- **Repo:** `https://github.com/mogorman-a11y/mise` (branch: `main`)
- **Supabase project:** `https://yixrwyfodipfcbhjcszp.supabase.co`

---

## File Structure

```
app.html          ← Veriqo HACCP app
mise.html         ← Carte private chef app
auth.js           ← Shared auth (email/pw, Google, magic link, account card)
supabase.js       ← Shared Supabase client init
sync.js           ← Cloud sync for Veriqo (haccp_records + settings tables)
mise-sync.js      ← Cloud sync for Carte (mise_records + mise_settings tables)
subscription.js   ← Stripe paywall for Veriqo only
sw.js             ← Service worker (PWA, offline-first)
manifest.json     ← PWA manifest
vercel.json       ← Vercel config (Node 18 for api/ functions)
CNAME             ← getveriqo.co.uk
api/              ← Vercel serverless functions (Stripe checkout + webhook)
supabase/functions/  ← Supabase Edge Functions (Deno/TypeScript)
  create-checkout/     ← Creates Stripe Checkout session
  create-portal-session/ ← Creates Stripe Billing Portal session
  stripe-webhook/      ← Handles Stripe events → updates profiles table
  send-push-notifications/ ← Daily push reminders (morning + closing)
  capture-lead/        ← Stores landing page email leads
icons/            ← PWA icons
images/           ← Landing page images
index.html        ← Landing page (getveriqo.co.uk)
```

---

## Local Paths

- **Working files (Google Drive):** `/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/APPS/HACCP APP/files/`
- **Deploy staging (git repo):** `/private/tmp/mise-deploy/`
- **Copy flow:** edit in Google Drive → copy to `/private/tmp/mise-deploy/` → git commit + push

---

## Supabase Tables

All tables have Row Level Security enabled.

| Table | Used by | Key columns |
|---|---|---|
| `profiles` | Both | `id`, `business_name`, `chef_name`, `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `logo`, `onboarded`, `updated_at` |
| `haccp_records` | Veriqo | `user_id`, `date`, `records` (JSON array) |
| `settings` | Veriqo | `id` (user_id), `config` (JSON), `updated_at` |
| `mise_records` | Carte | `user_id`, `date`, `records` (JSON array) |
| `mise_settings` | Carte | `id` (user_id), `config` (JSON), `updated_at` |
| `push_subscriptions` | Veriqo | `user_id`, `endpoint`, `subscription` (JSON) |
| `leads` | Landing page | `email`, `source` |

---

## Veriqo (app.html) — What's Built

**Record types:** fridge, cooking, cooling, reheating, delivery, cleaning, probe, pest, illness, opening checklist, closing checklist, cross-contamination, job (menus), kitchenassess, allergen, transport, mobileset, credentials

**Key features:**
- Dashboard with OK/Warn/Fail stats, tap-to-filter, tile grid
- **Settings cog in the header bar** (top-right) — not a dashboard tile
- **All private chef tiles always visible** on dashboard (no toggle) — Menus, Customers, Kitchen assessment, Transport temps, Mobile setup, Credentials — under a "Private chef" section label
- Tiles are compact (padding reduced, icons 32px)
- All record forms with pass/warn/fail threshold calculation
- Records view — day blocks, expandable, export .txt + print-to-PDF
- Settings: staff, unit names, alert thresholds, reminder checklists, brand profile (logo upload)
- CRM / Customers tab: address book, tap-to-edit cards, clickable phone/email/map
- Calendar: month grid, job indicators, unavailable toggle
- Approved Supplier Register
- **Menus & dish library:**
  - `DISH_CATEGORIES = ['','Canapé','Starter','Fish course','Main','Side','Sauce','Pre-dessert','Dessert','Cheese','Petit four','Bread','Other']`
  - Category dropdown on both dish builders (Menus tab + Customer Job)
  - Dishes auto-sort into meal order on add; dish library grouped by category with green headers
  - Dishes in menu builder are **clickable** — tap to expand inline edit (name, category, allergens)
  - Saved menus display dishes sorted by course with category headers
- Transport temperature log (with client autofill)
- Credentials tracker (90-day expiry warning)
- Cloud sync (localStorage ↔ Supabase on every save)
- Stripe paywall (14-day trial in prod, 1 year for beta accounts)
- PWA (installable, offline-first)
- **Enter/Return key submits the login form**
- First-login welcome modal (references cog icon for Settings)

**Key JS patterns:**
- `settings` object → `haccp_settings` localStorage key + Supabase `settings` table
- `records[]` = today's records, stored under `haccp_YYYY-MM-DD`
- `getDayRecords(d)` reads any historical day
- `getAddressBook()` — merges `settings.savedCustomers` + historical job records, deduped
- `DISH_CATEGORIES` array drives category dropdowns, sort order, and grouping
- `_sortByMealOrder(dishes)` — sorts by DISH_CATEGORIES index, uncategorised last
- `saveSettings()` always calls `Mise.sync.saveSettings(settings)` if sync available
- **Cross-app dish/menu library sharing** — on login, pulls from Carte's `mise_settings` table and merges `savedDishes` + `savedMenus` (deduped by name, own entries win)

---

## Carte (mise.html) — What's Built

**Tabs (bottom nav):** Home, Clients, Calendar, Menus, More
**More menu leads to:** Transport, Assess, Allergen, Credentials, Settings

**Features:**
- Dashboard: greeting, next-booking card, stats strip, quick-action buttons, nav tile grid
- Clients CRM: add/edit/delete, tap-to-expand cards, clickable phone/email/maps
- Calendar: month grid, job indicators, unavailable dates, day detail panel, book-job button
- Menus: dish library (same DISH_CATEGORIES as Veriqo), saved menus (multi-dish picker)
- Jobs: log job with client autofill, all-history grouped by month, expandable cards
- Transport: temp log with client autofill, warm-temp warning
- Kitchen Assessment: fridge/freezer temps, condition, notes
- Allergen Log: 14-allergen checkbox grid
- Credentials: certificate tracker with 90-day expiry warning
- Settings: profile, staff list, Veriqo sync toggle
- **Cloud sync via `mise-sync.js`** — pulls/pushes `mise_records` + `mise_settings` tables on sign-in/save
- **Cross-app dish/menu library sharing** — on login, pulls from Veriqo's `settings` table and merges `savedDishes` + `savedMenus` (deduped by name, own entries win). Dishes added in Carte appear in Veriqo and vice versa automatically.
- **No Stripe paywall** — anyone with a Supabase account can access Carte for free (paywall is future work)

**Key JS patterns:**
- `mSettings` → `mise_settings` localStorage + Supabase `mise_settings` table
- `mRecords[]` = today's records, stored under `mise_YYYY-MM-DD`
- `getDayRecords(ds)` / `saveDayRecords(ds, arr)` — `saveDayRecords` fires `Mise.sync.saveDay()`
- `getAllJobs()` / `getAllTypeRecords(type)` scan all `mise_*` localStorage keys
- `getAddressBook()` — merges `mSettings.savedClients` + historical job records
- `saveSettings()` always calls `Mise.sync.saveSettings(mSettings)` if sync available

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

## Deploy Flow

```bash
# 1. Edit files in Google Drive path
# 2. Copy to staging (example — copy whatever changed)
cp "/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/APPS/HACCP APP/files/app.html" /private/tmp/mise-deploy/app.html
cp "/Users/michael/Library/CloudStorage/GoogleDrive-mike@sideordercatering.co.uk/My Drive/APPS/HACCP APP/files/mise.html" /private/tmp/mise-deploy/mise.html
# 3. Commit and push (Vercel auto-deploys in ~30s)
cd /private/tmp/mise-deploy
git add <changed files>
git commit -m "feat: description"
git push origin main
```

---

## Email Deliverability (TODO — not done yet)

Magic link and auth emails currently go to junk. Fix:
1. Sign up at **resend.com** (free, 3k emails/month)
2. Add domain `getveriqo.co.uk` → get SPF + DKIM + DMARC DNS records → add to domain registrar → verify
3. Create API key in Resend (SMTP password)
4. In Supabase → **Project Settings → Auth → SMTP Settings** → enable custom SMTP:
   - Host: `smtp.resend.com`, Port: `465`, Username: `resend`, Password: API key
   - Sender: `hello@getveriqo.co.uk` / `Veriqo`

---

## What Was Built (Session Log)

### Session 2026-04-27
- Renamed Mise → Bookr → **Carte** (trademark confirmed clear in Nice Classes 35, 42, 43)
- Built `mise-sync.js` — cloud sync for Carte (`mise_records` + `mise_settings` tables)
- Veriqo: Settings moved to **cog icon in header** (top-right, always visible)
- Veriqo: **All private chef tiles always visible** — no toggle needed
- Veriqo: Tiles made compact (padding reduced, icons 32px)
- Veriqo: **Enter/Return key** submits login form
- Both apps: `DISH_CATEGORIES` array added; dishes auto-sort by meal course order
- Both apps: Dish library grouped by category with headers; dishes **clickable/editable** in menu builder
- Both apps: **Cross-app dish/menu library sharing** — `sync.js` and `mise-sync.js` each cross-pull the other app's settings table on login and merge `savedDishes` + `savedMenus` (deduped by name)
- Carte logo: gold `C` arc path SVG on deep forest background
- First-login welcome modal updated to reference cog icon location
- `CLAUDE.md` created with full project reference

---

## Outstanding / Next Steps

- **Email deliverability:** Set up Resend custom SMTP (see above) — magic link emails go to junk
- **Carte Stripe paywall:** Add subscription check when selling Carte standalone or as a suite
- **Carte PDF export:** Print-to-PDF job reports (similar to Veriqo's `buildPDFExport()`)
- **Suite landing page:** Page at `getveriqo.co.uk` explaining both apps and bundle offer
- **Veriqo PDF export plan:** Exists at `/Users/michael/.claude/plans/snappy-munching-river.md` — adds "Export PDF" button in `buildDayBlock()`
