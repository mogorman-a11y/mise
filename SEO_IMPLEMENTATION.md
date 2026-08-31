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
