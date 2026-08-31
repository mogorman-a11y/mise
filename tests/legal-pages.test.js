// tests/legal-pages.test.js — run with: node --test tests/
//
// Content + wiring guards for the Veriqo legal pages added on the
// privacy/hardening-pass branch: /privacy, /terms, /cookies and
// /data-processing, plus footer links, sitemap entries, routing, and the
// *.sql public-exposure block. These check that the substance required by
// the brief is present (company identity, controller/processor split,
// special-category handling, provider list, consent-based analytics, DPA
// Article 28 core terms, food-safety responsibility split, cookie page
// covering localStorage + IndexedDB) and that dangerous regressions are
// absent (no "analytics necessary", no "all data stays in the UK/EU", no
// attempt to exclude death / personal-injury negligence liability). They
// deliberately check concepts, not exact prose.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PRIVACY = read('privacy.html');
const TERMS = read('terms.html');
const COOKIES = read('cookies.html');
const DPA = read('data-processing.html');
const SITEMAP = read('sitemap.xml');
const VERCEL = read('vercel.json');
const APP = read('app.html');
const INTAKE = read('client-intake.html');

const ALL = { 'privacy.html': PRIVACY, 'terms.html': TERMS, 'cookies.html': COOKIES, 'data-processing.html': DPA };

// ─── Existence + routing ────────────────────────────────────────────────────

test('all four legal pages exist as files', () => {
  for (const f of Object.keys(ALL)) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} missing`);
    assert.ok(ALL[f].length > 2000, `${f} looks too short`);
  }
});

test('vercel.json routes /privacy /terms /cookies /data-processing to their html', () => {
  const vj = JSON.parse(VERCEL);
  for (const [route, dest] of [
    ['/privacy', '/privacy.html'],
    ['/terms', '/terms.html'],
    ['/cookies', '/cookies.html'],
    ['/data-processing', '/data-processing.html'],
  ]) {
    const r = vj.routes.find((x) => x.src === route);
    assert.ok(r && r.dest === dest, `route ${route} -> ${dest} missing`);
  }
});

test('sitemap.xml contains the legal routes and is well-formed', () => {
  const open = (SITEMAP.match(/<url>/g) || []).length;
  const close = (SITEMAP.match(/<\/url>/g) || []).length;
  assert.equal(open, close);
  for (const u of ['/privacy', '/terms', '/cookies', '/data-processing']) {
    assert.ok(SITEMAP.includes(`https://getveriqo.co.uk${u}</loc>`), `sitemap missing ${u}`);
  }
});

test('each legal page self-canonicals, is indexable, and carries WebPage + BreadcrumbList only', () => {
  const canon = { 'privacy.html': '/privacy', 'terms.html': '/terms', 'cookies.html': '/cookies', 'data-processing.html': '/data-processing' };
  for (const [f, html] of Object.entries(ALL)) {
    assert.match(html, new RegExp(`<link rel="canonical" href="https://getveriqo\\.co\\.uk${canon[f]}"`), `${f} canonical`);
    assert.ok(!/name="robots"[^>]*noindex/i.test(html), `${f} must not be noindex`);
    const blocks = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []);
    const types = blocks.map((b) => JSON.parse(b.replace(/<\/?script[^>]*>/g, ''))['@type']).sort();
    assert.deepEqual(types, ['BreadcrumbList', 'WebPage'], `${f} schema types`);
    assert.ok(!/FAQPage|aggregateRating|"review"|ratingValue/i.test(html), `${f} must not carry FAQ/rating schema`);
  }
});

test('each legal page has exactly one H1 and no <h3> before the first <h2>', () => {
  for (const [f, html] of Object.entries(ALL)) {
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${f} H1 count`);
    const h2 = html.indexOf('<h2'); const h3 = html.indexOf('<h3');
    assert.ok(h3 === -1 || h3 > h2, `${f} heading order`);
  }
});

// ─── Company identity ──────────────────────────────────────────────────────

test('company identity is present and correct on every legal page', () => {
  for (const [f, html] of Object.entries(ALL)) {
    assert.match(html, /Side Order Catering Ltd/, `${f} operator name`);
    assert.match(html, /17257119/, `${f} company number`);
    assert.match(html, /3 Forresters Close/, `${f} registered office`);
    assert.match(html, /Irthlingborough/, `${f}`);
    assert.match(html, /NN9 5HP/, `${f} postcode`);
    assert.match(html, /hello@getveriqo\.co\.uk/, `${f} contact email`);
  }
});

test('no invented ICO registration number or VAT number is shown', () => {
  for (const [f, html] of Object.entries(ALL)) {
    assert.ok(!/ICO registration (number|reference)[^.]{0,40}\b[A-Z]{1,2}\d{6,}\b/i.test(html), `${f} must not show an ICO number`);
    assert.ok(!/VAT (registration )?(number|no)\b/i.test(html), `${f} must not show a VAT number`);
  }
  // privacy policy addresses the ICO registration position in neutral terms,
  // without a number and without claiming an application has been submitted
  assert.match(PRIVACY, /registration position with the Information Commissioner's Office/i);
  assert.match(PRIVACY, /Where a registration reference is required and confirmed, it will be published here/i);
  assert.ok(!/(we have|have)\s+(submitted|made|filed|lodged)\s+(an?\s+)?(ICO\s+)?(registration\s+)?application/i.test(PRIVACY),
    'must not claim an ICO registration application has been submitted');
  assert.ok(!/we are completing our registration/i.test(PRIVACY),
    'must not imply registration is in progress without evidence');
});

// ─── Privacy Policy substance ──────────────────────────────────────────────

test('privacy policy explains the controller / processor split', () => {
  assert.match(PRIVACY, /\bcontroller\b/i);
  assert.match(PRIVACY, /\bprocessor\b/i);
  assert.match(PRIVACY, /as (a )?controller/i);
  assert.match(PRIVACY, /as (a )?processor/i);
  // customers are the controller for the data they enter about other people
  assert.match(PRIVACY, /you are the controller/i);
});

test('privacy policy addresses special-category / allergy data without asserting one Article 9 condition for all', () => {
  assert.match(PRIVACY, /special[- ]category/i);
  assert.match(PRIVACY, /allerg/i);
  assert.match(PRIVACY, /Article 9/i);
  assert.match(PRIVACY, /religio/i);
  // must NOT claim a single fixed Article 9 condition applies to every customer
  assert.ok(!/we rely on (explicit )?consent as the Article 9 condition/i.test(PRIVACY));
  assert.match(PRIVACY, /the customer is (the )?controller/i);
});

test('privacy policy lists the major providers', () => {
  for (const p of ['Supabase', 'Vercel', 'Stripe', 'Resend', 'OpenAI', 'Google Analytics', 'PostHog']) {
    assert.ok(PRIVACY.includes(p), `privacy policy missing provider ${p}`);
  }
});

test('privacy policy: analytics are explicitly optional / consent-based, never "necessary"', () => {
  assert.match(PRIVACY, /Allow analytics/);
  assert.match(PRIVACY, /off (by default|until you choose)/i);
  assert.match(PRIVACY, /Cookie &amp; analytics preferences/);
  assert.ok(!/analytics are (necessary|required) (for|to use) the service/i.test(PRIVACY), 'no "analytics necessary" claim');
  assert.match(PRIVACY, /Analytics are never required to use the service|not required to use the service/i);
});

test('privacy policy: no claim that all data stays in the UK or EU/EEA', () => {
  for (const [f, html] of Object.entries(ALL)) {
    assert.ok(!/all (your )?(data|information|personal data) (is|are|remains|stays)[^.]{0,40}\b(in the UK|within the UK|in the EU|within the EU|in the EEA|within the EEA)/i.test(html), `${f} over-claims data location`);
    assert.ok(!/EU servers/i.test(html), `${f} "EU servers" regression`);
    assert.ok(!/except Supabase/i.test(html), `${f} "except Supabase" regression`);
  }
  assert.match(PRIVACY, /United Kingdom, the European Economic Area and other countries|UK, the European Economic Area and other countries/i);
});

test('privacy policy: OpenAI training claim is qualified, not asserted as fact without a source', () => {
  // If it says OpenAI does not train on API data, it must attribute that to OpenAI's own terms.
  if (/not used to train OpenAI's models/i.test(PRIVACY)) {
    assert.match(PRIVACY, /Based on OpenAI's published API data-usage terms|according to OpenAI/i);
  }
  // and it must flag that the exact terms still need verifying
  assert.match(PRIVACY, /verified against OpenAI's current official documentation|To be confirmed/i);
});

test('privacy policy has a scannable lawful-basis table with real Article 6 bases', () => {
  assert.match(PRIVACY, /<table class="legal-table">/);
  assert.match(PRIVACY, /Lawful basis/i);
  assert.match(PRIVACY, /Performance of a contract/);
  assert.match(PRIVACY, /Legal obligation/);
  assert.match(PRIVACY, /Legitimate interests/);
  assert.match(PRIVACY, /Consent/);
  // legitimate interests must not be presented as an unlimited catch-all
  assert.match(PRIVACY, /not (a )?catch-all|do not treat legitimate interests as a catch-all/i);
});

test('privacy policy: retention wording is honest — no invented precise periods, keeps the 90-day Stripe fact', () => {
  assert.match(PRIVACY, /for as long as reasonably necessary/i);
  assert.match(PRIVACY, /90 days/);
  assert.match(PRIVACY, /backups?[\s\S]{0,120}(limited period|retention cycle|overwritten|expire)/i);
  assert.ok(!/instant(ly)? (erased|deleted) from every backup/i.test(PRIVACY));
  // HACCP/business records not given an arbitrary Veriqo deletion schedule while active
  assert.match(PRIVACY, /kept while your account is active[\s\S]{0,160}(not[\s\S]{0,40}separate|yours to keep)/i);
});

test('privacy policy: marketing wording is not a blanket "all marketing is soft opt-in"', () => {
  assert.ok(!/all (marketing|our marketing) (is|are) (sent )?under (the )?soft opt-in/i.test(PRIVACY));
  assert.match(PRIVACY, /transactional|service (and transactional )?emails/i);
  assert.match(PRIVACY, /unsubscribe/i);
  assert.match(PRIVACY, /does not stop service-critical emails|service-critical emails/i);
});

test('privacy policy: DUAA-era right to complain to the controller with a 30-day acknowledgement', () => {
  assert.match(PRIVACY, /acknowledge your complaint within 30 days/i);
});

// ─── Terms substance ──────────────────────────────────────────────────────

test('terms establish the food-safety responsibility division', () => {
  assert.match(TERMS, /Food-safety responsibility/i);
  assert.match(TERMS, /does <strong>not<\/strong>|\bdoes not:/i);
  // Veriqo does NOT do these things:
  for (const claim of [
    /certify (that you comply with )?HACCP/i,
    /guarantee that you comply with food law/i,
    /Environmental Health Officer|Food Hygiene Rating/i,
    /replace food-safety training/i,
    /check or validate whether the information you enter/i,
  ]) {
    assert.match(TERMS, claim, `terms food-safety exclusion: ${claim}`);
  }
  // The user remains responsible for these things:
  for (const resp of [
    /complying with all food law/i,
    /what controls and critical limits are appropriate/i,
    /keeping accurate, complete and honest records/i,
    /allergen information/i,
    /training of your staff/i,
    /when a check is missed, produces a warning, or fails/i,
  ]) {
    assert.match(TERMS, resp, `terms user responsibility: ${resp}`);
  }
});

test('terms link to and incorporate the Data Processing Terms', () => {
  assert.match(TERMS, /href="\/data-processing"/);
  assert.match(TERMS, /Article 28/);
  assert.match(TERMS, /form part of these terms|forms part of these terms/i);
});

test('terms: subscriptions renew automatically, cancel via Stripe portal, access to period end, no invented refund promise', () => {
  assert.match(TERMS, /renew automatically/i);
  assert.match(TERMS, /Stripe customer portal/i);
  assert.match(TERMS, /end of the (billing period|current paid billing period)/i);
  assert.match(TERMS, /generally non-refundable/i);
  assert.ok(!/full refund|money-back guarantee|refund within \d+ days/i.test(TERMS), 'no invented refund promise');
  // consumer-status caveat is flagged for review
  assert.match(TERMS, /Consumer Rights Act 2015/);
  assert.match(TERMS, /Consumer Contracts \(Information, Cancellation and Additional Charges\) Regulations 2013/);
  assert.match(TERMS, /owner \/ legal review|owner\/legal review|legal review/i);
});

test('terms: failed-payment wording has no invented fixed grace period', () => {
  assert.match(TERMS, /limited or suspended/i);
  assert.ok(!/\b(7|14|30)[- ]day grace period\b/i.test(TERMS));
});

test('terms: acceptable-use covers the expected SaaS restrictions', () => {
  for (const rule of [/unlawful purpose/i, /unauthorised access/i, /interfere with|disrupt/i, /malware/i, /API/i, /infringe/i, /no right to process/i]) {
    assert.match(TERMS, rule, `acceptable use: ${rule}`);
  }
});

test('terms: data ownership principle — customer keeps their data, Veriqo owns the software', () => {
  assert.match(TERMS, /you keep ownership of, and control over, the business and client data/i);
  assert.match(TERMS, /limited rights we need to host, store, process, transmit, back up/i);
  assert.match(TERMS, /own all intellectual property rights in the Veriqo software/i);
});

test('terms: no SLA / uptime guarantee, no "uninterrupted or error-free" promise', () => {
  assert.match(TERMS, /do <strong>not<\/strong> offer a service level agreement|no service level agreement|not.{0,20}guaranteed.{0,20}uptime/i);
  assert.match(TERMS, /not (promise|guarantee) that the service will be uninterrupted/i);
});

test('terms: liability does NOT attempt to exclude death / personal injury negligence, fraud, or non-excludable liability', () => {
  assert.match(TERMS, /Nothing in these terms limits or excludes our liability for/i);
  assert.match(TERMS, /death or personal injury caused by (our )?negligence/i);
  assert.match(TERMS, /fraud or fraudulent misrepresentation/i);
  assert.match(TERMS, /cannot be (limited or excluded|excluded or limited) under applicable law/i);
  // dangerous phrasing guard: must not purport to exclude the above
  assert.ok(!/exclude[s]? all liability, including for death or personal injury/i.test(TERMS));
  assert.ok(!/in no event (shall|will) we be liable for anything/i.test(TERMS));
  // a proposed cap exists and is flagged for review
  assert.match(TERMS, /limited to the total amount you paid us/i);
  assert.match(TERMS, /For owner \/ legal review/i);
});

test('terms: governing law is England and Wales; eligibility is 18+', () => {
  assert.match(TERMS, /law of England and Wales/);
  assert.match(TERMS, /courts of England and Wales/);
  assert.match(TERMS, /at least 18 years old/);
});

test('terms: does not falsely claim the Consumer Rights Act never applies', () => {
  assert.ok(!/the Consumer Rights Act (2015 )?does not apply/i.test(TERMS));
  assert.match(TERMS, /statutory rights that these terms do not affect/i);
});

// ─── Data Processing Terms — Article 28 core ───────────────────────────────

test('DPA covers the Article 28(3) core provisions', () => {
  const checks = {
    'subject matter / duration': /subject matter[\s\S]{0,400}duration/i,
    'nature and purpose': /nature and purpose/i,
    'types of personal data': /types of personal data/i,
    'categories of data subject': /categor(y|ies) of data subject/i,
    'documented instructions': /only on your documented instructions/i,
    'confidentiality': /duty of confidentiality/i,
    'security measures (Art 32)': /technical and organisational measures/i,
    'sub-processors': /sub-processors?/i,
    'international transfers': /International transfers/i,
    'assist data-subject requests': /respond to requests from data subjects/i,
    'assist breach / DPIA': /personal data breach[\s\S]{0,200}without undue delay/i,
    'return / deletion at end': /delete Customer Personal Data/i,
    'audit / information rights': /allow for and contribute to audits/i,
    'unlawful instruction notice': /infringes UK data-protection law/i,
    'special-category data': /special category data/i,
  };
  for (const [label, re] of Object.entries(checks)) {
    assert.match(DPA, re, `DPA missing: ${label}`);
  }
});

test('DPA audit terms are proportionate, not unlimited on-site audits', () => {
  assert.match(DPA, /security questionnaire/i);
  assert.match(DPA, /once in any 12-month period/i);
  assert.ok(!/unlimited (on-site )?audits|audit at any time without notice/i.test(DPA));
});

test('DPA names the sub-processors and a change / objection mechanism', () => {
  for (const p of ['Supabase', 'Vercel', 'Stripe', 'Resend', 'OpenAI']) assert.ok(DPA.includes(p), `DPA sub-processor ${p}`);
  assert.match(DPA, /informed of intended changes to our sub-processors/i);
  assert.match(DPA, /opportunity to object/i);
});

// ─── Cookies page ─────────────────────────────────────────────────────────

test('cookies page covers cookies AND localStorage AND IndexedDB', () => {
  assert.match(COOKIES, /localStorage/);
  assert.match(COOKIES, /IndexedDB/);
  assert.match(COOKIES, /PECR is not limited to cookies|not limited to cookies/i);
});

test('cookies page: marketing site has no analytics; app analytics are off until consent', () => {
  assert.match(COOKIES, /public marketing website[\s\S]{0,120}no analytics or tracking/i);
  assert.match(COOKIES, /off until you choose "Allow analytics"|do not load and set nothing until you choose/i);
  assert.match(COOKIES, /Settings &rarr; Cookie &amp; analytics preferences|Cookie &amp; analytics preferences/i);
  assert.ok(!/analytics are (necessary|required)/i.test(COOKIES));
});

test('cookies page has a readable table with the required columns and does not over-assert cookie names', () => {
  assert.match(COOKIES, /<table class="legal-table">/);
  for (const col of ['Category', 'Purpose', 'Where used', 'Required or optional', 'Typical duration']) {
    assert.ok(COOKIES.includes(col), `cookies table column ${col}`);
  }
  assert.match(COOKIES, /class="table-scroll"[^>]*role="region"/);
  // typical / unverified names are labelled as such
  assert.match(COOKIES, /typical/i);
  assert.match(COOKIES, /not independently verified|To be confirmed/i);
  assert.match(COOKIES, /Stripe/);
  assert.match(COOKIES, /veriqo_cookie_consent_v1/);
  assert.match(COOKIES, /veriqo-sync/);
});

// ─── Wiring: footers, settings, client intake ─────────────────────────────

test('public marketing footers link to /privacy, /terms and /cookies', () => {
  const pages = [
    'index.html', 'haccp.html', 'menus.html', 'costing.html', 'prep-lists.html',
    'resources.html', 'about.html', 'about/michael-ogorman.html',
    'food-temperature-guide-uk.html', 'private-chef-pricing-calculator.html',
    'resources/do-private-chefs-need-haccp-uk.html',
    'resources/what-eho-inspector-checks-private-chef.html',
    'resources/private-chef-allergen-management-guide.html',
    'resources/how-to-register-food-business-uk-private-chef.html',
    'resources/private-chef-haccp-checklist-uk.html',
    'resources/how-to-price-a-bespoke-dinner-party.html',
  ];
  for (const p of pages) {
    const foot = read(p).split('<footer')[1] || '';
    for (const l of ['/privacy', '/terms', '/cookies']) {
      assert.ok(foot.includes(`href="${l}"`), `${p} footer missing ${l}`);
    }
  }
});

test('legal pages carry a company-disclosure footer with the registered number', () => {
  for (const [f, html] of Object.entries(ALL)) {
    const foot = html.split('<footer')[1] || '';
    assert.match(foot, /Side Order Catering Ltd/, `${f} footer company`);
    assert.match(foot, /17257119/, `${f} footer company number`);
    assert.match(foot, /Forresters Close/, `${f} footer registered office`);
  }
});

test('app Settings links to /privacy, /terms and /data-processing; cookies opens the in-app control', () => {
  const seg = APP.split('Privacy &amp; legal')[1].split('Module settings')[0];
  assert.match(seg, /href="\/privacy"/);
  assert.match(seg, /href="\/terms"/);
  assert.match(seg, /href="\/data-processing"/);
  assert.match(seg, /window\.vqOpenConsent\(\)/);
  // the cookies control is a button, not a navigation away
  assert.ok(!/href="\/cookies"/.test(seg), 'Settings should open the in-app consent control, not navigate to /cookies');
});

test('client-intake privacy notice links to /privacy (now a real route)', () => {
  assert.match(INTAKE, /href="\/privacy"/);
  const vj = JSON.parse(VERCEL);
  assert.ok(vj.routes.find((x) => x.src === '/privacy'), '/privacy route exists so the intake link resolves');
});

// ─── Public *.sql exposure block ──────────────────────────────────────────

test('vercel.json blocks *.sql with a 404, before /api and any rewrite', () => {
  const vj = JSON.parse(VERCEL);
  const idx = vj.routes.findIndex((r) => r.src === '/.*\\.sql');
  assert.ok(idx !== -1, '*.sql 404 rule missing');
  assert.equal(vj.routes[idx].status, 404);
  const apiIdx = vj.routes.findIndex((r) => r.src === '/api/(.*)');
  assert.ok(idx < apiIdx, '*.sql rule must be evaluated before /api');
  // it must be a hard block, not a robots.txt discouragement
  assert.ok(!/Disallow:.*\.sql/i.test(read('robots.txt')), 'sql must be blocked by routing, not robots.txt');
});
