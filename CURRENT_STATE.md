# Veriqo — Current State

> **Any AI agent (Claude, Codex, etc.) must read this file before making changes.**
> Update it as part of every PR.

---

## Live versions

| File | Version | Where set |
|------|---------|-----------|
| `js/modules/haccp.js` | `?v=37` | `app.html` script tag |
| `css/menus.css` | `?v=3` | `app.html` link tag |
| `sync.js` | `?v=19` | `app.html` script tag (no version bump needed — sync.js changes go live via SW network-first) |
| Service worker cache | `veriqo-v112` | `sw.js` line 8 |

**Rule:** Every change to `haccp.js` must bump the `?v=` query string in `app.html`. The SW cache name only needs bumping when `sw.js` itself changes (the SW uses network-first for all app shell assets so version bumps in JS query strings are sufficient).

> ⚠️ **BEFORE MAKING ANY CHANGES:** run `git pull origin main` first. This repo has multiple Claude Code sessions running (cloud + MacBook Air). Pushing stale code overwrites live fixes.

---

## Architecture — how deploys work

- **Repo:** `mogorman-a11y/mise` (GitHub, `main` branch)
- **Vercel projects:** `mise` and `files` — **both auto-deploy from the same repo on push to `main`**
- Live site: `getveriqo.co.uk` → served by the `files` Vercel project
- There is no separate staging environment. Changes to `main` go live immediately.

---

## What was last changed (June 2026)

### Transport temp record saving — v33/v34/v35 (DO NOT REVERT)
- **v33:** `populateHaccpSelects()` now includes `tr-by` and `ms-by` (were missing → dropdown was empty)
- **v34:** `logTransport()` was calling `renderSection('transport')` which exits early for PC_TYPES — changed to `renderSection_PC('transport')`. Also fixed race condition in `_pullHaccpRecords` (sync.js) where a visibility-change pull from Supabase could wipe localStorage before `saveDay()` finished.
- **v35:** `saveHaccpToday()` localStorage errors now show a visible toast (was silently swallowed). `saveDay()` receives `records.slice()` snapshot to prevent in-flight mutations corrupting the Supabase payload. Transport toast now shows in-memory count for diagnostics.

### Fridge/freezer temperature logging
- Added `toggleMinus()` and `enforceNeg()` functions (were called in HTML but never defined)
- Fixed freezer threshold bands: ≤ -18°C = OK, -18 to -15°C = Warning, > -15°C = Fail
- Added low-end fridge bounds: warn below 0°C, fail below -5°C (suggests unit is actually a freezer)
- Fridge/freezer detection is name-based: `unit.toLowerCase().includes('freezer')`

### Transport temperature logging  
- Added `trSetType()` function (was called in HTML but never defined)
- Added `haccpLogTransport()` alias (HTML called this; JS had `logTransport()`)
- Added **Frozen** food type button alongside Cold / Hot / Both
- Each type now validates against correct UK/EU thresholds:
  - Cold: warn >5°C, fail >8°C (Food Safety & Hygiene Regs)
  - Hot: warn <70°C, fail <63°C (must be held at 63°C+)
  - Frozen: warn >-18°C, fail >-15°C (EC 37/2005 transit tolerance)
  - Both: validates cold and hot fields independently

### Default thresholds (DEFAULT_THRESHOLDS in haccp.js ~line 171)
```
fridge-warn: 5,   fridge-fail: 8
freezer-warn: -18, freezer-fail: -15
frozen-warn: -18,  frozen-fail: -15
cooking/reheat-warn: 75, fail: 75
delivery/chilled-warn: 5, fail: 8
```

---

## Branch protection

`main` is protected — direct pushes are blocked. All changes must go via a pull request. This prevents any agent from silently overwriting the live codebase.

---

## Known limitations / future work

- Fridge vs freezer detection is name-based only (no stored unit type). Units must contain the word "freezer" in their name to be treated as a freezer.
- No staging environment — consider adding a `staging` branch wired to a Vercel preview URL before making significant changes.
