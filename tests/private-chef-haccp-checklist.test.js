// tests/private-chef-haccp-checklist.test.js — run with: node --test tests/
//
// Content-regression guards for /resources/private-chef-haccp-checklist-uk.
// This is a safety-critical HACCP reference: the guards below protect the
// legal / guidance / operational / Veriqo-default distinctions established in
// the Food Temperature Guide review, plus the page's structure, schema,
// authorship, internal links and primary-source hygiene. They deliberately
// check dangerous concepts, not exact prose, so ordinary copy editing stays
// possible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(
  path.join(__dirname, '../resources/private-chef-haccp-checklist-uk.html'), 'utf8'
);
const SITEMAP = fs.readFileSync(path.join(__dirname, '../sitemap.xml'), 'utf8');

// ─── Dangerous food-safety / legal regressions ──────────────────────────────

test('does not present 75°C as the sole legal cooking temperature', () => {
  for (const re of [
    /75\s*°?c is (the|a) legal/i,
    /75\s*°?c is the legal cooking temperature/i,
    /legal cooking temperature (is|of)\s*75/i,
    /must reach (at least )?75\s*°?c/i,
    /the legal (minimum|requirement) (is|of)\s*75/i
  ]) assert.ok(!re.test(HTML), `must not match ${re}`);
  // and it must actively say there is no single lawful number
  assert.match(HTML, /not a single (magic )?number|equivalent (time\/temperature )?combinations|not correct to say 75/i);
});

test('does not present 5°C as the universal legal fridge maximum', () => {
  for (const re of [
    /5\s*°?c is the legal (fridge )?(maximum|limit)/i,
    /legal (fridge )?maximum (is|of)\s*5\s*°?c/i,
    /5\s*°?c[^.]{0,30}legal maximum/i
  ]) assert.ok(!re.test(HTML), `must not match ${re}`);
  assert.match(HTML, /5°C or below is the FSA recommended/i);
  assert.match(HTML, /8°C[^.]{0,60}(legal|cold-holding maximum)/i);
});

test('does not state a universal 90-minute cooling rule', () => {
  assert.ok(!/90\s*min/i.test(HTML), 'the "90 minutes" cooling figure must not appear at all');
  assert.ok(!/must be cooled within/i.test(HTML));
  assert.match(HTML, /cool it as quickly as possible/i);
  assert.match(HTML, /within one to two hours/i);
  assert.match(HTML, /no single fixed cooling time set in the general food-hygiene regulations/i);
});

test('does not state a blanket three-month HACCP record-retention rule', () => {
  for (const re of [
    /at least three months/i,
    /for (at least )?3 months/i,
    /keep(ing)? .{0,30}records for (at least )?(three|3) months/i,
    /the FSA (recommends|suggests) keeping .{0,40}records for/i
  ]) assert.ok(!re.test(HTML), `must not match ${re}`);
  assert.match(HTML, /no single universal retention period in the general food-hygiene regulations/i);
});

test('does not state a blanket "keep allergen records longer" rule', () => {
  assert.ok(!/allergen[- ]related records for longer/i.test(HTML));
  assert.ok(!/allergen records .{0,40}(kept|retained) (for )?longer than/i.test(HTML) ||
            /no general rule that allergen records must always be retained longer/i.test(HTML));
  assert.match(HTML, /no general rule that allergen records must always be retained longer/i);
  assert.match(HTML, /[Aa]llergen information (should|must) be accurate and (kept )?up to date/i);
});

test('does not overstate 63°C as a separate universal transport thermometer law', () => {
  assert.ok(!/must be transported (at|above) 63\s*°?c/i.test(HTML));
  assert.ok(!/63\s*°?c[^.]{0,50}transport[^.]{0,20}law/i.test(HTML));
  assert.match(HTML, /not a separate universal transport[- ]thermometer law/i);
});

test('does not claim Veriqo guarantees compliance or is government-approved', () => {
  for (const re of [
    /guarantees? (legal )?compliance/i,
    /government[- ](certified|approved|endorsed)/i,
    /ensures compliance/i,
    /\bmakes (you|a business|a private chef) compliant\b/i
  ]) assert.ok(!re.test(HTML), `must not match ${re}`);
  assert.match(HTML, /not legal advice/i);
});

test('does not claim digital HACCP records are legally required', () => {
  for (const re of [
    /digital (haccp )?records are (legally )?required/i,
    /must (keep|use) digital records/i,
    /digital .{0,20}(mandatory|required by law)/i
  ]) assert.ok(!re.test(HTML), `must not match ${re}`);
  assert.match(HTML, /[Dd]igital HACCP( records)? (is|are) not legally required/i);
});

// ─── The control / monitoring / evidence distinction (article's backbone) ────

test('explains the control vs monitoring vs recording-evidence distinction', () => {
  assert.match(HTML, /[Hh]aving a control/);
  assert.match(HTML, /[Mm]onitoring the control/);
  assert.match(HTML, /[Rr]ecording evidence/);
  assert.match(HTML, /not (an )?interactive form/i); // the visual checklist is flagged non-interactive
});

test('the at-a-glance checklist uses no interactive inputs', () => {
  assert.ok(!/<input/i.test(HTML), 'checklist must be visual only, no <input> elements');
});

// ─── Structure, links, schema, authorship ──────────────────────────────────

test('canonical, OG url and no noindex', () => {
  assert.match(HTML, /<link rel="canonical" href="https:\/\/getveriqo\.co\.uk\/resources\/private-chef-haccp-checklist-uk" \/>/);
  assert.match(HTML, /<meta property="og:url" content="https:\/\/getveriqo\.co\.uk\/resources\/private-chef-haccp-checklist-uk" \/>/);
  assert.ok(!/name="robots"/i.test(HTML));
});

test('expected internal links are present with clean routes (no .html)', () => {
  for (const href of [
    '/haccp',
    '/food-temperature-guide-uk',
    '/resources/do-private-chefs-need-haccp-uk',
    '/resources/haccp-temperature-log',
    '/resources/what-eho-inspector-checks-private-chef',
    '/resources/private-chef-allergen-management-guide',
    '/resources/how-to-register-food-business-uk-private-chef',
    '/resources'
  ]) assert.ok(HTML.includes(`href="${href}"`), `missing internal link ${href}`);
  assert.ok(!/href="\/resources\/[a-z-]+\.html"/.test(HTML), 'internal links must use clean routes, not .html');
});

test('author is Person Michael O\'Gorman linking the author page; publisher Veriqo; no Mise Labs', () => {
  assert.match(HTML, /"@type": "Person", "name": "Michael O'Gorman"/);
  assert.match(HTML, /"url": "https:\/\/getveriqo\.co\.uk\/about\/michael-ogorman"/);
  assert.match(HTML, /href="\/about\/michael-ogorman"/);
  assert.match(HTML, /"publisher": \{ "@type": "Organization", "name": "Veriqo"/);
  assert.ok(!/Mise Labs/i.test(HTML));
});

test('no "Updated" date in the article byline', () => {
  const byline = HTML.match(/<p>By <a href="\/about\/michael-ogorman[\s\S]*?<\/p>/)[0];
  assert.ok(!/updated/i.test(byline), 'byline must not carry an Updated date on first publish');
  assert.match(byline, /Published 31 August 2026/);
});

test('schema: Article + BreadcrumbList + FAQPage, valid JSON, no ratings', () => {
  const blocks = HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  assert.equal(blocks.length, 3);
  const parsed = blocks.map(b => JSON.parse(b.replace(/<\/?script[^>]*>/g, '')));
  assert.deepEqual(parsed.map(p => p['@type']).sort(), ['Article', 'BreadcrumbList', 'FAQPage']);
  assert.ok(!/aggregateRating|"review"|ratingValue/i.test(HTML));
  const article = parsed.find(p => p['@type'] === 'Article');
  assert.equal(article.datePublished, '2026-08-31');
  assert.equal(article.url, 'https://getveriqo.co.uk/resources/private-chef-haccp-checklist-uk');
});

test('FAQ structured data matches the visible FAQ questions', () => {
  const faqBlock = (HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
    .map(b => JSON.parse(b.replace(/<\/?script[^>]*>/g, '')))
    .find(p => p['@type'] === 'FAQPage');
  const schemaQs = faqBlock.mainEntity.map(q => q.name.replace(/\s+/g, ' ').trim());
  const visibleQs = [...HTML.matchAll(/<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/’/g, "'").trim());
  assert.deepEqual(visibleQs, schemaQs);
  assert.equal(schemaQs.length, 9);
});

test('primary sources are gov.uk / food.gov.uk / legislation.gov.uk / foodstandards.gov.scot only', () => {
  const externalHosts = [...HTML.matchAll(/href="https?:\/\/([^/"]+)/g)]
    .map(m => m[1].replace(/^www\./, ''))
    .filter(h => h !== 'getveriqo.co.uk');
  const allowed = new Set(['gov.uk', 'food.gov.uk', 'foodstandards.gov.scot', 'legislation.gov.uk']);
  for (const h of externalHosts) assert.ok(allowed.has(h), `unexpected external source host: ${h}`);
  // and it must actually cite the key ones
  assert.ok(HTML.includes('gov.uk/food-safety-management-systems'));
  assert.ok(HTML.includes('legislation.gov.uk/eur/2004/852'));
  assert.ok(HTML.includes('gov.uk/guidance/food-business-registration'));
  assert.ok(HTML.includes('foodstandards.gov.scot'));
  assert.ok(!/highspeedtraining|navitas|virtual-college|foodalert|hospitalityexpert|trainingexpress/i.test(HTML));
});

test('records summary table is semantic (caption, scoped headers, scroll region)', () => {
  assert.match(HTML, /<table class="rec-table">/);
  assert.match(HTML, /<caption>/);
  assert.ok((HTML.match(/<th scope="col">/g) || []).length === 5);
  assert.ok((HTML.match(/<th scope="row">/g) || []).length >= 12);
  assert.match(HTML, /class="table-scroll"[^>]*tabindex="0"[^>]*role="region"/);
});

test('sitemap.xml includes the new article URL, and it is not noindex', () => {
  assert.ok(SITEMAP.includes('https://getveriqo.co.uk/resources/private-chef-haccp-checklist-uk'));
  assert.ok(!/noindex/i.test(HTML));
});
