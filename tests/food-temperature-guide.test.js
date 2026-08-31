// tests/food-temperature-guide.test.js — run with: node --test tests/
//
// Two kinds of check for /food-temperature-guide-uk:
//   1. the pure filter/search logic in js/food-temperature-guide.js
//   2. content-regression guards on the HTML — this page is safety-critical,
//      so we assert it never regresses into stating a guidance figure as law,
//      keeps the 5°C-recommendation / 8°C-legal-maximum distinction, keeps the
//      required FSA / legislation source links, and labels Veriqo's own
//      thresholds as product defaults rather than legal requirements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guide = require('../js/food-temperature-guide.js');
const { rowMatches, filterRows } = guide;

const HTML = fs.readFileSync(path.join(__dirname, '../food-temperature-guide-uk.html'), 'utf8');

// ─── 1. Filter / search logic ────────────────────────────────────────────────

test('rowMatches: "all" category matches every row', () => {
  assert.equal(rowMatches({ category: 'cooking', text: 'x' }, { category: 'all' }), true);
  assert.equal(rowMatches({ category: 'transport', text: 'x' }, { category: 'all' }), true);
  assert.equal(rowMatches({ category: 'cooking', text: 'x' }, {}), true); // default = all
});

test('rowMatches: specific category filters', () => {
  assert.equal(rowMatches({ category: 'cooking' }, { category: 'cooking' }), true);
  assert.equal(rowMatches({ category: 'cooking' }, { category: 'reheating' }), false);
});

test('rowMatches: category comparison is case-insensitive and trimmed', () => {
  assert.equal(rowMatches({ category: 'Cooking' }, { category: ' cooking ' }), true);
  assert.equal(rowMatches({ category: ' hot-holding' }, { category: 'HOT-HOLDING' }), true);
});

test('rowMatches: single-term query matches row text', () => {
  const row = { category: 'cooking', text: 'Higher-risk items poultry pork mince burgers' };
  assert.equal(rowMatches(row, { query: 'poultry' }), true);
  assert.equal(rowMatches(row, { query: 'salmon' }), false);
});

test('rowMatches: query is case-insensitive', () => {
  assert.equal(rowMatches({ text: 'Chilled Storage 5°C' }, { query: 'CHILLED' }), true);
});

test('rowMatches: multi-term query requires every term (AND)', () => {
  const row = { text: 'transport chilled cool box ice pack client kitchen' };
  assert.equal(rowMatches(row, { query: 'cool box' }), true);
  assert.equal(rowMatches(row, { query: 'cool freezer' }), false); // "freezer" absent
});

test('rowMatches: query also searches the keywords field', () => {
  const row = { text: 'Frozen storage −18°C', keywords: 'quick frozen foodstuffs regulations minus 18' };
  assert.equal(rowMatches(row, { query: 'regulations' }), true);
});

test('rowMatches: empty / whitespace query always matches', () => {
  assert.equal(rowMatches({ text: 'anything' }, { query: '' }), true);
  assert.equal(rowMatches({ text: 'anything' }, { query: '   ' }), true);
});

test('rowMatches: null/undefined args do not throw', () => {
  assert.equal(rowMatches(null, null), true);
  assert.equal(rowMatches(undefined, undefined), true);
  assert.equal(rowMatches({}, {}), true);
});

test('filterRows: returns only rows in the chosen category', () => {
  const rows = [
    { category: 'cooking', text: 'a' },
    { category: 'transport', text: 'b' },
    { category: 'transport', text: 'c' },
    { category: 'cooling', text: 'd' }
  ];
  assert.deepEqual(filterRows(rows, { category: 'transport' }).map(r => r.text), ['b', 'c']);
  assert.equal(filterRows(rows, { category: 'all', query: 'z' }).length, 0);
  assert.equal(filterRows(undefined, {}).length, 0);
});

// ─── 2. Content-regression guards on the HTML ────────────────────────────────

test('HTML: never states 75°C as a legal minimum / requirement without qualification', () => {
  const banned = [
    /must reach (at least )?75\s*°c/i,
    /75\s*°c is the legal/i,
    /75\s*°c is a legal requirement/i,
    /legal minimum (of|is)\s*75/i,
    /cooked food must reach 75/i
  ];
  for (const re of banned) assert.ok(!re.test(HTML), `HTML should not match ${re}`);
});

test('HTML: establishes there is no single legal cooking temperature (E/W/NI)', () => {
  assert.match(HTML, /no single cooking temperature (is fixed|set) in law/i);
  assert.match(HTML, /70°C for 2 minutes/);
  assert.match(HTML, /75°C for 30 seconds/);
  assert.match(HTML, /80°C for 6 seconds/);
  assert.match(HTML, /equivalent time.?temperature/i);
});

test('HTML: keeps the 5°C recommendation vs 8°C legal-maximum distinction', () => {
  assert.match(HTML, /5°C or below/);
  assert.match(HTML, /8°C or below/);
  assert.match(HTML, /FSA recommended target/i);
  assert.match(HTML, /statutory maximum/i);
  assert.match(HTML, /legal cold-holding maximum is 8°C/i);
  // and must NOT call 5°C the legal maximum
  assert.ok(!/legal[^.]{0,30}maximum[^.]{0,10}5°C/i.test(HTML));
  assert.ok(!/5°C[^.]{0,25}legal maximum/i.test(HTML));
});

test('HTML: hot holding stated as a legal minimum of 63°C', () => {
  assert.match(HTML, /63°C or above/);
  assert.match(HTML, /legal minimum for hot holding/i);
});

test('HTML: cooling is guidance, not an invented fixed legal or FSA limit', () => {
  assert.match(HTML, /no single cooling time fixed in UK food hygiene law/i);
  assert.match(HTML, /[Cc]ool cooked food as quickly as possible/);
  // must NOT resurrect the unsourced "90 minutes" FSA framing
  assert.ok(!/90\s*min/i.test(HTML), 'the "90 minutes" cooling figure must not appear');
  assert.ok(!/FSA guidance is\s*(≈|about|around)?\s*90/i.test(HTML));
  assert.ok(!/within (about |around )?90 minutes/i.test(HTML));
  assert.ok(!/must be cooled within/i.test(HTML));
  // the "one to two hours" description that IS supported by current gov.uk guidance
  assert.match(HTML, /within one to two hours/i);
});

test('HTML: flags the Scotland reheating difference (82°C) with its statutory source', () => {
  assert.match(HTML, /In Scotland, regulations require reheating to 82°C/i);
  assert.match(HTML, /Food Hygiene \(Scotland\) Regulations 2006/);
  assert.match(HTML, /deterioration of its qualities|unacceptably spoil the food/i); // the quality defence
});

test('HTML: legal-requirement legend acknowledges exemptions / tolerances / defences', () => {
  assert.ok(!/Breaking it is an offence/i.test(HTML));
  assert.ok(!/set out in UK regulations\. Breaking/i.test(HTML));
  assert.match(HTML, /a requirement arising from food law/i);
  assert.match(HTML, /exemptions, tolerances or statutory defences may apply/i);
});

test('HTML: no blanket three-month HACCP record-retention requirement', () => {
  for (const re of [
    /at least three months/i,
    /for (at least )?3 months/i,
    /keeping (food safety )?records for at least three months/i,
    /the FSA (suggests|recommends) keeping .*records for/i
  ]) assert.ok(!re.test(HTML), `HTML should not match ${re}`);
  assert.match(HTML, /no single retention period (set|fixed) in the general food hygiene regulations/i);
});

test('HTML: does not state allergen records must universally be retained "longer"', () => {
  assert.ok(!/allergen[- ]related records for longer/i.test(HTML));
  assert.ok(!/allergen records.{0,40}(kept|retained) (for )?longer/i.test(HTML));
  // instead it emphasises accuracy / written / up to date
  assert.match(HTML, /[Aa]llergen information must be accurate/);
  assert.match(HTML, /(provided in writing|written) where appropriate/i);
  assert.match(HTML, /kept up to date/i);
});

test('HTML: hot-transport wording does not overstate 63°C as a separate transport law', () => {
  assert.ok(!/Same basis as hot holding/.test(HTML));
  assert.match(HTML, /transported hot and kept under hot-holding control/i);
  assert.match(HTML, /not a separate transport thermometer law/i);
  assert.match(HTML, /transport it chilled \(8°C or below\) and reheat it fully on site/i);
});

test('HTML: Veriqo thresholds are labelled as product defaults, not law', () => {
  assert.match(HTML, /Veriqo default/);
  assert.match(HTML, /not a legal threshold/i);
  assert.match(HTML, /Product setting, not law/i);
});

test('HTML: does not claim Veriqo guarantees compliance or is government-certified', () => {
  for (const re of [
    /guarantees? compliance/i,
    /government[- ]certified/i,
    /ensures compliance/i,
    /\bmakes a business compliant\b/i,
    /\bmakes you compliant\b/i
  ]) assert.ok(!re.test(HTML), `HTML should not match ${re}`);
  assert.match(HTML, /not legal advice/i);
  assert.match(HTML, /not a government scheme/i);
});

test('HTML: cites authoritative UK primary sources (gov.uk / legislation.gov.uk / FSS)', () => {
  // safety-critical claims link direct to primary sources, not secondary hospitality sites
  assert.ok(HTML.includes('gov.uk/government/publications/safer-food-better-business-sfbb'));
  assert.ok(HTML.includes('gov.uk/government/publications/cooking-your-food'));
  assert.ok(HTML.includes('gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely'));
  assert.ok(HTML.includes('gov.uk/government/publications/managing-food-safety'));
  assert.ok(HTML.includes('legislation.gov.uk/uksi/2013/2996/schedule/4'));
  assert.ok(HTML.includes('legislation.gov.uk/ssi/2006/3/schedule/4'));      // Scotland 2006 regs
  assert.ok(HTML.includes('foodstandards.gov.scot'));
  assert.match(HTML, /Food Standards Agency[^<]{0,40}Cooking your food/i);
  assert.match(HTML, /Food Safety and Hygiene \(England\) Regulations 2013/);
  assert.match(HTML, /Food Hygiene \(Scotland\) Regulations 2006/);
  // no secondary hospitality/blog domains for safety claims
  assert.ok(!/highspeedtraining|foodalert|navitas|virtual-college|hospitalityexpert/i.test(HTML));
});

test('HTML: has valid page schema (WebPage + BreadcrumbList + FAQPage), no ratings', () => {
  const blocks = HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  assert.equal(blocks.length, 3);
  const types = blocks.map(b => JSON.parse(b.replace(/<\/?script[^>]*>/g, ''))['@type']);
  assert.deepEqual(types.sort(), ['BreadcrumbList', 'FAQPage', 'WebPage']);
  assert.ok(!/aggregateRating|"review"/i.test(HTML));
});

test('HTML: table row count matches the announced entry count', () => {
  const rowCount = (HTML.match(/<tr data-category=/g) || []).length;
  assert.equal(rowCount, 23);
  assert.ok(HTML.includes('Showing all 23 entries'));
});

test('HTML: reference table is semantic (scope on all header cells, thead + tbody)', () => {
  assert.match(HTML, /<th scope="col">Food \/ process<\/th>/);
  assert.ok((HTML.match(/<th scope="row">/g) || []).length >= 23);
  assert.match(HTML, /<caption id="ftg-caption">/);
});
