# SEO / AEO / Trust Implementation — Veriqo public site

Date: 2026-08-31
Scope: `getveriqo.co.uk` public marketing + resources (static HTML on Vercel).
Not touched: the authenticated app (`app.html` / `/app/*`), API functions, product behaviour, pricing, visual design.

---

## 1. Technical SEO audit (state before this pass)

### Stack / rendering
- **Framework:** none. Hand-authored static HTML, one file per page, inline `<style>` per page. Deployed by Vercel static build; `api/*.js` are Vercel Node functions.
- **Routing:** `vercel.json` legacy `routes` array (rewrites + 301s). Clean URLs already mapped (`/haccp` → `/haccp.html`, `/resources/*` → `/resources/*.html`, etc.).
- **Rendering model:** fully server-static HTML, no hydration for content. Good for crawl/LCP.
- **Metadata:** per-page `<title>`, `<meta description>`, `canonical`, Open Graph. Reasonably complete.
- **Structured data:** JSON-LD present on all product pages (`SoftwareApplication`, `FAQPage`, `BreadcrumbList`) and articles (`Article`, `BreadcrumbList`).
- **Sitemap:** `/sitemap.xml` hand-maintained.
- **Robots:** `/robots.txt` — `Allow: /` + sitemap line only.
- **`/llms.txt`:** present (good for AEO).
- **Analytics:** GTM/PostHog/GA wired in `app.html`; marketing pages carry little/no analytics.
- **Security headers:** `middleware.js` (Edge) sets `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`; CSP in Report-Only.

### Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| C1 | **Critical** | `haccp.html` FAQ stated *"cooked food must reach at least 75°C"* as an absolute legal fact. UK FSA recognises equivalent time/temperature combinations (70°C/2 min, 75°C/30 s, 80°C/6 s). | **Fixed** — reworded as a Veriqo operating default + FSA equivalents, with source link. |
| C2 | **Critical** | Homepage + `/veriqo` trust bar: *"UK Food Safety Act compliant"* (implies certification). | **Fixed** → "Built around UK food-safety law". |
| C3 | **Critical** | Homepage + `/veriqo` module copy: *"Every compliance record you're legally required to keep"*. | **Fixed** → "The everyday food-safety records private chefs need to demonstrate due diligence". |
| C4 | **Critical** | Homepage/`/veriqo` HACCP mock: *"72°C — must reach 75°C minimum"*. | **Fixed** → "72°C — below 75°C check". |
| C5 | **Critical** | Articles presented `75°C` as *the* legal number for England/Wales/NI. | **Fixed** — softened to "common industry target" + FSA equivalents + recommended-vs-legal fridge distinction (5°C target vs 8°C legal max). |
| H1 | High | Entity inconsistency: schema/OG/footers used **"Mise Labs"** (a retired umbrella name); `llms.txt` said "Side Order Catering"; footer said "a Mise Labs product". Confuses AI/entity resolution. | **Fixed** — single entity: **Veriqo**, `legalName` **Side Order Catering Ltd**, founder Michael O'Gorman. Applied across all JSON-LD, footers, `llms.txt`. |
| H2 | High | Homepage `<title>` = "Veriqo — Kitchen management for private chefs" — no primary commercial keyword. | **Fixed** → "Private Chef Software UK \| HACCP, Menus & Costing \| Veriqo". |
| H3 | High | Homepage hero eyebrow "Kitchen management · UK private chefs" — search intent not stated near hero. | **Fixed** → eyebrow "Private chef business software"; hero sub rewritten to name HACCP, bookings, menus, costing, quotes, payments + "one connected app built for UK private chefs". H1 "Three questions. One answer." **retained**. |
| H4 | High | No `Organization` schema anywhere; `SoftwareApplication` had a single `Offer` and wrong publisher. | **Fixed** — added `Organization` (`@id` `#organization`), rebuilt `SoftwareApplication` with Starter + Pro offers, `provider`/`publisher` referencing the Organization. |
| H5 | High | Article `author` = `Organization "Mise Labs"`; resources hub said "written by the team behind Veriqo". No author E-E-A-T. | **Fixed** — `author` = `Person` Michael O'Gorman (MIH), links to new `/about/michael-ogorman`; visible bylines added; `dateModified` bumped. |
| H6 | High | No About / author / contact pages. `/app` was in the sitemap. | **Fixed** — created `/about`, `/about/michael-ogorman`, `/contact`; removed `/app` from sitemap. |
| H7 | High | `robots.txt` had no explicit position for Googlebot/Bingbot or AI crawlers; no `Disallow` for `/api/`. | **Fixed** — explicit `Googlebot`/`Bingbot` allow, documented AI-crawler allow decision, `Disallow: /api/`. `/app` deliberately left crawlable so its `noindex` is seen. |
| M1 | Medium | No Twitter/X card tags on any page. | **Fixed** — `summary_large_image` + title/description/image on homepage, all product pages, resources hub, new pages. |
| M2 | Medium | Product pages had no OG image / `og:site_name`. | **Fixed**. |
| M3 | Medium | `resources.html` had `lang="en"`, title/OG "Mise Labs". `how-to-price` article `lang="en"`, title "Mise Labs Resources". | **Fixed** → `en-GB`, Veriqo, keyword-led titles. |
| M4 | Medium | Thin internal linking between product ↔ resources. | **Fixed** — "Related guides" sections on `/haccp`, `/menus`, `/costing`, `/prep-lists` with descriptive anchors; About/Contact added to footers; article footers link to the author page. |
| M5 | Medium | Customer-facing infra language: `prep-lists.html` "ticks sync to Supabase", "Changes sync to Supabase". | **Fixed** → "sync securely across your devices". |
| M6 | Medium | `Article` JSON-LD had no `image`. | **Fixed** — `image` added to the 5 guides. |
| M7 | Medium | Homepage nav logo `href="#"` (not crawlable to `/`). | **Fixed** → `href="/"` + `aria-label`. |
| M8 | Medium | `/veriqo` (`veriqo-landing.html`) is a deliberate near-duplicate of `/` — had `canonical` to `/` but no `noindex`, and no meta description. | **Fixed** — added `noindex, follow` + description. |
| L1 | Low | Google Fonts stylesheet is render-blocking (multiple weights). `display=swap` already set. | **Not changed** — see recommendations (risk of brand shift / FOUT). |
| L2 | Low | No `Privacy Policy` / `Terms` / `Cookie Policy` pages. | **Not created** — needs legal review, must not be fabricated. See §4 external actions. |
| L3 | Low | Marketing pages have no analytics; can't measure SEO landing performance. | **Not changed** — see recommendations. |
| L4 | Low | No testimonial/social-proof component and no genuine testimonials to show. | **Not changed** — reusable snippet provided in §5; nothing invented. |
| L5 | Low | `veriqo.co.uk` apex → `getveriqo.co.uk` 301 not confirmed. | **External** — registrar/Vercel domain config, not application code. See §4. |

---

## 2. Changes made (file by file)

### Global (script-applied across served marketing + `resources/*.html`)
- JSON-LD `"name": "Mise Labs"` → `"Veriqo"` (publisher/author organisations).
- Article `author` Organization → `Person` **Michael O'Gorman**, `jobTitle` "Professional chef and founder of Veriqo", `url` `/about/michael-ogorman`.
- Footer brand line "Veriqo — a Mise Labs product by Side Order Catering" → "Veriqo — private chef business software by Side Order Catering Ltd".
- Resources hub: "written by the team behind Veriqo" → chef-authored attribution.

### `index.html`
- `<title>`, `<meta description>` → commercial, keyword-led (see H2).
- OG title/description rewritten; added `og:site_name`, `og:image` retained; added Twitter card block.
- Added **`Organization`** JSON-LD (`@id` `#organization`, `legalName` Side Order Catering Ltd, founder, `areaServed` GB, `sameAs`).
- Rebuilt **`SoftwareApplication`** JSON-LD: Starter (£7) + Pro (£15) `offers`, `publisher`/`provider` → `#organization`, canonical entity description. `WebSite` node linked to `#organization`.
- Hero eyebrow → "Private chef business software"; hero sub rewritten (HACCP, bookings, menus, costing, quotes, payments — one connected app for UK private chefs). **H1 unchanged.**
- Trust bar "UK Food Safety Act compliant" → "Built around UK food-safety law".
- HACCP module tag softened (due-diligence framing).
- HACCP mock alert "must reach 75°C minimum" → "below 75°C check".
- Nav logo `href="#"` → `href="/"`, `aria-label` added, decorative SVG `aria-hidden`.
- Footer nav: removed `/veriqo` "Features" link, added `/resources`, `/about`, `/contact`.

### `haccp.html`
- Added `og:image`, `og:site_name`, Twitter card block.
- FAQ "What temperature thresholds does Veriqo use?" fully reworded: fridge 5°C target vs 8°C legal max; 75°C described as an **operational check**, not the only lawful option; lists FSA-recognised equivalents; links `food.gov.uk` SFBB.
- Trust bar: "UK FSA temperature thresholds built in" → "Default thresholds based on UK FSA guidance"; "GDPR compliant" → "GDPR-aligned".
- New **"Related guides"** section (6 descriptive internal links) before the footer.
- Footer nav: added `/about`, `/contact`.

### `menus.html`, `costing.html`, `prep-lists.html`
- `<title>` aligned to the commercial targets:
  - Menus → "Private Chef Booking & Menu Software | Veriqo"
  - Costing → "Private Chef Costing, Quotes & Invoices | Veriqo"
  - Prep Lists → "Private Chef Prep List App | Veriqo"
- Added `og:image`, `og:site_name`, matching `og:title`, Twitter card block.
- New **"Related guides"** section with descriptive cross-links (product ↔ product, product → guides).
- Footer nav: added `/about`, `/contact`.
- `prep-lists.html`: removed two "sync to Supabase" phrases from feature copy.

### `resources.html`
- `lang="en-GB"`; title → "Private Chef Business & Food Safety Guides | Veriqo"; OG + Twitter updated; `og:site_name` → Veriqo; OG image → `og-image.png`.
- Hub intro now attributes guides to Michael O'Gorman (links `/about/michael-ogorman`).
- Footer nav: added `/about`, `/contact`.

### `resources/*.html` (7 files)
- Entity + author fixes (global, above).
- 5 guides: visible byline "By Michael O'Gorman, MIH · professional chef and founder of Veriqo … Updated 31 Aug 2026"; `dateModified` → 2026-08-31; `image` added to `Article` JSON-LD.
- `do-private-chefs-need-haccp-uk.html`, `what-eho-inspector-checks-private-chef.html`: cooking-temperature and fridge/cooling lines reworded for legal accuracy (target vs legal maximum, FSA equivalents).
- `how-to-price-a-bespoke-dinner-party.html`: `lang="en-GB"`; title/logo/byline de-"Mise Labs".
- Article footers link to `/about/michael-ogorman`.

### `veriqo-landing.html` (`/veriqo`)
- Added `<meta name="robots" content="noindex, follow">` and a meta description.
- Softened the same absolute claims / mock as the homepage.

### New pages
- **`about.html`** (`/about`) — "Built by a chef, because the existing tools didn't fit". Why Veriqo exists, provenance (Side Order Catering Ltd), design principles, company details table. `AboutPage` + `Organization` + `BreadcrumbList` JSON-LD.
- **`about/michael-ogorman.html`** (`/about/michael-ogorman`) — compact author/founder page. `ProfilePage` + `Person` (`knowsAbout`, `worksFor` → `#organization`) + `BreadcrumbList`. Lists the guides he's authored.
- **`contact.html`** (`/contact`) — contact routes + company identity table. `ContactPage` + `Organization`/`ContactPoint` + `BreadcrumbList`.

### `robots.txt`
Rewritten: explicit `Googlebot` / `Bingbot` allow; `User-agent: *` allow with `Disallow: /api/`; documented **AI-crawler = ALLOWED** decision (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended, Applebot-Extended); sitemap line retained. `/app` intentionally **not** disallowed (it carries `noindex, follow`).

### `sitemap.xml`
- Removed `/app` (app shell, `noindex`).
- Added `/about`, `/about/michael-ogorman`, `/contact`.
- Refreshed `lastmod` on all touched pages to 2026-08-31; realistic `changefreq`/`priority`.

### `vercel.json`
- Added rewrites: `/about` → `/about.html`, `/about/(.*)` → `/about/$1.html`, `/contact` → `/contact.html`.

### `llms.txt`
- Canonical entity description ("Veriqo is UK private-chef business software combining HACCP records, bookings, menus, costing, quotes, invoices, payments and prep lists").
- Operator = Side Order Catering Ltd; founder/author = Michael O'Gorman, MIH (with URL).
- Added About / Contact URLs; Prep Lists module; Stripe payments in Costing.
- Softened "designed to meet the record-keeping requirements of the Food Safety Act 1990" → "designed around UK food-safety requirements … not a certification and does not guarantee compliance on its own".

---

## 3. Verification performed

- `node --test tests/*.test.js` → **82 pass / 0 fail** (unchanged; no JS touched).
- All 33 JSON-LD blocks across public pages `JSON.parse`-valid.
- `sitemap.xml` well-formed XML; `vercel.json` valid JSON.
- Internal root-relative link integrity check across all public pages + new pages → **all resolve** (against files + `vercel.json` routes).
- Rough HTML tag-balance check on every edited/new page → balanced.

### Recommended post-deploy checks

**Google Search Console**
- Submit `https://getveriqo.co.uk/sitemap.xml`; confirm 15 URLs discovered, 0 errors.
- URL Inspection on `/`, `/haccp`, `/costing`, `/about`, `/about/michael-ogorman`, `/resources/do-private-chefs-need-haccp-uk` — confirm "Indexing allowed", correct canonical, rendered content.
- Rich Results / Schema Markup Validator (`validator.schema.org`) on `/` (Organization + SoftwareApplication), `/haccp` (FAQPage + Breadcrumb), one guide (Article + Breadcrumb).
- Removals: confirm `/app` drops out of the index over time (it's `noindex`).
- Page Indexing report: watch for "Duplicate without user-selected canonical" on `/veriqo` (should resolve to `/`).
- Performance report after ~28 days: track impressions/clicks for "private chef software", "private chef app", "HACCP app for private chefs", "private chef costing".

**Bing Webmaster Tools**
- Add/verify the site; submit the sitemap.
- URL Inspection + "Mark as indexed" for the priority pages.
- SEO Reports: check for missing meta description / duplicate title warnings (should be clean).
- Confirm Bingbot is not blocked (robots.txt tester).

**Both**
- Re-run after adding Privacy/Terms/Cookie pages (see §4) and add them to the sitemap + footers.

---

## 4. Items requiring external / owner action (not code)

1. **Privacy Policy, Terms of Service, Cookie Policy pages.** Do not exist. Not fabricated here — these need real legal wording (data controller = Side Order Catering Ltd, the third-party processors actually in use for hosting / database / payments / email / analytics, lawful basis, retention, cookie categories, ICO registration number). Once drafted: add as `/privacy`, `/terms`, `/cookies`, wire into every footer, add to `sitemap.xml`, add `vercel.json` rewrites.
2. **`veriqo.co.uk` → `getveriqo.co.uk` 301.** If the apex `veriqo.co.uk` is owned, add it to the Vercel project and set a permanent redirect to `https://getveriqo.co.uk`. If not owned, no action. (`www.getveriqo.co.uk` → apex is already configured per repo docs.)
3. **Google Business Profile / knowledge panel:** create/claim an entity for "Veriqo" (software company, UK) and link `sameAs` to it from the Organization schema once live.
4. **Company registration details:** if desired for trust, add Companies House number + registered office to `/about` and `/contact` (Side Order Catering Ltd).
5. **Real testimonials:** collect 3–5 with named chef + business + permission. Until then no social proof is shown (nothing invented).
6. **OG image quality:** `icons/og-image.png` is 1200-wide-ish brand card; verify it renders well in the X/LinkedIn/Slack unfurl and is < 1MB. Consider per-section OG images later.
7. **Analytics on marketing pages:** decide whether to add GTM/PostHog to the public pages (currently app-only) so SEO landing → trial conversion is measurable. Needs a cookie banner + the Cookie Policy above first.
8. **Search Console + Bing Webmaster** property verification (DNS TXT or file) if not already done.

---

## 5. Content backlog (prioritised)

Ranking key: **Intent** (I: transactional 5 → informational 1), **Commercial value** (C), **Topical authority** (A), **Difficulty** (D: 5 = hard), **Conversion proximity** (P: how directly it feeds a product). Score ≈ I + C + A + P − D.

### Tier 1 — do first (high intent, close to conversion)

| Piece | Type | Target query | I | C | A | D | P | Notes |
|---|---|---|---|---|---|---|---|---|
| Improve `/haccp` further: add "HACCP app for private chefs" H2 block + comparison-to-paper table | On-page | private chef HACCP app / HACCP app UK | 5 | 5 | 4 | 2 | 5 | Page exists; deepen, don't duplicate. |
| **Private Chef Pricing Calculator** (`/tools/private-chef-pricing-calculator`) | Free tool | chef costing calculator / private chef pricing calculator | 4 | 5 | 5 | 3 | 5 | Spec in §6. Feeds `/costing`. |
| **Food Temperature Guide UK** (`/tools/food-temperature-guide-uk` or `/resources/cooking-temperature-guide-uk`) | Reference tool | cooking temperature guide UK / fridge temperature guide | 3 | 3 | 5 | 3 | 4 | Spec in §6. Feeds `/haccp`. High link magnet. |
| How much should a private chef charge (UK)? | Guide | how much should a private chef charge | 3 | 5 | 5 | 3 | 5 | Pillar for the pricing cluster → `/costing` + calculator. |
| Best software for private chefs (UK) | Comparison | best software for private chefs uk | 4 | 5 | 4 | 3 | 5 | Fair, factual; category page, not a doorway. |
| Digital HACCP vs paper records | Comparison | digital haccp vs paper / paper SFBB | 3 | 4 | 5 | 2 | 5 | Strong for `/haccp`. |

### Tier 2 — HACCP / food-safety cluster (topical authority, feeds `/haccp`)

- HACCP checklist for private chefs (+ downloadable) — **high**, link magnet.
- Private chef temperature logs (what to record, how often) → links calculator/guide.
- Cooking Temperature Guide UK (full article version of the tool).
- Fridge Temperature Guide for UK food businesses (5°C target vs 8°C legal max — get this authoritative).
- How long should HACCP records be kept?
- Food allergen records for private chefs (expand existing).
- Transporting food safely to private chef bookings (unique angle — Veriqo has transport logs).
- Food safety in client kitchens / temporary kitchen HACCP / outdoor & private event food safety.
- Private chef food hygiene ratings (FHRS for mobile/private chefs).
- What happens during an EHO inspection for a private chef (expand existing).

### Tier 3 — Pricing & profit cluster (feeds `/costing` + calculator)

- Private chef food cost percentage (what's normal).
- How to price private dining / per-head pricing.
- Private chef profit margin — benchmarks.
- Private chef deposit & cancellation policy (+ template).
- Private chef quote template / private chef invoice template (templated lead magnets → `/costing`).

### Tier 4 — Running the business / operations

- How to get your first 5 private chef clients (already a "coming soon" slot).
- Sole trader vs limited company for private chefs.
- Private chef insurance (public liability, etc.).
- Private chef contracts & T&Cs with clients.
- Prep list / mise en place systems for private chefs (feeds `/prep-lists`).
- Menu planning & dish library workflow (feeds `/menus`).

### Tier 5 — Comparison / consideration

- Veriqo vs spreadsheets for private chef costing.
- Veriqo vs paper SFBB.
- Best HACCP apps for private chefs UK (round-up, fair).

### Topic hubs (structure, not thin pages)

Group `/resources` and add real hub pages **only when each has ≥4 genuine articles + a useful summary**:
`/resources/food-safety`, `/resources/pricing-and-profit`, `/resources/running-your-business`, `/resources/private-chef-operations`.
Each hub: 150–250-word intro that actually orients the reader, curated links, link up to `/resources` and across to the relevant product page. Add `CollectionPage` + `BreadcrumbList` schema. Interlink articles within a hub.

### Future commercial landing pages

`/private-chef-software`, `/private-chef-haccp-app`, `/private-chef-booking-software`, `/private-chef-costing-software` — **only build if genuinely differentiated**. Current recommendation: the homepage already targets "private chef software" and `/haccp`, `/menus`, `/costing` cover the rest. Improve those first. Revisit if GSC shows the homepage stuck on page 2 for "private chef software" after 3 months.

### Data / authority (later)

Once there's enough anonymised aggregate data: "UK private chef pricing report", "average food cost % for private dining", "most common allergens booked" — annual, gated-optional, with a methodology note. Only aggregate, never per-user or commercially sensitive. Needs privacy controls + consent in place first.

---

## 6. Free-tool roadmap (implementation-ready specs)

Both are static, self-contained HTML (matches the site pattern), no backend, no PII collected. Suggested location `/tools/…` (add `{ "src": "/tools/(.*)", "dest": "/tools/$1.html" }` to `vercel.json`, plus each to the sitemap).

### 6.1 Private Chef Pricing Calculator — `/tools/private-chef-pricing-calculator`

**Inputs** (all client-side, no submit):
- Number of covers
- Ingredient cost (total £, or £/cover)
- Prep hours + service hours
- Your target hourly rate (£)
- Travel (£)
- Additional staff (£)
- Target food-cost % *or* target margin %

**Outputs:**
- Suggested total selling price
- Suggested per-head price
- Food-cost % achieved
- Contribution (£) after ingredients + direct costs
- Effective hourly rate (contribution ÷ (prep + service) hours)
- A plain-English sentence: "At £X/head you're running an N% food cost and an effective £Y/hour."

**Method (documented on the page):** total price = max(ingredient-cost ÷ target-food-cost-%, (labour + travel + staff + ingredients) ÷ (1 − target-margin)). Show both routes; let the chef pick.

**Copy rules:** no "guaranteed profit" claims; call it a guide/estimate. Link to `/resources/how-to-price-a-bespoke-dinner-party` and the future "how much should a private chef charge" pillar.

**CTA:** "Want this calculated automatically for every booking, with real ingredient prices and your job history? → [Veriqo Costing](/costing)".

**Schema:** `WebApplication` (`applicationCategory: FinanceApplication`, `isAccessibleForFree: true`, `provider` → `#organization`) + `BreadcrumbList` + a short `FAQPage` ("How do private chefs price a job?", "What food cost % should a private chef aim for?").

**Build note:** ~1 self-contained file, vanilla JS, `<output>` elements, no dependencies. Safe to build now.

### 6.2 Food Temperature Guide UK — `/tools/food-temperature-guide-uk`

**Sections (tabs or anchored blocks):** poultry & meat cooking · reheating · cooling · fridge storage · freezer storage · hot holding · transport (chilled / hot / frozen).

**For each row, three clearly-labelled columns:**
1. **Law** — the statutory position (e.g. cold-holding max 8°C in England/Wales/NI; hot-holding min 63°C). Cite `legislation.gov.uk` / `food.gov.uk`.
2. **FSA guidance** — recommended practice (e.g. chilled 5°C or below; cook to 70°C/2 min or equivalent).
3. **Veriqo default** — the app's operating threshold (e.g. cooking check 75°C; fridge warn >5°C / fail >8°C) — explicitly labelled "Veriqo operating default, adjustable in Settings".

**Must include** a prominent note: *"This is a guide, not legal advice. Where the law and a recommended target differ, the guide shows both. Check the primary sources linked for each figure."*

**Sources block:** `food.gov.uk`, `gov.uk`, `legislation.gov.uk`, Food Standards Scotland — no third-party food-safety blogs.

**Schema:** `Article` + `FAQPage` (only for questions genuinely answered on-page) + `BreadcrumbList`. Consider a `Table`-structured section for the fridge/cooking figures.

**CTA:** "Log these checks in seconds and export EHO-ready records → [Veriqo HACCP](/haccp)".

**Build note:** static content page; the accuracy of every number must be reviewed against primary sources before publishing. Draft, don't ship unreviewed.

---

## 7. Internal-linking model (implemented + to extend)

- HACCP / food-safety articles → **`/haccp`** (anchor: "private chef HACCP app", "digital food safety records", "digital temperature records").
- Pricing / costing articles → **`/costing`** (anchor: "private chef costing software", "costing, quotes and invoices").
- Menu / booking / workflow content → **`/menus`** (anchor: "private chef booking & menu software").
- Prep / mise workflow content → **`/prep-lists`** (anchor: "automatic prep lists").
- Every product page → 4–6 "Related guides" with descriptive anchors (done).
- Every article → author page + `/resources` + one product page (done for the 5 guides).
- Avoid "click here" / bare "learn more".
- When hubs exist: article → its hub → `/resources`; hub → relevant product page.

---

## 8. Constraints honoured

No site redesign; no functionality removed; no product/pricing/behaviour change; no fake testimonials, customer counts, ratings or certifications; no keyword-stuffed or thin AI pages; no private/app routes exposed; no auth weakened; no spammy or duplicated schema; niche (UK private chefs) retained and reinforced.

---

## PRE_MERGE_REVIEW (2026-08-31)

Second pass over the change set above, reviewed as (1) senior technical SEO and (2) senior web engineer pre-merge. Overall: the implementation was sound; the issues below were real but small. All were fixed in this pass except where marked external.

### Issues found & fixed

| # | Category | Issue | Fix |
|---|----------|-------|-----|
| R1 | Food-safety wording | "Built around UK food-safety law" (homepage + `/veriqo` trust chip) could be read as implying certification or guaranteed legal compliance. | → **"Designed around UK food-safety requirements"**. Matches the hedged wording already used in `llms.txt` / `/about` ("…not a certification and does not guarantee compliance on its own"). |
| R2 | Conflicting index signals | `veriqo-landing.html` (`/veriqo`) had **both** `rel=canonical → /` **and** the `noindex, follow` I added in pass 1 — contradictory signals (Google's guidance: use one or the other for a duplicate). It also contradicted the documented intent in `CLAUDE.md` (canonical-only). | Removed the `noindex`. Page keeps `canonical → /` (+ the new meta description, which is harmless). `/veriqo` is now orphaned from site nav (only its own footer links to it). Stronger option — a 301 — is listed under external actions. |
| R3 | `robots.txt` semantics | Named groups (`Googlebot`, `Bingbot`, and every AI bot) did **not** inherit `Disallow: /api/` from `User-agent: *` — robots groups are not additive, a crawler obeys only its single most-specific group. So those bots were in effect permitted to crawl `/api/*`. | Rewrote `robots.txt` so **every** group carries its own `Disallow: /api/`. Added comments explaining the non-additive rule and that robots.txt is advisory, not access control. AI-crawler allow **decision unchanged** (see below). |
| R4 | `dateModified` honesty | Pass 1 bumped `dateModified` to 2026-08-31 and added a visible "Updated 31 Aug 2026" byline on **all 5** guides, but 3 of them (`private-chef-allergen-management-guide`, `how-to-register-food-business-uk-private-chef`, `how-to-price-a-bespoke-dinner-party`) had **no body-content change** — only author re-attribution + schema. Claiming a content update there is soft date-gaming. | Reverted `dateModified` to the original publish date and removed the visible "Updated" text on those 3. The author byline correction stays. The **2** guides with real accuracy edits (`do-private-chefs-need-haccp-uk`, `what-eho-inspector-checks-private-chef`) legitimately keep `dateModified: 2026-08-31` + "Updated 31 Aug 2026". |
| R5 | Entity consistency | Footer of `resources.html` and `how-to-price-a-bespoke-dinner-party.html` said "…by Side Order Catering" (no "Ltd") while the rest of the site now says "Side Order Catering Ltd". | Normalised both to "Side Order Catering Ltd". |
| R6 | Compliance wording (new pages) | `/about`: "one app that **does the compliance**…"; `/about/michael-ogorman`: "HACCP records that **would stand up to** an EHO inspection". Both overstate what software alone delivers. | → "one app that **handles the food-safety records**…" and "HACCP records **ready for** an EHO inspection". |
| R7 | Accessibility | `/about` and `/contact` key/value tables used bare `<th>` for row headers. | Added `scope="row"` to all 10 header cells. (`<tr>` directly in `<table>` is valid HTML5 — parser inserts `<tbody>` — left as is.) |
| R8 | Implementation-detail exposure (in this doc) | §4 named the actual back-end processors. `SEO_IMPLEMENTATION.md` sits in the deployed web root and was therefore publicly fetchable. | Genericised the processor list; and the doc itself is now blocked from public serving — see DEPLOYMENT HYGIENE below. |

### Reviewed and found correct (no change)

- **Canonicals:** every public page self-references its clean URL over `https://getveriqo.co.uk`; `og:url` matches each canonical; homepage canonical keeps the trailing slash, all others omit it, consistent with the sitemap. No cross-canonical mistakes (the one intentional cross-canonical, `/veriqo → /`, is correct after R2).
- **Sitemap:** 15 URLs, all 200-status public pages, all `<loc>` absolute and canonical-consistent; `/app` correctly removed; no `noindex` URL is listed (checked `/pay`, `/event`, `/client-intake` — all already `noindex,nofollow` and none are in the sitemap); well-formed XML.
- **Private/app routes:** `app.html` = `noindex, follow` (unchanged); `/pay`, `/event`, `/client-intake` = `noindex,nofollow` (pre-existing, verified). Nothing private is newly indexable.
- **Schema:** 33 JSON-LD blocks parse-valid. Types used (`Organization`, `SoftwareApplication`, `WebSite`, `Article`, `FAQPage`, `BreadcrumbList`, `AboutPage`, `ProfilePage`, `ContactPage`) are all real schema.org types. `@id` graph on the homepage (`#organization` ← `SoftwareApplication.publisher/provider`, `WebSite.publisher`) resolves internally. `SoftwareApplication.offers` is a valid 2-item `Offer` array with `price`/`priceCurrency`; `RecurringChargeSpecification`/`billingDuration` was pre-existing and is ignored (not errored) by Google. No fake `aggregateRating`/`review`. Sub-page `Organization` nodes are inline (name + url) rather than `@id` refs — self-contained, acceptable.
- **Metadata duplication:** exactly one `<title>`, one `meta description`, one `og:title/description/image/url`, one `twitter:card` per page (checked). No conflicting `robots` metas.
- **OG/Twitter:** all `og:image`/`twitter:image` point to `icons/og-image.png` (exists) or (older articles) `icons/icon-192.png` (exists); `twitter:card=summary_large_image` throughout; `&` correctly written as `&amp;` inside attributes.
- **Internal links:** automated check — every root-relative `href` on every public page resolves to a file or a `vercel.json` route. `/about`, `/about/michael-ogorman`, `/contact` are backed by new rewrites. Anchor text is descriptive (no "click here" / bare "learn more" introduced).
- **Accessibility:** homepage nav logo `href="#"` → `href="/"` + `aria-label` (improvement); decorative SVGs `aria-hidden`; new "Related guides" blocks use a real `<h2>` and `aria-labelledby`; heading order preserved (hero `h1`, sections `h2`). New pages reuse the site's existing colour tokens — no new contrast regressions vs. the current article pages.
- **HTML validity:** tag-balance check clean on all edited/new pages; inline `style` values with `clamp()/minmax()` commas are inside quoted attributes (valid).
- **Entity clarity for AI/search:** one canonical description ("Veriqo is UK private-chef business software combining HACCP records, bookings, menus, costing, quotes, invoices, payments and prep lists") now repeats across `llms.txt`, homepage `Organization` + `SoftwareApplication` schema, and `/about`. "Veriqo" = product/brand, "Side Order Catering Ltd" = `legalName`/operator, "Michael O'Gorman" = founder/author — consistent everywhere in served pages. No "Mise Labs" remains in any served marketing/resource page.
- **Tests:** `node --test tests/*.test.js` → 82 pass / 0 fail (no JS touched).

### robots.txt — exactly which bots the current file allows

The file now has explicit groups for the agents below; **all are `Allow: /` except `Disallow: /api/`**. Any bot **not** listed falls through to `User-agent: *`, which is also `Allow: / , Disallow: /api/` — so in practice **every** compliant crawler is allowed everything except `/api/`.

| User-agent | Operator | What it feeds | Notes |
|---|---|---|---|
| `Googlebot` | Google | Google Search index | core — must stay allowed |
| `Bingbot` | Microsoft | Bing index (also powers ChatGPT/Copilot web results) | core — must stay allowed |
| `GPTBot` | OpenAI | GPT model training + retrieval | training use of public content |
| `OAI-SearchBot` | OpenAI | ChatGPT Search / SearchGPT index | drives ChatGPT search citations |
| `ChatGPT-User` | OpenAI | on-demand fetch when a user asks ChatGPT to open a link | not bulk crawling |
| `ClaudeBot` | Anthropic | Claude model training + retrieval index | |
| `Claude-Web` | Anthropic | on-demand / user-initiated fetch | |
| `PerplexityBot` | Perplexity | Perplexity answer index | Perplexity has been reported to also fetch via undeclared agents that ignore robots |
| `Google-Extended` | Google | Gemini / Vertex generative-AI training & grounding | **does not** affect Google Search ranking either way |
| `Applebot-Extended` | Apple | opt-out token for Apple generative-AI training | Applebot itself (Siri/Spotlight) is unaffected and still crawls |

Not named, therefore allowed via `*`: `CCBot` (Common Crawl — widely used as an LLM training corpus), `Bytespider` (ByteDance/TikTok), `Amazonbot`, `Meta-ExternalAgent`/`FacebookBot`, `cohere-ai`, `Diffbot`, `Timpibot`, `YouBot`, and any future crawler.

**Commercial / privacy considerations (decision left to the owner — not changed):**
- **Upside of allowing:** Veriqo's positioning, module descriptions, pricing and founder bio can be picked up and cited by AI answer engines — consistent with the stated goal of being described accurately by AI search, and reinforced by `llms.txt`.
- **Downside of allowing:** the guide content (the main organic-traffic asset) can be summarised in AI answers with little or no click-through, and used as training data, with no attribution guarantee. If resources traffic becomes commercially important, revisit `GPTBot` / `CCBot` / `Google-Extended`.
- **Privacy:** public pages carry no customer data. The only personal data exposed is the founder's name/bio (deliberately public for E-E-A-T) and `hello@getveriqo.co.uk` (already public, harvestable for spam regardless of robots).
- **Effectiveness:** robots.txt is advisory. Non-compliant scrapers ignore it; enforcement (if ever wanted) needs WAF/edge rules, not this file.
- **`ChatGPT-User` / `Claude-Web`:** blocking these mainly stops end users pasting a Veriqo URL into the assistant for summary — usually not desirable to block.

### Remaining external actions (owner)

1. Internal-doc exposure and the `/veriqo` duplicate — **both now handled in config** (see DEPLOYMENT HYGIENE below); only a post-deploy `curl` confirmation remains.
2. Privacy / Terms / Cookie pages — as in §4.1 (unchanged).
3. `veriqo.co.uk` apex 301 — as in §4.2 (unchanged).
4. Search Console + Bing Webmaster verification and the checks in §3 (unchanged).
5. Decide whether the AI-crawler allow position in `robots.txt` is right for the business (see table above). No code change needed to keep it as-is.

### Manual browser checks before merge

- **Homepage:** hero still reads "Three questions. One answer." with the new eyebrow "Private chef business software"; hero sub renders on one/two lines without overflow at 360px, 768px, 1280px.
- **`/haccp`, `/menus`, `/costing`, `/prep-lists`:** the new "Related guides" block renders with the site's section styling (it reuses `.container`/`.sec-label`/`.sec-title`; `.features` may be undefined on some pages — confirm the block still looks intentional, not unstyled), links work, and it sits above the footer.
- **`/about`, `/about/michael-ogorman`, `/contact`:** load via the clean URL (needs the new `vercel.json` routes deployed), header/footer links resolve, tables read correctly on mobile, no console errors.
- **Social unfurl:** paste `/`, `/haccp`, `/about` into the Slack/X/LinkedIn debuggers (or Facebook Sharing Debugger / X Card Validator) and confirm `og-image.png` renders and titles/descriptions are the new ones.
- **Schema:** run `/`, `/haccp`, one guide, `/about` through `validator.schema.org` and Google Rich Results Test — expect valid, no errors (SoftwareApplication won't show a rich result without ratings — that's intended).
- **`robots.txt`:** fetch `https://getveriqo.co.uk/robots.txt` and run `/` and `/haccp` through GSC's robots.txt Tester as Googlebot — expect "Allowed".
- **`sitemap.xml`:** fetch and confirm it opens as XML (not downloaded), 15 `<url>` entries.
- **404 sanity:** hitting `/about/` (trailing slash) and a bogus `/about/nope` should not 500.

---

## DEPLOYMENT HYGIENE (2026-08-31)

Final pre-commit deployment pass. Both items below are implemented in `vercel.json`.

### Internal project docs are no longer publicly served

`vercel.json` uses the legacy `routes` array, which is mutually exclusive with the modern `redirects` / `headers` keys — so path blocking is done inside `routes`, not with a `headers` rule, and **not** with `robots.txt` (which is advisory and would only advertise the paths).

Two rules were added at the **top** of the `routes` array (evaluated before any rewrite or the filesystem), each returning a bare `404`:

```json
{ "src": "/.*\\.md", "status": 404 },
{ "src": "/.*\\.code-workspace", "status": 404 },
```

- Covers every path ending in `.md` (at any depth) and every `.code-workspace` file — including `CLAUDE.md`, `SEO_IMPLEMENTATION.md`, any `VERIQO_AUDIT_*.md`, `supabase/migrations/README_DRIFT.md`, and the editor workspace file — plus any internal `.md`/`.code-workspace` added in future, with no further config changes.
- **Does not** touch legitimate public files: all public content is `.html`, plus `robots.txt` / `sitemap.xml` (`.xml`) / `llms.txt` (`.txt`) / `manifest.json` / `CNAME` / static `.js` / `.css` / images — none end in `.md` or `.code-workspace`.
- `404` (not `403`/`410`) is deliberate: it neither confirms nor denies the file exists.
- If a genuinely public Markdown page is ever wanted, publish it as `.html` — do not loosen this rule.

### `/veriqo` — permanent redirect (was canonical-only)

Reviewed for safety before switching:

| Check | Result |
|---|---|
| Internal links still pointing to `/veriqo` | None in live nav/footers. Only the now-dead `veriqo-landing.html` links to itself. |
| In `sitemap.xml` | No (was already excluded). |
| Referenced in any page's metadata / JSON-LD | No. `veriqo-landing.html` has no schema; no other page references it. |
| Tests depending on the route | None (`grep` hits for "veriqo" in `tests/` are `require('../api/veriqo-estimate.js')` — unrelated). |
| Any code suggesting `/veriqo` still serves a distinct purpose | No — documented in `CLAUDE.md` as "a near-duplicate of the homepage … with zero schema of its own". |

Conclusion: clearly redundant and fully orphaned. The rewrite `{ "src": "/veriqo", "dest": "/veriqo-landing.html" }` was replaced with:

```json
{ "src": "/veriqo", "status": 301, "dest": "/" },
{ "src": "/veriqo-landing.html", "status": 301, "dest": "/" }
```

- Permanent (301). Query strings pass through automatically on Vercel legacy-route redirects, so `?utm_*` etc. are preserved to `/`.
- The raw file URL is redirected too, so the near-duplicate can no longer be served by any path.
- `veriqo-landing.html` stays on disk (unreachable) — file deletion is out of scope for this pass.
- `CLAUDE.md`'s routing table and `/veriqo` note were updated to match.

### External / manual checks still remaining

Run against the **preview deployment** (Vercel route behaviour can't be fully exercised locally):

1. `curl -sI https://<preview>/CLAUDE.md` → **404**; same for `/SEO_IMPLEMENTATION.md`, `/VERIQO_AUDIT_2026-07-22.md`, `/supabase/migrations/README_DRIFT.md`, `/HACCP%20APP.code-workspace`.
2. `curl -sI https://<preview>/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/manifest.json` → **200** (unaffected).
3. `curl -sI https://<preview>/veriqo` and `/veriqo-landing.html` → **301** with `location: /` (and `curl -sI '.../veriqo?utm_source=x'` → `location: /?utm_source=x`).
4. `curl -sI https://<preview>/` → **200**, body has no `noindex`; `/haccp`, `/menus`, `/costing`, `/prep-lists`, `/resources`, `/resources/<any-guide>`, `/about`, `/about/michael-ogorman`, `/contact` → **200**.
5. Then the browser + Search Console / Bing checks already listed under §3 and "Manual browser checks before merge".
6. Still outstanding from earlier sections (unchanged): Privacy/Terms/Cookie pages, the `veriqo.co.uk` apex 301, GSC/Bing verification, and the AI-crawler policy decision.

---

## ACQUISITION ASSET: Private Chef Pricing Calculator (2026-08-31)

A free, public, indexable calculator — an SEO acquisition asset that also feeds Costing.

### Route

`/private-chef-pricing-calculator` → `/private-chef-pricing-calculator.html`
(added to `vercel.json` `routes`; top-level, keyword-exact, consistent with `/haccp` / `/costing`. No reason to nest under `/resources/` — a flat path matches the head query "private chef pricing calculator" better and the existing top-level pattern.)

- **Files:** `private-chef-pricing-calculator.html` (page), `js/pricing-calculator.js` (pure math + browser wiring, UMD like `js/core/gp-math.js`), `tests/pricing-calculator.test.js` (22 tests).
- Not added to the primary nav (would clutter). Linked from `/costing` "Related guides", the `/resources` card grid, and a contextual callout inside `/resources/how-to-price-a-bespoke-dinner-party` (Step 5).

### SEO target

Primary: **private chef pricing calculator**, **private chef cost calculator**, **private dining pricing calculator**, **chef costing calculator**.
Secondary / supporting content: **how much should a private chef charge**, **private chef pricing UK**, **private chef food cost percentage**, **private chef profit margin**, **margin vs markup**.

- `<title>` "Private Chef Pricing Calculator UK | Veriqo"; unique meta description; canonical; OG + Twitter `summary_large_image` with `icons/og-image.png`.
- Schema (all JSON-LD, validated): `WebApplication` (`isAccessibleForFree: true`, `offers` price 0 GBP, `provider` → Veriqo, `browserRequirements`), `FAQPage` (7 Q&As mirrored from the visible FAQ), `BreadcrumbList` (Home / Resources / Calculator). `WebPage` was considered but omitted as duplicative — this mirrors the product pages' `SoftwareApplication` + `FAQPage` + `BreadcrumbList` set. No ratings/reviews.
- In `sitemap.xml` at priority 0.8, `changefreq` monthly.

### Calculation methodology

All figures computed at full float precision; only display is rounded (whole £ for money, 1 dp for percentages). Rows can therefore differ by ~£1 from their parts — noted on the page.

```
directCosts       = ingredientCost + travelCost + staffCost + otherCosts
ownerHours        = prepHours + serviceHours + adminHours
ownerLabour       = ownerHours × hourlyRate
costBeforeProfit  = directCosts + ownerLabour
sellingPriceNet   = costBeforeProfit ÷ (1 − targetMargin)      ← margin, NOT markup
                    (£400 @ 20% → £400 ÷ 0.8 = £500, not £480)
pricePerGuest     = sellingPriceNet ÷ guests
foodCostPct       = ingredientCost ÷ sellingPriceNet × 100     (of NET price)
grossContribution = sellingPriceNet − costBeforeProfit         (= sellingPriceNet × margin)
revenuePerOwnerHour = sellingPriceNet ÷ ownerHours             (null when ownerHours = 0)
impliedMarkupPct  = margin ÷ (1 − margin) × 100
VAT (only if "VAT registered" ticked; rate editable, defaults 20):
  vat            = sellingPriceNet × vatRate
  customerTotal  = sellingPriceNet + vat
```

Guards / validation: `guests` clamped to ≥ 1 (no divide-by-zero); costs, hours, rate clamped to ≥ 0; negative margin clamped to 0; **margin ≥ 100% is rejected** (`{ ok: false, error: 'margin_too_high' }`) — never Infinity/NaN; non-numeric input coerces to its fallback. `computePricing({})` and garbage input never throw.

Terminology on the page is deliberate: **margin** (share of selling price) vs **markup** (share of cost) are both shown and explained; the profit figure is labelled **"Contribution before general overheads & tax"**, never "your profit". The page states the output is a planning estimate, not a legally correct price, a standard UK rate, or a guarantee of profit/income.

### Internal-link changes

| File | Change |
|---|---|
| `vercel.json` | + route `/private-chef-pricing-calculator` |
| `sitemap.xml` | + `<url>` for the calculator |
| `costing.html` | "Related guides" → added "Private chef pricing calculator" as the first item |
| `resources.html` | + article-card "Private Chef Pricing Calculator" (tag "Free Tool · Pricing", "Open calculator →") next to the pricing article |
| `resources/how-to-price-a-bespoke-dinner-party.html` | + `.callout` after the Step 5 margin formula linking to the calculator with a descriptive anchor |
| calculator page | links out to `/costing` (CTA), `/resources/how-to-price-a-bespoke-dinner-party`, `/resources` |

### Privacy behaviour

- Runs **entirely client-side**. `js/pricing-calculator.js` makes **no network calls** and there is **no inline script** on the page.
- **No analytics** of any kind on this page (marketing pages carry no GTM/PostHog; none was added). No event ever contains entered cost/pricing values.
- No `localStorage` / cookies — inputs are not persisted anywhere; a refresh returns the example prefill. Stated on the page ("runs entirely in your browser; nothing you enter is sent anywhere").

### Accessibility

Every input has an explicit `<label for>`; grouped in `<fieldset>`/`<legend>`; `£`/`%` affixes are `aria-hidden` with the unit repeated in the label text. Results headline is a small `aria-live="polite" aria-atomic="true"` region (concise announcement on change); the detailed `<dl>` updates silently but is navigable. Margin error uses `role="alert"` + `aria-invalid` on the field; the message is text, not colour. `:focus-visible` outlines throughout. Layout is single-column below 860px and the input grid collapses to one column below 420px (usable at 360px). `<noscript>` points to the written-out method.

### Verification

- `node --test tests/*.test.js` → **104 pass / 0 fail** (82 existing + 22 new).
- 36 JSON-LD blocks valid; `sitemap.xml` well-formed; `vercel.json` valid; all internal links resolve; HTML tag-balance clean; every `<label for>` resolves to an `id`.
- Fake-DOM smoke test of `js/pricing-calculator.js` wiring: example prefill renders (£641 / £80 per guest / 37.5% food cost / £128 contribution), VAT toggle reveals net + VAT + customer total, `margin = 100` shows the error state with `aria-invalid`. (A DOM test runner is deliberately not added to the repo — CLAUDE.md notes none is set up. Manual browser check still recommended: keyboard tab order, iOS no-zoom on inputs, 360 px layout, screen-reader announcement of the live region.)

---

## ACQUISITION ASSET: UK Food Temperature Guide (2026-08-31)

A public, indexable food-safety reference — a bookmarkable table with a lightweight filter, plus supporting explainers. Safety-critical content, so accuracy is the first constraint.

### Route

`/food-temperature-guide-uk` → `/food-temperature-guide-uk.html`
(added to `vercel.json` `routes`; top-level and keyword-exact, matching `/private-chef-pricing-calculator` and the product pages. No reason to nest under `/resources/`.)

- **Files:** `food-temperature-guide-uk.html` (page — full reference table + prose server-rendered), `js/food-temperature-guide.js` (pure `rowMatches`/`filterRows` + progressive-enhancement DOM wiring, UMD), `tests/food-temperature-guide.test.js` (22 tests: filter logic + HTML content-regression guards).
- Not in primary nav. Inbound links added from `/haccp` ("Related guides" + the temperature-threshold FAQ answer), the `/resources` card grid, `resources/do-private-chefs-need-haccp-uk`, `resources/what-eho-inspector-checks-private-chef`, and the printable `resources/haccp-temperature-log` (whose footer legend was also softened — "within 90 minutes" was presented as a PASS target; now "FSA guidance: within ~90 min").

### SEO intent

Primary: **food temperature guide UK**, **cooking temperature UK**, **food safety temperature chart UK**, **fridge temperature UK food business**, **hot holding temperature UK**, **reheating temperature UK**, **cooling food safely UK**, **food transport temperature UK**, **HACCP temperature guide**, **private chef temperature log**.
- `<title>` "Food Temperature Guide UK | HACCP Temperatures | Veriqo"; unique meta description; canonical; OG + Twitter `summary_large_image` (`og-image.png`).
- Schema: `WebPage` (`lastReviewed: 2026-08-31`, `isPartOf` WebSite, `about` = Food safety / HACCP / Food temperature control), `BreadcrumbList`, `FAQPage` (9 Q&As mirrored from the visible FAQ). **No** `MedicalWebPage`/regulatory schema (does not genuinely apply), **no** `SoftwareApplication` (it is a reference, not a tool), no ratings.

### Source methodology

Every safety-related figure on the page is traceable to a UK primary source, linked in a "Sources & guidance" section with descriptive anchors: FSA Safer Food Better Business, FSA business-guidance hub, FSA chilling guidance, FSA cooking guidance, GOV.UK food-business responsibilities, `legislation.gov.uk` for the Food Safety and Hygiene (England) Regulations 2013, the Food Safety (Temperature Control) Regulations 1995 (Scotland), and the Quick-frozen Foodstuffs (England) Regulations 2007, plus Food Standards Scotland. No blogs or secondary aggregators are cited. A prominent disclaimer states it is **not legal advice**, that rules differ by UK nation, and that Veriqo is **not a government scheme** and does not by itself make a business compliant.

### Legal / guidance / default distinction

Three labelled tags, each with a text explanation (colour is never the only signal), defined in a legend above the table:

| Tag | Meaning | Examples on the page |
|---|---|---|
| **Legal requirement** | Set in UK regulations | 8°C cold-holding max & 63°C hot-holding min (E/W/NI 2013 Regs + equivalents; Scotland 1995 Regs); the 2-hour-below-63°C and 4-hour-above-8°C single-period exceptions (E/W/NI); Scotland reheating **82°C**; −18°C for quick-frozen foods |
| **FSA guidance / recommendation** | Official advice or a recommended target, not the only lawful method | 5°C chilled operating target; cooking reference combinations (70°C/2min, 75°C/30s, 80°C/6s, 60°C/45min); a single 75°C core check as a practical proxy; reheating to 75°C / "piping hot" in E/W/NI; cool "as fast as possible, ≈90 min" (explicitly **not** a fixed legal time); the 8–63°C danger zone |
| **Veriqo default** | An app threshold, adjustable in Settings, **not a legal threshold** | cooking/reheat fail < 75°C; fridge warn > 5°C / fail > 8°C; freezer warn > −18°C / fail > −15°C; cold transport warn > 5°C / fail > 8°C; hot transport warn < 70°C / fail < 63°C — also listed together in a distinct "Veriqo app defaults" box |

The page explicitly says there is **no single cooking temperature fixed in law** for England, Wales and Northern Ireland, and **no single cooling time fixed in UK food hygiene law**.

### Interactive filter (progressive enhancement)

Full `<table>` (semantic: `<caption>`, `<thead>` `<th scope="col">`, `<tbody>` `<th scope="row">` on the first cell, wrapped in a keyboard-focusable `overflow-x:auto` region). Filter bar (`hidden` in HTML, revealed by JS) = category toggle buttons with `aria-pressed` + a `type="search"` input. `js/food-temperature-guide.js` toggles `row.hidden` via the pure `rowMatches(row, {category, query})` (category match AND every query term present in the row text or its `data-keywords`). A `role="status" aria-live="polite"` line reports "Showing N of M entries". With JS off: filter bar stays hidden, `<noscript>` explains, full table shown. All SEO-critical text is in the HTML.

### Internal links added

`vercel.json` (+route), `sitemap.xml` (+url), `haccp.html` (Related guides + FAQ answer), `resources.html` (+card), `resources/do-private-chefs-need-haccp-uk.html` (further reading), `resources/what-eho-inspector-checks-private-chef.html` (further reading), `resources/haccp-temperature-log.html` (footer legend link + wording softened). The guide links out to `/haccp`, `/resources/haccp-temperature-log`, `/resources/do-private-chefs-need-haccp-uk`, `/resources/what-eho-inspector-checks-private-chef`, `/resources`.

### Tests added (`tests/food-temperature-guide.test.js`, 22)

- Filter logic: category `all`/specific/case-insensitive, single/multi-term query (AND), `data-keywords` search, empty query, `null` args safe, `filterRows` subset.
- **Content-regression guards on the HTML** (dangerous-regression protection): asserts the page never matches `/must reach 75°C/`, `/75°C is (the legal|a legal requirement)/`, `/legal minimum (of|is) 75/`; asserts it *does* contain "no single cooking temperature fixed/set in law" + the equivalence combinations; asserts the 5°C-recommendation vs 8°C-legal-maximum distinction is present and 5°C is never called the legal maximum; asserts 63°C is stated as a legal minimum; asserts cooling is guidance not an invented fixed legal limit; asserts the Scotland 82°C difference is present; asserts "Veriqo default" is labelled "not a legal threshold" / "Product setting, not law"; asserts no "guarantees compliance" / "government-certified"; asserts the FSA/legislation.gov.uk/FSS source links exist; asserts schema is exactly WebPage + BreadcrumbList + FAQPage with no ratings; asserts the table row count matches the announced count and header cells carry `scope`.

### Privacy / performance

Runs entirely client-side. `js/food-temperature-guide.js` makes no network calls, no analytics, no storage — filter/search terms never leave the browser. No inline script on the page. No external libraries; the reference works immediately (and fully without JS).

### Evidence-led food-safety review (2026-08-31)

A second review verified every materially safety-critical claim against current primary sources (live-fetched). Changes made:

| # | Claim before | Claim now | Primary source |
|---|---|---|---|
| 1 | Cooling: table + prose said **"FSA guidance is ≈90 minutes"** and "within about 90 minutes" is SFBB guidance | **"As quickly as possible, then refrigerate."** Prose/table add: "Current FSA / GOV.UK guidance describes getting cooked food into the fridge within one to two hours." The "90 minutes" figure is removed from every public page. | [GOV.UK / FSA — How to chill, freeze and defrost food safely](https://www.gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely/how-to-chill-freeze-and-defrost-food-safely) — "cool cooked food at room temperature and place in the fridge within one to two hours". No "90 minutes" wording in current FSA guidance. |
| 2 | Legend: **"Legal requirement — set out in UK regulations. Breaking it is an offence."** | **"Legal requirement — a requirement arising from food law. Specific exemptions, tolerances or statutory defences may apply."** | [Food Safety and Hygiene (England) Regs 2013, Sch 4](https://www.legislation.gov.uk/uksi/2013/2996/schedule/4/made) — the 8°C/63°C offences carry explicit statutory defences (manufacturer-specified temperature, four-hour and two-hour single periods, unavoidable reason such as equipment breakdown). |
| 3 | Hot transport: **"63°C or above … Same basis as hot holding"** tagged *Legal requirement* | **"Where food is transported hot and kept under hot-holding control, keep it above 63°C. An equally valid approach is to transport it chilled (8°C or below) and reheat it fully on site. Transport itself is covered by the general duty to keep food safe, not a separate transport thermometer law."** Tag changed to *FSA guidance*. | 2013 Regs Sch 4 para 6 frames the 63°C offence around food kept below 63°C at *food premises*; transport is governed by the general temperature-control / food-safety duty. Applying 63°C in hot transit is the recommended control, not a distinct statutory transport threshold. |
| 4 | Record retention: **"the FSA suggests keeping food safety records for at least three months, and allergen-related records for longer"** (guide + FAQ + 4 resource articles) | **"Keep records long enough to show your food-safety controls are being followed and to meet any specific legal, customer or business requirements that apply to you; there is no single retention period set in the general food hygiene regulations. Allergen information must be accurate, provided in writing where appropriate, and kept up to date."** | [GOV.UK / FSA — Managing food safety](https://www.gov.uk/government/publications/managing-food-safety); [FSA — HACCP-based procedures (Ch 4.2)](https://www.food.gov.uk/business-guidance/chapter-42-haccp-based-procedures) — no universal retention period in the hygiene regs; records must be kept up to date and available for inspection; sector rules may add requirements. [SFBB](https://www.gov.uk/government/publications/safer-food-better-business-sfbb): "Store all your completed diary pages safely until your next visit from a local authority food safety officer." |
| 5 | High-risk cooking: **"Cook right through. No pink meat, juices run clear. Probe the thickest part."** | **"Control by time and temperature: cook right through and check the centre or thickest part with a probe, avoiding bone. Visual signs — no pink meat, juices running clear — are a secondary check for when you cannot probe, not a substitute for the temperature/time control."** | [GOV.UK / FSA — Cooking your food](https://www.gov.uk/government/publications/cooking-your-food/cooking-your-food) presents visual cues explicitly as the fallback "If you don't have a food thermometer". For a HACCP reference, time/temperature is the control. |
| 6 | Scotland reheating cited to the **Food Safety (Temperature Control) Regs 1995** | Cited to the **Food Hygiene (Scotland) Regulations 2006, Sch 4** (still 82°C, with the "deterioration of its qualities" defence). Scotland cold-holding row re-pointed to the 2006 regs. | [The Food Hygiene (Scotland) Regulations 2006, Sch 4 para 3](https://www.legislation.gov.uk/ssi/2006/3/schedule/4/made) — "raised to a temperature of not less than 82°C"; quality defence. |
| 7 | Sources linked to `food.gov.uk/business-guidance/*` and `food.gov.uk/safety-hygiene/*` | All safety-critical claims now link **direct to gov.uk / legislation.gov.uk / foodstandards.gov.scot**. | Live-checked: `food.gov.uk/business-guidance/safer-food-better-business-sfbb`, `/safety-hygiene/chilling` and `/safety-hygiene/cooking-your-food` now **301-redirect to `gov.uk/government/publications/…`** — the FSA guidance content has moved to GOV.UK. |
| — | Cooking equivalents row listed 70/2min + three others | Added **65°C for 10 minutes** so all five FSA combinations appear in the table (they were already in the explainer). | GOV.UK / FSA — Cooking your food (verbatim: "60°C for 45 minutes, 65°C for 10 minutes, 70°C for 2 minutes, 75°C for 30 seconds, 80°C for 6 seconds"). |
| — | Freezer row: "recommended and widely required standard … must be kept at −18°C" | "recommended standard … for commercially quick-frozen foods, −18°C is set by the Quick-frozen Foodstuffs Regulations … for other frozen food it is guidance". Tag: legal status **only** for quick-frozen-food-legislation foods. | [Quick-frozen Foodstuffs (England) Regs 2007](https://www.legislation.gov.uk/uksi/2007/191/contents). |

**Kept as verified (with qualification):** the five FSA cooking combinations; 5°C recommended chilled target; 8°C cold-holding legal maximum (E/W/NI) with the four-hour display exception and statutory defences; 63°C hot-holding with the two-hour single period and defences; Scotland's 82°C reheating rule and its quality defence; −18°C for quick-frozen foods; every "Veriqo default" row labelled a product default, not law.

Resource copy also amended for the same reasons: `resources/haccp-temperature-log.html` (printable legend — "within ~90 min" → "then refrigerate"), `resources/do-private-chefs-need-haccp-uk.html` (cooling + "how long to keep records" callout), `resources/what-eho-inspector-checks-private-chef.html` (two cooling lines + two three-month lines), `resources/private-chef-allergen-management-guide.html` (three-month allergen-retention sentence).

**Out of scope (authenticated app, not touched):** `app.html` and `event.html` contain in-app cooling copy using "90 minutes" as a *target* with "maximum 2 hours (UK FSA guidance)" — this is Veriqo's documented in-product HACCP methodology, framed as a target not a legal PASS line, and changing authenticated behaviour is outside this task. Flag for a future in-app review. (`haccp-app PC.html` is a gitignored retired variant, not served.)

### Facts requiring periodic review (UK guidance can change)

1. **The FSA→GOV.UK migration** — `food.gov.uk/business-guidance/*` and `/safety-hygiene/*` now 301 to `gov.uk/government/publications/*`. The guide links the gov.uk targets directly; re-check these annually as GOV.UK can re-slug. `legislation.gov.uk` SI URLs are permanent.
2. **Cooling** — current FSA/gov.uk wording is "as quickly as possible" / "into the fridge within one to two hours". No "90 minutes" and no universal statutory cooling time. Keep it that way unless a future primary FSA source reintroduces a specific figure.
3. **Record retention** — no single period in the general hygiene regulations. Do not reintroduce "three months" as a universal requirement; sector-specific or customer requirements may still apply.
4. **Scotland reheating = 82°C** — Food Hygiene (Scotland) Regulations 2006, Sch 4 para 3, with the "deterioration of its qualities" defence. Re-verify against Food Standards Scotland if the Scottish regs are consolidated.
5. **Time-limited exceptions & defences** — 2 hours below 63°C (hot), 4 hours above 8°C (cold display), single period, E/W/NI, plus the manufacturer-temperature and unavoidable-reason defences. Confirm the hours and the Scottish position (link FSS).
6. **8°C / 63°C statutory figures** — Food Safety and Hygiene (England) Regs 2013 Sch 4 and devolved equivalents; Food Hygiene (Scotland) Regs 2006 for Scotland.
7. **−18°C** — legal only for foods within the quick-frozen-food legislation (England SI 2007/191, devolved equivalents); guidance otherwise.
8. **`lastReviewed` schema + on-page "Last reviewed" date** — update on every re-check.

### Verification

- `node --test tests/*.test.js` → **130 pass / 0 fail** (126 + 4 new content-regression guards for this review).
- 39 JSON-LD blocks valid; `sitemap.xml` well-formed; `vercel.json` valid; all internal links resolve; HTML tag-balance clean on the guide and all four amended articles.
- New guards assert: the "90 minutes" cooling figure never reappears (and the supported "one to two hours" phrasing is present); no blanket three-month HACCP retention; no universal "allergen records kept longer"; the legend acknowledges exemptions/tolerances/defences; hot-transport wording does not overstate 63°C as a separate transport law; sources are gov.uk / legislation.gov.uk / FSS (incl. the Scotland 2006 regs) and not secondary hospitality sites.
- Fake-DOM smoke test of `js/food-temperature-guide.js` (unchanged): filter bar un-hides on init, category filters rows, search narrows, `role="status"` updates, empty-result message toggles. Manual browser check still recommended: 360px table scroll, `aria-pressed` visibility, keyboard operation, external source links open.
