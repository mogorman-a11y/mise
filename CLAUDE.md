# Veriqo — Agent Instructions

> **Read this entire file before touching any code.**
> This is the only authoritative instruction file. CURRENT_STATE.md has been deleted — do not recreate it.

---

## ⚠ Critical rules

1. **Always `git pull origin main` before making any changes.** Multiple Claude Code sessions run against this repo (cloud + MacBook Air). Pushing stale code overwrites live fixes and breaks production.

2. **Source of truth is this GitHub repo** (`mogorman-a11y/mise`, `main` branch). Do NOT work from any local `files/` directory or use `vercel deploy --prod`. The old deploy chain is retired.

3. **Deploy chain:** push to `main` → Vercel auto-deploys → live at `getveriqo.co.uk`. No manual step.

4. **Bump the `?v=N` query string in `app.html` on every change to any `js/modules/*.js` or `js/core/*.js` file** (not just `haccp.js` — this now applies repo-wide; see "Live versions" below for current values). Do NOT bump `sw.js` cache name — the SW uses network-first so query string bumps are sufficient (though this repo has often bumped it anyway alongside version bumps — harmless, not required). **Every commit that touches a versioned file must bump its version — including bug fixes. Skipping this causes browsers to serve stale cached code.**

5. **Update this file** when versions change or architecture changes.

---

## Live versions

Source of truth is always `app.html`'s own `<script src>` tags — this table can drift; grep `app.html` if in doubt. Last checked 2026-07-21.

| File | Version | Where set |
|---|---|---|
| `js/modules/haccp.js` | `?v=71` | `app.html` script tag — table had drifted to a stale `?v=69`; corrected 2026-07-22 |
| `js/modules/menus.js` | `?v=37` | `app.html` — this table had drifted to a stale `?v=30`; corrected 2026-07-22 against the actual `app.html` tag |
| `js/modules/costing.js` | `?v=36` | `app.html` |
| `js/modules/recipe-costing.js` | `?v=3` | `app.html` — new 2026-07-21, Costing rebuild Phases 2–4 (recipe entry, menu/job derived costing, actual-cost reconciliation) |
| `js/modules/ai-estimate.js` | `?v=6` | `app.html` |
| `js/modules/prep.js` | `?v=9` | `app.html` |
| `js/modules/dashboard.js` | `?v=6` | `app.html` |
| `js/modules/intake.js` | `?v=1` | `app.html` |
| `js/modules/lead-scripts.js` | `?v=1` | `app.html` |
| `js/modules/team.js` | `?v=2` | `app.html` |
| `auth.js` | `?v=37` | `app.html` |
| `yield-sync.js` (root) | `?v=17` | `app.html` |
| `sync.js` | `?v=20` | `app.html` |
| `js/core/idb-queue.js` | `?v=2` | `app.html` |
| `js/core/pull-result.js` | `?v=2` | `app.html` |
| `js/core/ai-other-costs-store.js` | `?v=2` | `app.html` |
| `js/core/allergens.js` / `menu-dishes.js` / `gp-math.js` / `ai-job-shape.js` | `?v=1` each | `app.html` |
| `js/core/subscription.js` | `?v=10` | `app.html` |
| Service worker cache | `veriqo-v125` | `sw.js` line 8 |

Bumping `sw.js`'s cache name is **not required** for JS module changes (network-first, per rule 4) but this project has bumped it alongside every round of fixes in the 2026-07 critical-fixes pass anyway — harmless belt-and-braces, not a hard requirement.

---

## Architecture

- **Repo:** `mogorman-a11y/mise` on GitHub, `main` branch
- **Live site:** `getveriqo.co.uk/app` → served by Vercel, auto-deploy on push to `main`
- **Vercel project: `files`** (project ID `prj_lMBGlA1dkPtLSm3bUn9KZtAKpuWG`) — this is the only live Vercel project for Veriqo. The old `mise` and `mise-deploy` projects have been deleted. Do not recreate them.
- **No staging** — changes go live immediately on push.
- **Domain:** apex `getveriqo.co.uk` is canonical. `www.getveriqo.co.uk` redirects to the apex (set in Vercel Project → Settings → Domains, 2026-07-03). Every canonical tag, `og:url`, and JSON-LD `url`/`@id` across the site must use the apex, no `www` — do not reintroduce hardcoded `www.getveriqo.co.uk` links.
- **Supabase:** `https://yixrwyfodipfcbhjcszp.supabase.co`

### App structure

One unified PWA (`app.html`) with five modules: Dashboard, HACCP, Menus, Costing, Settings.

| Module | JS file | localStorage prefix |
|--------|---------|---------------------|
| HACCP  | `js/modules/haccp.js` | `haccp_` |
| Menus  | `js/modules/menus.js` | `mise_` |
| Prep Lists | `js/modules/prep.js` | — (Supabase only) |
| Costing (incl. AI Estimate screen) | `js/modules/costing.js` + `js/modules/ai-estimate.js` | `yield_` (+ `vq_ai_other_costs`) |
| Dashboard | `js/modules/dashboard.js` | — |
| Sync (Menus/HACCP/shared) | `sync.js` | — |
| Sync (Costing/Yield-specific) | `yield-sync.js` (repo root) | — |

AI Estimate is a screen inside the Costing module (`showScreen('ai-estimate')`), not a separate top-level module — it shares Costing's sync layer (`yield-sync.js`) and saves its results as normal rows in the same `costings` table manual costing uses.

### Key globals

- `records` — HACCP today's records array (module-level var in haccp.js, also `window.records`)
- `settings` — HACCP settings (module-level var in haccp.js)
- `mSettings` — Menus settings (`window.mSettings`, set in menus.js)
- `window.Mise.profile` — user profile (chef_name, business_name, etc.)
- `window.Mise.sync` — sync functions (saveDay, loadAll, etc.)

---

## Testing

`node --test tests/*.test.js` — plain Node test runner, zero added dependencies. As of 2026-07-22: 9 files, 82 tests, covering allergen normalization, menu-dish resolution, sync merge/pull-decision logic, AI job-shape validation, API contract shape, the other-costs store, the Job Packet/allergen-conflict chain, prep-list course sorting, a static scanner (`onclick-handlers.test.js`) that checks every inline `onclick`/`onchange`/`oninput`/etc. in `app.html` resolves to a real function, and `api-security-regressions.test.js` (VQ-001/VQ-002 regression guards — see below).

No browser/DOM test runner is set up — anything touching live DOM rendering, IndexedDB, or a real Supabase session needs manual testing (or an ad hoc `vm.runInContext`-based script loading the real source files into a mocked `window`/`document`/`indexedDB`, as used to verify the sync retry queue during the 2026-07 critical-fixes pass — see PR #3's description for the pattern if you need to reuse it).

`tests/support/extract-source-fns.js` is the reusable version of that same pattern: it pulls named top-level function declarations verbatim out of a plain (non-module) source file like `haccp.js`/`prep.js` by exploiting this codebase's consistent style (top-level function bodies close with a `}` alone at column 0), so a test can `vm.runInContext` the *real* shipped function against mocked globals instead of reimplementing its logic. `tests/job-packet-allergen-conflict.test.js` uses it to protect the `dishIds → menu → job-menu snapshot → active HACCP job → allergen-conflict detection` chain (see Architecture Decisions.md — this is the Phase 0 compatibility contract the costing rebuild must not cross) without a full DOM harness. Extend this pattern rather than inventing a new one if more of haccp.js/menus.js needs characterizing this way.

`node --check <file>.js` for a quick syntax sanity check before committing.

---


## Prep Lists module — key facts

**File:** `js/modules/prep.js` (v9)
**Tab:** `tab-prep` inside `#module-menus`
**Storage:** Supabase `prep_lists` table only — no localStorage

### Supabase table: `prep_lists`
- `user_id UUID NOT NULL` — **no default, must be supplied explicitly** in every INSERT (get from `supabaseClient.auth.getSession()`)
- `venue_id` — auto-populated via `auth_venue_id()` trigger
- `name`, `date`, `menu_id` — string fields
- `items JSONB` — array of item objects (see below)

### Item object shape
```javascript
{
  id: 'pi_...',           // unique, generated client-side
  dish_id: String,
  dish_name: String,
  dish_category: String,  // e.g. 'Starter', 'Main' — used for course sorting
  description: String,
  section: 'prep_ahead' | 'finishing',
  completed: Boolean,
  completed_at: ISO string | null,
  completed_by: UUID | null
}
```

### Course sort order
`_COURSE_ORDER = ['Canapé','Starter','Fish course','Main','Side','Sauce','Pre-dessert','Dessert','Cheese','Petit four','Bread','Other']`

`_courseIndex(item)` resolves `dish_category` from the item itself, then falls back to `mSettings.savedDishes` for older items that predate the `dish_category` field.

### Key functions
- `renderPrepIndex()` — entry point; called by `showTab('prep')`
- `openPrepListView(id)` / `closePrepListView()` — switches index ↔ list view; shows/hides `menus-back-btn` for mobile header
- `_renderPrepListView(id)` — renders full list with ← back link (embedded in content, works on desktop sidebar layout too)
- `_renderPrepSection(items, label, listId)` — renders one section with dish sub-headings grouped by course
- `tickPrepItem(listId, itemId)` — optimistic tick/untick, syncs to Supabase
- `editPrepItem / savePrepItemEdit / cancelPrepItemEdit` — inline edit a step
- `deletePrepItem(listId, itemId)` — removes step, syncs
- `deletePrepList(id)` — deletes whole list from Supabase + cache
- `resetPrepListTicks(id)` — unchecks all items (for reuse on next service)
- `confirmGeneratePrepList()` — creates list from saved `dish.prep_tasks`
- `aiGeneratePrepList()` — generates tasks via `/api/parse-menu` (action: 'prep-tasks') for dishes without saved tasks
- `_prepItemInner(item, listId)` — shared inner HTML for a task row (tick circle, text, Edit/Del pill buttons)

### AI prep task generation
Uses `api/parse-menu.js` with `action: 'prep-tasks'`. This is a branch added to the existing menu-importer endpoint (Vercel 12-function cap). Model: `gpt-4o-mini`. Returns `{ tasks: [{ description, section }] }`.

### Back button
On **mobile**: `menus-back-btn` in the Menus module header is shown/hidden programmatically.
On **desktop** (sidebar layout): `menus-back-btn` is CSS-hidden, so `_renderPrepListView` embeds a `← All prep lists` button directly in the rendered HTML.

---

## AI Costing (AI Estimate screen) — key facts

**File:** `js/modules/ai-estimate.js`. **Backend:** `api/veriqo-estimate.js` (GPT-4o cost estimation, 3 modes: describe / multi-course / menu-photo-upload) + `api/veriqo-job.js` (job CRUD, reconciliation, quote price). Both verify the caller's Supabase session directly (`verifyUser()` fetches `${SUPABASE_URL}/auth/v1/user`) rather than trusting a client-supplied user id.

### Two-stage model
1. **AI job** (`costing_*` Postgres RPCs — `costing_insert_job`, `costing_get_ingredient_prices`, `costing_set_quoted_price`, `costing_list_jobs`) — the working/staging representation during estimation and reconciliation.
2. **Saved costing** — once a quote price is set, `_saveAsCosting()` mirrors the job into a normal row in the same `costings` table manual Costing entries use (`id: 'ai_' + job.id`, `source: 'ai-estimate'`, `aiJobId` for traceability) — so it shows up in the ordinary Costing list, not a second silo.

### "Other direct costs" draft
Stored client-side only (no `costings`/AI-job column for it) in `js/core/ai-other-costs-store.js`, keyed by **both** job id and the authenticated user id (`vq_ai_other_costs` in localStorage, nested `{[uid]: {[jobId]: poundsStr}}`) — never falls back to a shared/unscoped bucket. Cleared on logout (`auth.js`'s `_PRIVATE_KEYS`).

### Session/readiness gotcha — do not regress
`yield-sync.js` (the module that actually saves costings) is only initialized lazily — first Costing-module visit, or the first AI Estimate action (`_getToken()`/`_ensureYieldSyncReady()` in `ai-estimate.js` call `yieldSync.init()` if needed). Critically, **`yieldSync.isReady()` only proves it was initialized for *some* account** — after an in-place session change (no full logout+reload: token refresh, test-account switching), it stays wrongly `true` for the *previous* user. Always gate on `yieldSync.isReadyFor(uid)` (checks the exact uid matches), not `isReady()`, before trusting cached state for a specific user. `ai-estimate.js` re-resolves the live session uid before every action for this reason — don't "optimize" that away.

---

## Sync & offline queue architecture (`yield-sync.js`)

`yield-sync.js` (repo root — see the retired-files correction above) is Costing's Supabase sync layer: `saveCosting`, `saveQuote`, `saveInvoice`, `savePayment`, the `_pull*` functions, and the offline retry queue.

### Costing retry queue
Failed/not-ready `saveCosting()` calls persist into IndexedDB (`js/core/idb-queue.js`'s `getCosting`/`setCosting`, key `'costing-queue'`) rather than being silently dropped. Each queued entry is `{ userScope, table, payload, queuedAt }` — **`userScope` is mandatory and immutable**, resolved from the live Supabase session at queue time (never from the module's cached `_uid`, which can be stale). Flushing (`yieldSync.flushCostingQueue()`, called automatically from `init()`, the `online` event, and tab visibility change) only ever replays entries whose `userScope` matches the *currently authenticated* user — an entry from a different/previous account is left queued untouched, never replayed under the wrong owner, never silently discarded either. Entries with no `userScope` (can only be pre-2026-07 test artifacts) are dropped as unattributable.

`saveCosting()`'s return contract is explicit booleans — never infer success from `error` being falsy:
```js
{ synced: true,  queued: false, error: null }   // confirmed cloud write
{ synced: false, queued: true,  error }          // genuinely queued for retry (confirmed IDB persist)
{ synced: false, queued: false, error, queueError? } // could not sync AND could not even queue
```

### Pull vs. queue interaction
`_pullCostings()` merges the cloud result with anything still sitting in the retry queue (`js/core/pull-result.js`'s `mergeUnsyncedRecords()`) — a successful pull must never silently overwrite a costing that's saved locally but not yet confirmed on the server just because the server doesn't have it yet.

---

## HACCP module — key facts

### PC_TYPES
```javascript
var PC_TYPES = ['job','customers','kitchenassess','allergen','transport','mobileset','credentials','incident'];
```
These types use `renderSection_PC()`, NOT `renderSection()`. Getting this wrong silently skips log rendering.

### Save flow
1. `records.push({type, ...})` — add to in-memory array
2. `saveHaccpToday()` — write to localStorage + call `Mise.sync.saveDay(_today, records.slice())`
3. `renderSection_PC(type)` or `renderSection(type)` — update log list in current tab
4. `updateHaccpDashboard()` — update tile badges on home screen

### Settings lists
`settings.staff`, `settings.fridgeUnits`, `settings.suppliers`, `settings.cleaningTasks`, `settings.foodLibrary`

`foodLibrary` — HACCP-specific dish names. The food item datalist (`#food-library-list`) combines these with `mSettings.savedDishes` from the Menus module automatically via `populateHaccpSelects()`.

### Datalist
`<datalist id="food-library-list">` is used by: `cook-food`, `reheat-food`, `cool-food`, `tr-food`. Populated in `populateHaccpSelects()`.

---

## Known name collisions — do not reintroduce

| Function name | Defined in | Notes |
|---------------|-----------|-------|
| `logTransport()` | `menus.js` (line ~2047) | Menus module transport — saves to `mRecords`, used by Mise transport button in app.html |
| `_haccpLogTransport()` | `haccp.js` | HACCP transport — renamed from `logTransport` to avoid collision. `haccpLogTransport()` calls this. |
| `toast()` | `menus.js` | `toast(msg, type)` — `type` is a string (`'err'`/`'warn'`). |
| `_haccpToast()` | `haccp.js` | Renamed from `toast` 2026-07-21 — **had a live signature-mismatch bug**, not just a naming clash: haccp.js's original convention was `toast(msg, ok)` with `ok` a *boolean* (`false`→fail red). Because menus.js's string-based version was silently winning, every fail toast in HACCP (~100 call sites) rendered with the generic/neutral color instead of red — success and failure looked the same. Fixed by renaming and updating all internal call sites; verified `_haccpToast('x', false)` now renders `#A32D2D` again. |
| `fmtDate()` | `menus.js` | Short format: `21 Jul 2026`. |
| `_haccpFmtDate()` | `haccp.js` | Renamed from `fmtDate` 2026-07-21 — HACCP's own long format (`Tuesday, 21 July 2026`, via `toLocaleDateString` with `weekday:'long'`) was being silently replaced by menus.js's short format throughout HACCP (header date, day-block titles, log exports). Cosmetic, but real. |
| `getDayRecords()` | `menus.js` | Reads `localStorage['mise_'+date]` — Menus/job records. |
| `_haccpGetDayRecords()` | `haccp.js` | Renamed from `getDayRecords` 2026-07-21 — **the serious one**: HACCP's own version reads `localStorage['haccp_'+date]`. Because menus.js's version was silently winning, HACCP's "Previous days" view and its day/date-range log exports (text + PDF) were reading from the *Menus* localStorage namespace instead of HACCP's — wrong or empty compliance data for any past-day export, a real problem for EHO-inspection use. |
| `togglePastJobs()` | `menus.js` | Toggles `_pastJobsOpen` for the Menus > Jobs tab's own past-bookings list; wired to `#jobs-past-btn` in app.html. |
| `_costingTogglePastJobs()` | `costing.js` | Renamed from `togglePastJobs` 2026-07-21 — costing.js had its own identically-named toggle for the Costing module's own past-jobs list. Since costing.js loads after menus.js, its version was winning globally, so the Jobs tab's "View previous bookings" button silently did nothing (toggled unrelated Costing-module state instead). |
| `renderDishLibrary()` | `menus.js` | Renders Menus' own dish library into `#dish-library`, reading `mSettings`. |
| `_haccpRenderDishLibrary()` | `haccp.js` | Renamed from `renderDishLibrary` 2026-07-22 (VQ-007, security audit) — HACCP's own version targets `#dish-library-list` and reads `settings.savedDishes`. Since menus.js loads after haccp.js, its version was silently winning globally, so the HACCP Food Library tab's dish list never rendered or refreshed (wrong target element entirely) — a real, user-visible bug, not just latent risk. |

`menus.js` loads after `haccp.js` (and `costing.js` loads after both) in app.html. Any function defined in more than one of these files: **whichever module loads last silently wins** — the other module's calls to that name run the wrong implementation with no error, which is exactly how the five bugs above went undetected. Keep HACCP-specific functions prefixed with `_haccp`, Costing-specific ones prefixed with `_costing`, if they'd otherwise share a name with a menus.js (or another module's) function. Before adding any new top-level `function name(...)` to haccp.js or costing.js, grep the other module-level `js/modules/*.js` files for that exact name first.

---

## Recent fixes (do not revert)

### v33 — tr-by dropdown empty
`tr-by` and `ms-by` were missing from `populateHaccpSelects()`. Fixed by adding them. Chef profile name is prepended via `populateSelect()` for staff dropdowns.

### v34 — transport record not saving (two bugs)
1. `logTransport()` called `renderSection('transport')` which exits early for PC_TYPES. Fixed: `renderSection_PC('transport')`.
2. `_pullHaccpRecords()` (triggered on visibilitychange) wiped localStorage before `saveDay()` completed, losing the just-saved record. Fixed: snapshot local records before wipe; keep local if local count > remote count.

### v35 — localStorage errors swallowed
`catch(e){}` made failures invisible. Changed to show a visible toast and log to console. `saveDay()` now receives `records.slice()` snapshot to prevent in-flight mutations corrupting the Supabase payload.

### v36 — logTransport name collision (CRITICAL)
`menus.js` defines `logTransport()` for the Mise transport form and loads after `haccp.js`, overwriting the HACCP version. `haccpLogTransport()` was silently calling menus.js code (wrong DOM elements, wrong data store, "Transport record saved ✓" toast). Fixed: renamed haccp.js internal function to `_haccpLogTransport()`.

### v37 — chef name in transport dropdown
`populateHaccpSelects()` was called post-signin but `window.Mise.profile` loads async and may not be ready then. Fixed: call `populateHaccpSelects()` whenever any HACCP tab opens via `haccpTab()`.

### v71 — VQ-007: HACCP dish-library collision (haccp.js)
`renderDishLibrary()` was defined in both `haccp.js` and `menus.js` (see "Known name collisions" above) — menus.js's version, targeting `#dish-library` and reading `mSettings`, silently won globally since menus.js loads after haccp.js. The HACCP Food Library tab's dish list never rendered or refreshed. Renamed haccp.js's version to `_haccpRenderDishLibrary()` and updated all 6 internal call sites.

### 2026-07-22 — VQ-001/VQ-002 regression tests (tests/api-security-regressions.test.js)
Added 18 tests: 8 direct unit tests of `magic-link.js`'s `_safeRedirect()` (same-origin/relative pass, cross-origin/protocol-relative/`javascript:`/plain-http/empty all rejected — exported as `module.exports._safeRedirect` purely for this, doesn't change the Vercel handler contract), plus request-validation tests for both handlers (OPTIONS, method rejection, missing-auth 401, CORS origin) following the existing `api-contract.test.js` pattern — no live Supabase/Stripe/Resend call is reached. Also added a static source-scan regression guard asserting `stripe-connect.js` never reads `req.query.uid` again (the exact VQ-002 pattern), mirroring how `onclick-handlers.test.js` already statically scans `app.html`.

### 2026-07-22 — VQ-005/VQ-006: authenticate ai-scan.js, merge generate-bio.js into parse-menu.js (menus.js v37, costing.js v36, app.html)
VQ-005: `api/ai-scan.js` (label/receipt vision scanning, called from both Menus and Costing) had no auth check and no payload size cap — anyone who knew the URL could run up the OpenAI bill or send oversized images to burn serverless resources. Added the same `verifyUser()` session-check pattern as `api/parse-menu.js`/`api/veriqo-estimate.js`, scoped CORS off wildcard, and capped decoded image size the same way `veriqo-estimate.js`'s scan branch already does. Client call sites in `menus.js` (`handleScanLabel()`) and `costing.js` (receipt scan handler) now fetch the live session token and send it as a Bearer header, matching the pattern `menus.js` already used for its `parse-menu` magic-import call. True per-user/IP rate limiting was **not** added — there's no rate-limiting infrastructure anywhere in this codebase yet (`parse-menu.js`'s own comment already acknowledged this gap and relies on auth as the primary mitigation; `welcome-email.js` explicitly defers this to "infra level if needed"). Session auth closes the actual "anyone on the internet" exposure; a bespoke quota system would be new infra, not a fix to what's here.

VQ-006: the "Generate Bio" button in the One-Pager modal posted `{action:'bio'}` to `/api/parse-menu` with no Authorization header, to an endpoint that only ever implemented `prep-tasks` and menu-image parsing — so it always 404'd/failed for every user, first on missing-auth (once VQ-005-style auth landed elsewhere) then on "image required" once past that. Fixed by adding a real `bio` action branch to `parse-menu.js` (reusing the exact prompt/logic from the never-actually-called `api/generate-bio.js`) and sending the bearer token from `vqGenerateBio()` in `app.html`. `api/generate-bio.js` deleted — `api/team.js`'s own comment had already flagged this exact merge as the fix for Vercel's function-count cap.
`innerHTML` sites across Costing rendered user/cloud-controlled free text unescaped: costing job names, quote/invoice client names, quote notes, chef payment instructions, quote/invoice email compose fields (client email, business name, body preview), the accepted-quote picker dropdown, and the One-Pager PDF generator's business name/tagline/bio/why-us/chef-name/logo URL. Exploitable cross-account within a shared venue (RLS scopes quotes/invoices/costings to `venue_id`, so a malicious or compromised co-member's crafted client name/notes renders for every other venue member who opens that record), not just self-XSS.
- `costing.js`: added a module-level `_costingEsc()` (escapes `&`/`<`/`>`/`"`/`'`, safe for both text nodes and quoted attributes — prefixed per CLAUDE.md's collision-naming convention rather than reusing the ambiguous `esc` name menus.js/haccp.js each already have their own version of). Applied at every site above.
- `app.html`: added `_vqEsc()` (same escaping) and applied it in `vqGeneratePositioningPDF()` to `tagline`, `bio`, `why`, `bizName`, `chefName`, and `logoUrl` (the latter needed since it lands inside a `src="..."` attribute, not just text).
- Left untouched: the two pre-existing `esc()` helpers already local to `buildQuotePDF()`/other PDF exporters (they already escaped their own inputs correctly, just weren't reachable from the sites above); numeric-only fields (covers, prices); system-generated ids/dates/statuses.

### 2026-07-22 — VQ-003: quote portal tokens (api/get-quote.js, api/stripe-connect.js, costing.js v34, yield-sync.js v17)
The public `/pay` client portal was keyed on `quotes.id`, a client-generated `Date.now().toString()` — low-entropy and enumerable, so it doubled as the access credential for a client's financial/PII data. Added `quotes.portal_token` (16 random bytes, hex, unique, NOT NULL with a `gen_random_bytes` default — migration `20260722000000_quotes_add_portal_token.sql`, applied directly to prod and backfilled for the one pre-existing quote). `id` is untouched and still used for internal/authenticated linking (invoices.quote_id, job linking, editing).
- `costing.js`: new quotes generate `portal_token` client-side at creation (`_generatePortalToken()`, `crypto.getRandomValues`); `copyMagicLink()`/`showSendQuoteEmailPanel()` now build the `/pay?q=` link from `quote.portal_token` and refuse (with a toast) to fall back to the internal id if a legacy quote hasn't picked up its token yet.
- `yield-sync.js`: `saveQuote()` only sends `portal_token` on upsert when the client actually has one (never overwrites the DB value with null on edits of legacy quotes); `_pullQuotes()` now selects the DB column and overlays it onto `quote_data` so every pulled quote has a token even if it predates this fix.
- `api/get-quote.js` and `api/stripe-connect.js`'s `checkout` action now look up by `portal_token` instead of `id`. The `quoteId` field name on the wire is unchanged (still what `/pay` sends/echoes) — only the DB column backing it changed. `get-quote.js`'s response no longer echoes the internal `id`.

### 2026-07-22 — VQ-001/VQ-002 critical audit fixes (api/magic-link.js, api/stripe-connect.js, costing.js v33)
Full audit in `VERIQO_AUDIT_2026-07-22.md`. Two release-blocking findings fixed:
- **VQ-001 (open redirect → token leak):** `api/magic-link.js` accepted an unvalidated `redirectTo` and embedded the Supabase `token_hash` in it. Added `_safeRedirect()`, which only accepts URLs whose origin is exactly `https://getveriqo.co.uk`; anything else falls back to the app's own default URL. Also scoped `Access-Control-Allow-Origin` from `*` to `https://getveriqo.co.uk`. Deleted `api/auth-link.js`, `api/carte-magic-link.js`, `api/yield-magic-link.js` — unreferenced duplicates of the now-merged handler that carried the identical unvalidated-redirect bug and were still live/callable.
- **VQ-002 (Stripe Connect IDOR):** `api/stripe-connect.js`'s `onboard`/`refresh`/`dashboard` actions trusted a caller-supplied `uid` query param with no auth check, letting anyone who knew/guessed a UUID create/mutate a chef's Stripe Express account or obtain their Dashboard login link. Fixed: these three actions are now POST-only, require an `Authorization: Bearer <supabase access token>` header, and derive the uid exclusively from `verifyUser()` (same pattern as `api/veriqo-estimate.js`) — any client-sent uid is ignored. `handleCheckout` (client `/pay` portal) is intentionally unchanged/unauthenticated — it only accepts a `quoteId`. Client call sites in `costing.js` (`connectStripeAccount`, `refreshStripeStatus`, `openStripeDashboard`) updated to POST with the live session token instead of GET with `?uid=`; the now-dead `_yieldUid()` helper was removed.

Not yet fixed from the same audit (see `VERIQO_AUDIT_2026-07-22.md` for full list): VQ-008 duplicate banner-dismiss function, VQ-009 missing CSP/security headers, VQ-010 remaining auth/email rate-limit gaps, VQ-011 leaked provider error messages, VQ-012 remaining dead code (`api/create-checkout.js` stub, duplicate `yield-sync.js`), VQ-013 test-coverage gaps. VQ-003 through VQ-007 fixed 2026-07-22, see entries above.

### v67 — Security sweep round 4: final tidy (haccp.js)
`r.time` now wrapped with `esc()` in `renderSection()`, `refreshFilterPanel()`, and `buildDayBlock()`. `buildDayBlock()` typeLabels map extended to cover all PC_TYPES (job, kitchenassess, allergen, transport, mobileset, incident) with `|| t` fallback so unknown types show the type key rather than "undefined". Delivery photo: guard changed from truthy check to `/^data:image\//.test(r.photo)` so only genuine FileReader data URLs are accepted as img src.

### v66 — Security sweep round 3: daily record views (haccp.js)
`renderSuppliersLog()`: escape `s.name`, `s.products`, `s.contact`, `s.phone`, `s.approval`. `renderSection()`: escape `r.msg` in main log row; escape `r.startTime`, `r.endTime`, `r.method` in cooling extra row. `refreshFilterPanel()`: escape `r.msg`. `buildDayBlock()`: escape `r.msg` in archive record rows. Temperatures and `r.time` (system-generated via `todayTime()`) left unescaped as safe.

### v65 — Security sweep round 2 (haccp.js + sw.js)
`renderFoodLibraryTab()`: escape `d.dish`, `d.category`, `d.allergens`, and HACCP-only `item` names. Alert strip `sub` line: escape `r.msg`. Conflict banner in `updateHaccpDashboard()`: escape `g.name`, allergen names, and dish names before passing to `_renderAllergenConflictBanners()`. Same fix at `renderAllergenGuests()` line 4368 (allergen `a` and `dishMap[a]` values). `updateNextJobBanner()` njRow panel: escape `eventTime`, `jobType`, `covers`, `location` display text, `phone`/`email` display text + `encodeURIComponent` on their hrefs, `notes`, menu names, and dish chips. SW: added `./yield-sync.js` to `APP_SHELL` (was loaded in app.html but not pre-cached); bumped SW cache to `veriqo-v113`.

### v64 — Security sweep + a11y (haccp.js + app.html)
All stored HTML injection vulnerabilities patched. `recordLabel(r)` now applies `esc()` to all user-supplied raw values and is used as the single source of truth for record labels in `renderSection()`, `renderSection_PC()`, and `buildDayBlock()`. `renderChecklistLog()` escapes `r.by` and `r.unchecked` items. `renderSection_PC()` escapes all extra fields (allergens, severity, incidentTime, location, description, action, menu name, dietary prefs, conflict names). Allergen Brief modal escapes `jobType` and `covers`. `populateSelect()` and the food datalist now use DOM API (`createElement`) instead of innerHTML to eliminate attribute-context injection. Allergen Brief modal gains `role="dialog"` `aria-modal="true"` `aria-labelledby="allergen-brief-title"` (app.html); focus shifts to Close button on open and returns to the triggering element on close (`_allergenBriefOpener`). Escape key closes both Allergen Brief and Job Checklist modals.

### v63 — Allergen Brief modal
Tapping the active job banner or any allergen warning strip now opens a focused bottom sheet (`#allergen-brief-modal` / `_openAllergenBrief()`) instead of navigating to the full allergen tab. Shows: job header (client, date, type, covers); per-guest allergen tags with conflicting ones highlighted red and the offending dish named; "Dishes to watch" section (only dishes clashing with a guest); allergen records logged today with OK/Warning badges. "View full allergen log →" footer link to the full tab.

### v62 — allergen alert label/sub and covers label
Alert strip for allergen records now shows dish name as label (was "allergen") and allergen names in sub-line (was cryptic "2 allergens — Yes"). Next booking card: "4 guests" → "4 covers" to match active job banner.

### v61 — active job banner and alert strips tappable
Active job banner: tapping navigates to Allergen Brief; allergen guest count in bold; → arrow signals interactivity. Alert strips: all have `cursor:pointer` + onclick; allergen strips open Allergen Brief; other warning/fail strips open filter panel filtered to that status.

### v60 — sample day announce modal shows every refresh
Supabase settings sync wiped the local `settings` object on pull, resetting `sampleDayAnnounceShown` on every refresh. Fixed by storing the flag in plain localStorage (`vq_sampleDayAnnounceShown`) that sync cannot touch.

### v59 — wire HACCP checklist button + allergen conflict banners on load
`openJobHaccpChecklist()` implemented: event header, HACCP task checklist with tick/strikethrough if today's job, progress bar; wired to `#next-job-checklist-btn`. Fixed duplicate `display:none`/`display:flex` on button. `_checkJobConflictsOnLoad()` computes guest-dish conflicts on HACCP init so both conflict banners populate without needing to visit the allergen tab first.

### v58 — scope allergen conflicts to active job's guests only
`_getJobGuestsForConflict()` now returns only the active job's guests when a job is loaded (was merging with global `settings.allergenGuests`). Falls back to global guests when no job is active.

### v57 — Job Packet: link Menus jobs to HACCP (haccp.js v57 + menus.js v23)
Job becomes a "packet": client + menu + named guests with allergens. On the service day, HACCP auto-loads the job. Active job banner (`#active-job-banner`) shows client, covers, and guest counts. `_findJobForToday()` scans all `mise_*` localStorage keys for a job whose `eventDate === todayStr()`. Guests added via a new Guests section in the job edit form (name + allergen checkboxes). `renderAllergenGuests()` now merges job guests (shown in a separate "Today's job" section, read-only) with global guests. Conflict detection uses `_getJobGuestsForConflict()` and `_getJobDishAllergenMap()` so conflicts fire from both allergen log records and job menu dishes. All HACCP log functions use `_pushRecord()` helper which stamps `jobId` on every record. `sync.js` persists guests through Supabase `jobs.metadata`.

### v56 — actionable allergen conflict banners
Per-guest conflict box: structured per-allergen rows with dish names + "Confirm safe alternative" guidance + "View allergen log ↑" scroll button. Top-level banners now have per-context CTAs: allergen tab banner gets "Review guests ↓" (scrolls to guest list); home screen banner gets "View allergen log →" (navigates to allergen tab). Banner onclick guards against button click bubbling.

### v55 — 44px tap targets and aria-labels on icon-only buttons (haccp.js + menus.js v22)
`.btn-remove` in haccp.css and menus.css bumped to min 44×44px via `display:inline-flex`. Added `aria-label` to all generated `.btn-remove` buttons (Remove, Remove item, Delete menu, Delete credential). Fixed three inline-styled buttons: incident photo remove (20→28px), allergen guest × (inline→44px flex), allergen Edit/Delete pills (padding 3px→8px). Dish chip × converted from `<span>` to `<button type="button">`.

### v54 — escape user-entered values in settings list renderers
Added module-level `esc()` to haccp.js. Applied to `renderSettingsList`, `renderSettingsChecklistList`, and `renderChecklists` so staff names, checklist labels/notes render via `esc()` instead of raw innerHTML. Added `_esc()` to dashboard.js IIFE; applied to profile name in `_greeting`. Bumped dashboard.js to v6.

### v53 — fix kitchenassess log not updating after save
`logKitchenAssess()` was calling `renderSection('kitchenassess')` but `kitchenassess` is a PC_TYPE, so `renderSection()` exits early and the log silently fails to refresh. Fixed to `renderSection_PC('kitchenassess')`.

### v52 — sample day: more prominent links + one-time announce for existing users
- Both "See a sample day" entry points (shift-empty-state, starter checklist footer) upgraded from plain text links to outlined green buttons — more visible without competing with the primary CTA.
- `#sample-day-announce-modal` (app.html, inside `#module-haccp`) — a one-time centered modal nudging **established** accounts (starter checklist steps all done, so they'd otherwise never see a sample-day entry point) to try the feature. Triggered by `_maybeShowSampleDayAnnounce()`, called at the end of `updateHaccpDashboard()`. Shows once per account (`settings.sampleDayAnnounceShown`, synced setting — persists across devices/logins), never re-shown after being seen whether dismissed or clicked.
- `startSampleDayFromAnnounce()` closes the modal then calls `startSampleDay()`; `dismissSampleDayAnnounce()` just closes it.
- PostHog events added: `sample_day_announce_shown`, `sample_day_announce_clicked`, `sample_day_announce_dismissed`.

### v51 — sample day (demo mode) + starter checklist
- **Sample day:** `startSampleDay()` / `exitSampleDay()` in haccp.js. Swaps the global `records` var for `_buildDemoRecords()` (canned chef-shaped day: opening checks, 4 fridge temps, warn delivery, cooling, 2 cooks, cleaning — timestamps generated relative to now) and lets the normal renderers draw it, so the demo is pixel-identical to live data. `#demo-banner` (app.html, inside `#module-haccp` above `#tab-home`, so visible on every HACCP tab) shows while active.
- **Data-safety guards (do not remove):** `saveHaccpToday()` returns early when `_demoMode`; both `records` mutations in `_pullHaccpRecords()` (sync.js) are skipped when `window._haccpDemoMode` is true. Demo data must never reach localStorage or Supabase. Exit restores via `loadHaccpToday()`.
- **Starter checklist:** `renderStarterChecklist()` renders `#starter-checklist` (above `#shift-empty-state`, visible in both shift states), called at the end of `updateHaccpDashboard()`. Steps (opening / fridge / cooking record exists on any day) are **derived from data, never stored** — established accounts auto-hide it. `settings.starterDismissed` / `settings.starterCompleted` persist dismiss/completion. Entry points to demo: link in shift empty state + checklist footer.
- **PostHog events added:** `sample_day_started`, `sample_day_exited`, `setup_checklist_completed`, `setup_checklist_dismissed`.

### v50 — allergen conflict banner on HACCP home screen
- `#allergen-conflict-banner-home` div added above install banner on `#tab-home`.
- `_renderAllergenConflictBanners(conflictLines)` shared helper drives both the allergen-tab banner and the home-screen banner from one array. Replaces the inline banner update that was inside `renderAllergenGuests()`.
- `updateHaccpDashboard()` rebuilds the home banner on every dashboard refresh — so it stays current whenever records or guests change.
- Banner is collapsed by default ("⚠ ALLERGEN CONFLICT — N guest(s)"); tap "Show details" to expand with guest name, allergen, and dish. Uses `.acb-toggle` / `.acb-detail` class selectors inside the banner element (no duplicate IDs).

### v49 — toast overflow fix; conflict banner expandable
- Toast CSS: `white-space: nowrap` → `normal`; `max-width: min(90vw, 380px)` added so long conflict messages wrap instead of running off screen. Changed in `css/haccp.css` (bumped to `?v=3`).
- Conflict banner collapsed by default; tap to expand/collapse details.

### v48 — allergen checkboxes refresh on tab open; clearer form label
- `renderAllergenChecks()` now called from `haccpTab('allergen')` (in addition to `initPrivateChefMode`) so the dish allergen grid is always fresh.
- Form label explicitly states allergens must be ticked for conflict detection. **Critical UX note:** without the AI scan, users must manually tick allergen boxes before saving a dish record — if they don't, the record has no allergens and no conflict is detected.

### v46 — removed allergen label AI scanner
- `handleVeriqoScanLabel` removed from haccp.js; scan button and file input removed from `#tab-allergen`.
- Shared helpers `_normaliseAllergenForVeriqo`, `_veriqoReadFileAsDataUrl`, `_setMenuDishAllergenCheckboxes` retained — still used by `handleVeriqoMagicImport`.

### v45 — allergen log edit/delete + guest dietary requirements
- Edit/Delete buttons on each allergen log row. `editHaccpAllergen(recIdx)` pre-fills form; save button text changes to "Update allergen record". `deleteHaccpAllergen(recIdx)` splices record with confirmation.
- `_editingAllergenIdx` module-level var tracks edit state; reset to null on save or delete.
- New "Client dietary requirements" card in `#tab-allergen`: guest name + allergen tickboxes (`ga-*` IDs — avoids collision with dish form `al-*` and Menus form `al-a-*`).
- `addAllergenGuest()` / `deleteAllergenGuest(id)` persist to `settings.allergenGuests = [{id, name, allergens:[]}]`.
- `renderAllergenGuests()` shows a red conflict banner under each guest whose allergens appear in any today's allergen log record.
- `renderGuestAllergenChecks()` populates `#ga-allergen-checks`. Both called from `haccpTab('allergen')`.
- On save, conflict toast fires immediately if any guest is affected.

### v41 — restore allergen AI scanner in HACCP allergen log
`handleVeriqoScanLabel` retargeted from the deleted `tab-job` form (`menu-dish-name` / `mda-*` checkboxes) to the live `tab-allergen` form (`al-dish` / `al-*` checkboxes). "✨ Scan Label (Photo)" button and hidden file input restored to `#tab-allergen` in app.html. The backing JS and `/api/ai-scan` endpoint were always intact — only the HTML button was missing (accidentally deleted in commit `64e1578` as part of "remove module-picker dead code").

### v39 — configurable home screen tiles
- `TILE_DEFS` array defines all regular tiles (id, icon, label, subDefault, pc flag)
- `renderTileGrid()` builds `#haccp-tile-grid` dynamically from `settings.tileOrder` + `settings.enabledTiles`; wide fixed tiles (Records, Suppliers, EHO, Add more) are always appended at the end
- `renderCustomisePanel()` opens a full-screen sheet with ↑↓ reorder arrows and toggles; scroll position preserved across re-renders
- `moveTile(id, dir)`, `resetTileOrder()` — exposed to HTML onclick
- **Do not add new tiles as static HTML** — add to `TILE_DEFS` instead

### v38 — food library + menus integration
- Food library tile on HACCP home → `tab-foodlibrary` tab
- `settings.foodLibrary` for HACCP-only items; datalist also pulls from `mSettings.savedDishes`
- `cool-food` added to datalist
- `renderFoodLibraryTab()` renders both sources with link to Menus module

---

## Supabase

**Key tables:**
- `profiles` — `chef_name`, `business_name`, `subscription_status`, `subscription_plan`, `logo`, `starter_module`, `default_module`
- `haccp_records` — `(user_id, date)` unique, `records` JSONB array
- `kitchens` / `kitchen_members` — multi-venue (owner auto-created on signup)
- `clients`, `dishes`, `menus`, `menu_dishes`, `jobs`, `mise_records`, `quotes`, `costings`, `invoices`, `payments`
- Costing rebuild (additive, added 2026-07-21 — see Architecture Decisions.md): `ingredients`, `ingredient_supplier_aliases`, `ingredient_prices`, `dish_recipes`, `recipe_ingredients`, `job_cost_reconciliations`. All keyed off `dishes.id`/`jobs.id`, all RLS via the same `venue_rw` pattern. Backing JS is `js/modules/recipe-costing.js`.

**RLS on haccp_records:**
- INSERT/UPDATE require `venue_id = auth_venue_id()` (column default, auto-populated)
- Unique index: `(user_id, date)`

**Upsert pattern:**
```javascript
supabaseClient.from('haccp_records').upsert(
  { user_id: uid, date: dateStr, records: recordsArray },
  { onConflict: 'user_id,date' }
)
```

### RLS claims gotcha — JWT `venue_id`/`user_role` can go stale

A custom Auth Hook (`custom_access_token_hook`, Postgres function) bakes `venue_id` and `user_role` into every JWT **at the moment it's minted**, reading `profiles.venue_id`/`profiles.role` at that instant:
```sql
select venue_id, role into v_venue_id, v_role from public.profiles where id = (event->>'user_id')::uuid;
-- claims.venue_id = v_venue_id (or null); claims.user_role = coalesce(v_role, 'staff')
```
`auth_venue_id()`/`auth_user_role()`/`is_venue_manager()` all check the **JWT claim first**, live `profiles` row only as a fallback (`coalesce(jwt claim, profiles lookup, default)`). If a token is minted **before** `profiles.role`/`profiles.venue_id` are set — e.g. `auth.signUp()` mints the first session before `bootstrap_new_account()` has run — the claim gets baked in wrong (`user_role: 'staff'`, `venue_id: null`) and **does not self-correct** until the token's next natural refresh (up to ~1hr). Any RLS policy gating writes on `is_venue_manager()` (e.g. `costings`' `venue_manage` policy) silently rejects the account in the meantime, even though the database itself is correct.

**Fix in place:** `auth.js`'s `createProfile()` calls `supabaseClient.auth.refreshSession()` immediately after `bootstrap_new_account()` succeeds, forcing a fresh JWT mint against the now-correct profile. Applies to both first-time signup and `_ensureProfileExists()`'s self-heal path. **Do not remove this call** — without it, new accounts intermittently get RLS-blocked on their first writes with no obvious cause (looks like a permissions bug, but the database side is fine — it's the cached JWT that's wrong).

**Debugging an unexplained RLS 403/42501:** don't just check the `profiles` row — simulate the actual JWT via `set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true); set local role authenticated;` in a transaction (roll back after) to see whether a *clean* claim set passes. If it does, but the real user's browser still fails, the live session's cached claims are the suspect, not the RLS policy or the data.

---

## Subscription

| Plan | Access |
|------|--------|
| `null` / trial | All modules |
| `starter` | Dashboard + Settings + one module (`starter_module`) |
| `pro` | All modules |

`canAccess(moduleName)` in `js/core/subscription.js`.

Old plan names (`veriqo`, `suite`, `suite-all`, `carte`, `yield`) all normalised → `'pro'` by `stripe-webhook` v18.

---

## Resources / Blog system

Static content pages at `/resources/{slug}` → `/resources/{slug}.html` (already configured in vercel.json).

### Hub page
`resources.html` — lists all published articles as cards + coming-soon placeholders. Update this whenever a new article goes live (add a live card, remove or replace the coming-soon slot).

### Published articles
| Slug | Title | Date |
|---|---|---|
| `how-to-price-a-bespoke-dinner-party` | How to Price a Bespoke Private Dinner Party | 15 May 2026 |
| `do-private-chefs-need-haccp-uk` | Do Private Chefs Need HACCP in the UK? | 22 Jun 2026 |
| `what-eho-inspector-checks-private-chef` | What Does an EHO Inspector Actually Check? | 28 Jun 2026 |
| `private-chef-allergen-management-guide` | The Private Chef's Guide to Allergen Management | 4 Jul 2026 |
| `how-to-register-food-business-uk-private-chef` | How to Register as a Food Business in the UK | 13 Jul 2026 |

### Printable lead-magnet templates
| Slug | Description |
|---|---|
| `haccp-temperature-log` | A4 landscape HACCP temp log — 24 rows, 8 columns; `@media print` hides screen chrome |
| `allergen-matrix-template` | A4 landscape allergen matrix — 14 allergens × 20 dishes, printable checkboxes |

### Adding a new article
1. Copy `resources/do-private-chefs-need-haccp-uk.html` as the template
2. Update title, description, canonical URL, JSON-LD dates, breadcrumb, and body content
3. Add a live card to `resources.html` (copy an existing live card block; remove `coming-soon` class if replacing a placeholder)
4. Add the URL to `sitemap.xml`
5. No `vercel.json` changes needed — the existing wildcard rule covers all new files

---

## Vercel routing (`vercel.json`)

```
/app           → app.html
/veriqo        → veriqo-landing.html   (canonical tag points to "/" — see note below)
/haccp         → haccp.html
/menus         → menus.html
/costing       → costing.html
/prep-lists    → prep-lists.html
/resources     → resources.html
/resources/*   → resources/*.html
/mise          → 301 /app
/yield         → 301 /app
/carte         → 301 /app   (retired 2026-07-13 — was carte-landing.html)
/yield-info    → 301 /app   (retired 2026-07-13 — was yield-info.html)
/api/*         → api/*.js
```

**Do not re-add `/carte` or `/yield-info` as live pages.** Both were standalone marketing pages for the pre-unification Carte and Yield products (retired 2026-05-17), still showing the old £12/mo price and separate branding months after the merge. Retired to 301s on 2026-07-13. `carte-landing.html`, `yield-info.html`, `app-legacy.html`, and `mise-manifest.json` were deleted the same day — nothing routes to or links them.

`veriqo-landing.html` (`/veriqo`) is a near-duplicate of the homepage (same `<title>`, near-identical hero) with zero schema of its own. Rather than remove it, it now has `<link rel="canonical" href="https://getveriqo.co.uk/">` so it doesn't compete with `/` in search. It's excluded from `sitemap.xml` for the same reason — don't add it back.

---

## File layout

```
app.html                    ← unified shell
sw.js                       ← service worker (veriqo-v123)
sync.js                     ← cloud sync (Menus/HACCP/shared)
yield-sync.js               ← cloud sync (Costing/AI Estimate) — LIVE, see note above, do not confuse with js/core/yield-sync.js (dead)
auth.js                     ← auth (incl. account bootstrap + session-refresh fix)
js/
  core/
    subscription.js
    idb-queue.js             ← IDB queues: main sync queue + costing retry queue
    allergens.js              ← canonical 14-allergen list + normalizeAllergen()
    menu-dishes.js             ← resolveMenuDishes() shared dish-resolver
    pull-result.js            ← decidePullOutcome() + mergeUnsyncedRecords()
    gp-math.js                 ← priceForTargetGP() / gpForPrice()
    ai-job-shape.js            ← isValidJobShape() / sanitizePostJobActuals()
    ai-other-costs-store.js    ← AI Estimate's per-user, per-job "other costs" draft store
    yield-sync.js              ← DEAD, unreferenced duplicate — do not load or edit
  modules/
    haccp.js           (v69)
    menus.js           (v30)
    prep.js            (v9)
    costing.js         (v32)
    recipe-costing.js  (v3)   ← Costing rebuild Phases 2-4: recipe entry in dish editor, menu/job derived cost, actual-cost reconciliation. Supabase-only, no localStorage — same pattern as prep.js.
    ai-estimate.js  (v6)   ← AI Estimate screen, inside Costing module
    dashboard.js    (v6)
    intake.js       (v1)   ← intake form / event templates
    lead-scripts.js (v1)   ← sales script modal
    team.js         (v2)
css/
  tokens.css
  shell.css
  haccp.css
  menus.css
  costing.css
  dashboard.css
api/                        ← Vercel serverless functions (incl. veriqo-estimate.js, veriqo-job.js — AI Costing backend)
tests/                       ← node --test unit tests, see "Testing" below
supabase/migrations/         ← tracked migrations (partial history — see supabase/migrations/README_DRIFT.md)
veriqo-landing.html
index.html                  ← getveriqo.co.uk/ homepage — nav has module page links only (no scroll anchors)
haccp.html                  ← /haccp module landing page (SEO)
menus.html                  ← /menus module landing page (SEO)
costing.html                ← /costing module landing page (SEO)
prep-lists.html             ← /prep-lists module landing page (SEO)
```

**Retired files** still on disk (do not load or edit): `mise.html`, `yield.html`, `mise-sync.js`, various old manifests. They are not served.

**`yield-sync.js` (repo root) is LIVE, not retired** — despite older notes in this file, it's the Costing module's Supabase sync engine, loaded by `app.html` and actively maintained (retry queue, account-scoped writes, etc. — see "Sync & offline queue" below). Do not delete or ignore it.

**`js/core/yield-sync.js` (different file, same name, different folder) IS dead** — an earlier, unused duplicate `app.html` does not load. Do not confuse the two. If you need to check which one is live, grep `app.html` for the actual `<script src>` tag.

**Deleted 2026-07-13** (do not recreate): `carte-landing.html`, `yield-info.html`, `app-legacy.html`, `mise-manifest.json`. Fully removed, not just retired-in-place — nothing routes to or references them.

---

## Temperature thresholds (DEFAULT_THRESHOLDS in haccp.js)

| Check | Warn | Fail |
|---|---|---|
| Fridge | >5°C | >8°C |
| Freezer | >-18°C | >-15°C |
| Cooking/Reheat | <75°C | <75°C |
| Delivery/chilled | >5°C | >8°C |
| Transport cold | >5°C | >8°C |
| Transport hot | <70°C | <63°C |
| Transport frozen | >-18°C | >-15°C |

Fridge vs freezer detection is name-based: unit name must contain "freezer".
