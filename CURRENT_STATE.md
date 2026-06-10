# Veriqo — Current State

> **Any AI agent (Claude, Codex, etc.) must read this file before making changes.**
> Update it as part of every PR.

---

## Live versions

| File | Version | Where set |
|------|---------|-----------|
| `js/modules/haccp.js` | `?v=29` | `app.html` script tag |
| Service worker cache | `veriqo-v33` | `sw.js` line 1 |

**Rule:** Every change to `haccp.js` must bump both the `?v=` query string in `app.html` AND the SW cache name in `sw.js`. If you forget either, users will get a stale cached file.

---

## Architecture — how deploys work

- **Repo:** `mogorman-a11y/mise` (GitHub, `main` branch)
- **Vercel projects:** `mise` and `files` — **both auto-deploy from the same repo on push to `main`**
- Live site: `getveriqo.co.uk` → served by the `files` Vercel project
- There is no separate staging environment. Changes to `main` go live immediately.

---

## What was last changed (June 2026)

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
