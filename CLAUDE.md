# Veriqo — Agent Instructions

> **Read this entire file before touching any code.**
> This is the only authoritative instruction file. CURRENT_STATE.md has been deleted — do not recreate it.

---

## ⚠ Critical rules

1. **Always `git pull origin main` before making any changes.** Multiple Claude Code sessions run against this repo (cloud + MacBook Air). Pushing stale code overwrites live fixes and breaks production.

2. **Source of truth is this GitHub repo** (`mogorman-a11y/mise`, `main` branch). Do NOT work from any local `files/` directory or use `vercel deploy --prod`. The old deploy chain is retired.

3. **Deploy chain:** push to `main` → Vercel auto-deploys → live at `getveriqo.co.uk`. No manual step.

4. **Bump `haccp.js` version on every change.** Update the `?v=N` query string in `app.html` each time `js/modules/haccp.js` is modified. Current version: **v40**. Do NOT bump `sw.js` cache name — the SW uses network-first so query string bumps are sufficient. **Every commit that touches haccp.js must bump the version — including bug fixes. Skipping this causes browsers to serve stale cached code.**

5. **Update this file** when versions change or architecture changes.

---

## Live versions

| File | Version | Where set |
|---|---|---|
| `js/modules/haccp.js` | `?v=42` | `app.html` script tag |
| `js/modules/menus.js` | `?v=21` | `app.html` |
| `js/modules/prep.js` | `?v=9` | `app.html` |
| `js/modules/dashboard.js` | `?v=5` | `app.html` |
| `sync.js` | — | no version param needed (SW network-first) |
| Service worker cache | `veriqo-v112` | `sw.js` line 8 |

---

## Architecture

- **Repo:** `mogorman-a11y/mise` on GitHub, `main` branch
- **Live site:** `getveriqo.co.uk/app` → served by Vercel, auto-deploy on push to `main`
- **Two Vercel projects** exist (`mise` and `files`) — both auto-deploy from the same repo on push to `main`. Do not manually deploy to either.
- **No staging** — changes go live immediately on push.
- **Supabase:** `https://yixrwyfodipfcbhjcszp.supabase.co`

### App structure

One unified PWA (`app.html`) with five modules: Dashboard, HACCP, Menus, Costing, Settings.

| Module | JS file | localStorage prefix |
|--------|---------|---------------------|
| HACCP  | `js/modules/haccp.js` | `haccp_` |
| Menus  | `js/modules/menus.js` | `mise_` |
| Prep Lists | `js/modules/prep.js` | — (Supabase only) |
| Costing | `js/modules/costing.js` | `yield_` |
| Dashboard | `js/modules/dashboard.js` | — |
| Sync   | `sync.js` | — |

### Key globals

- `records` — HACCP today's records array (module-level var in haccp.js, also `window.records`)
- `settings` — HACCP settings (module-level var in haccp.js)
- `mSettings` — Menus settings (`window.mSettings`, set in menus.js)
- `window.Mise.profile` — user profile (chef_name, business_name, etc.)
- `window.Mise.sync` — sync functions (saveDay, loadAll, etc.)

---

## ⚠ Deploy file copy — critical gotcha

When copying changed files to `/tmp/mise-deploy/` before committing, **always use `cp` with the explicit destination path**, not `rsync` with a directory target and multiple source files.

**Wrong (rsync drops subdirectory structure — files land at repo root):**
```bash
rsync -av file1.html js/modules/prep.js /tmp/mise-deploy/
# → copies prep.js to /tmp/mise-deploy/prep.js  ← WRONG
```

**Correct:**
```bash
cp path/to/file.html /tmp/mise-deploy/file.html
cp path/to/js/modules/prep.js /tmp/mise-deploy/js/modules/prep.js
```

Also note the git remote is named `github`, not `origin`:
```bash
git pull github main && git push github main
```

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

`menus.js` loads after `haccp.js` in app.html. Any function defined in both files: menus.js wins. Keep HACCP-specific functions prefixed with `_haccp` if they share names with menus functions.

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

## Vercel routing (`vercel.json`)

```
/app           → app.html
/veriqo        → veriqo-landing.html
/carte         → carte-landing.html
/yield-info    → yield-info.html
/resources     → resources.html
/mise          → 301 /app
/yield         → 301 /app
/api/*         → api/*.js
```

---

## File layout

```
app.html                    ← unified shell
sw.js                       ← service worker (veriqo-v112)
sync.js                     ← cloud sync
auth.js                     ← auth
js/
  core/
    subscription.js
    idb-queue.js
  modules/
    haccp.js   (v40)
    menus.js   (v18)
    prep.js    (v9)
    costing.js
    dashboard.js (v5)
    team.js
css/
  tokens.css
  shell.css
  haccp.css
  menus.css
  costing.css
  dashboard.css
api/                        ← Vercel serverless functions
veriqo-landing.html
index.html                  ← getveriqo.co.uk/ homepage — nav has module page links only (no scroll anchors)
haccp.html                  ← /haccp module landing page (SEO)
menus.html                  ← /menus module landing page (SEO)
costing.html                ← /costing module landing page (SEO)
prep-lists.html             ← /prep-lists module landing page (SEO)
```

**Retired files** still on disk (do not load or edit): `mise.html`, `yield.html`, `mise-sync.js`, `yield-sync.js`, various old manifests. They are not served.

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
