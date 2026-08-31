// tests/pricing-calculator.test.js — run with: node --test tests/
//
// Covers the pure pricing math behind /private-chef-pricing-calculator.
// The selling price must be derived as cost / (1 - margin), never cost * (1 + margin).
const test = require('node:test');
const assert = require('node:assert/strict');

const calc = require('../js/pricing-calculator.js');
const { computePricing, toNumber, formatGBP, formatPct } = calc;

// Helper: a job whose cost-before-profit is exactly £400 (no owner hours).
function costBase400(extra) {
  return Object.assign({
    guests: 1,
    ingredientCost: 400,
    prepHours: 0, serviceHours: 0, adminHours: 0, hourlyRate: 0,
    travelCost: 0, staffCost: 0, otherCosts: 0,
    targetMarginPct: 0
  }, extra || {});
}

test('20% margin: £400 cost base → £500 selling price (not £480)', () => {
  const r = computePricing(costBase400({ targetMarginPct: 20 }));
  assert.equal(r.ok, true);
  assert.equal(r.costBeforeProfit, 400);
  assert.equal(r.sellingPriceNet, 500);
  assert.equal(r.grossContribution, 100);
  assert.notEqual(r.sellingPriceNet, 480); // the wrong (markup) answer
});

test('30% margin: £400 cost base → £571.43 selling price', () => {
  const r = computePricing(costBase400({ targetMarginPct: 30 }));
  assert.ok(Math.abs(r.sellingPriceNet - 4000 / 7) < 1e-9);
  assert.equal(Math.round(r.sellingPriceNet * 100) / 100, 571.43);
  assert.ok(Math.abs(r.grossContribution - (r.sellingPriceNet - 400)) < 1e-9);
});

test('0% margin: selling price equals cost base, contribution and markup are zero', () => {
  const r = computePricing(costBase400({ targetMarginPct: 0 }));
  assert.equal(r.sellingPriceNet, 400);
  assert.equal(r.grossContribution, 0);
  assert.equal(r.impliedMarkupPct, 0);
});

test('zero optional costs: only ingredients + margin drive the price', () => {
  const r = computePricing({ guests: 4, ingredientCost: 200, targetMarginPct: 25 });
  assert.equal(r.directCosts, 200);
  assert.equal(r.ownerLabour, 0);
  assert.equal(r.ownerHours, 0);
  assert.equal(r.costBeforeProfit, 200);
  assert.equal(r.sellingPriceNet, 200 / 0.75);
  assert.equal(r.revenuePerOwnerHour, null); // no owner hours → not Infinity
});

test('labour calculation: owner hours sum × hourly rate', () => {
  const r = computePricing({
    guests: 8, ingredientCost: 240,
    prepHours: 3, serviceHours: 4, adminHours: 1, hourlyRate: 30,
    targetMarginPct: 0
  });
  assert.equal(r.ownerHours, 8);
  assert.equal(r.ownerLabour, 240);
  assert.equal(r.costBeforeProfit, 480); // 240 direct + 240 labour
  assert.equal(r.sellingPriceNet, 480);
});

test('multiple guests: per-guest figures divide by covers', () => {
  const r = computePricing({
    guests: 8, ingredientCost: 320,
    prepHours: 4, serviceHours: 4, hourlyRate: 25,
    travelCost: 40, targetMarginPct: 20
  });
  // direct 360, labour 200, base 560, price 560/0.8 = 700
  assert.equal(r.costBeforeProfit, 560);
  assert.equal(r.sellingPriceNet, 700);
  assert.equal(r.pricePerGuest, 700 / 8);
  assert.equal(r.ingredientCostPerGuest, 40);
});

test('food cost percentage is ingredient cost over NET selling price', () => {
  const r = computePricing({ guests: 6, ingredientCost: 300, targetMarginPct: 40 });
  const price = 300 / 0.6; // 500
  assert.equal(r.sellingPriceNet, price);
  assert.ok(Math.abs(r.foodCostPct - (300 / price) * 100) < 1e-9);
  assert.equal(Math.round(r.foodCostPct), 60);
});

test('effective revenue per owner hour = net price ÷ owner hours', () => {
  const r = computePricing({
    guests: 10, ingredientCost: 400,
    prepHours: 5, serviceHours: 5, hourlyRate: 20,
    targetMarginPct: 0
  });
  // base = 400 + 200 = 600, price = 600, hours = 10
  assert.equal(r.revenuePerOwnerHour, 60);
});

test('empty / invalid inputs do not throw and fall back sensibly', () => {
  const r = computePricing({ guests: '', ingredientCost: 'abc', hourlyRate: null, targetMarginPct: '' });
  assert.equal(r.ok, true);
  assert.equal(r.guests, 1);            // clamped up from empty/0
  assert.equal(r.ingredientCost, 0);
  assert.equal(r.costBeforeProfit, 0);
  assert.equal(r.sellingPriceNet, 0);
  assert.equal(r.foodCostPct, 0);       // no divide-by-zero
});

test('computePricing({}) is safe', () => {
  const r = computePricing({});
  assert.equal(r.ok, true);
  assert.equal(r.sellingPriceNet, 0);
});

test('negative costs / hours / rate are clamped to zero', () => {
  const r = computePricing({
    guests: -3, ingredientCost: -100, prepHours: -2, hourlyRate: -50,
    travelCost: -10, targetMarginPct: -5
  });
  assert.equal(r.guests, 1);
  assert.equal(r.ingredientCost, 0);
  assert.equal(r.ownerHours, 0);
  assert.equal(r.travelCost, 0);
  assert.equal(r.targetMarginPct, 0); // negative margin clamped to 0
  assert.equal(r.sellingPriceNet, 0);
});

test('very high but valid margin (99%, 99.9%) stays finite', () => {
  const r99 = computePricing(costBase400({ targetMarginPct: 99 }));
  assert.equal(r99.ok, true);
  assert.ok(Number.isFinite(r99.sellingPriceNet));
  assert.ok(Math.abs(r99.sellingPriceNet - 40000) < 1e-6);   // 400 / (1 - 0.99), fp tolerant

  const r999 = computePricing(costBase400({ targetMarginPct: 99.9 }));
  assert.ok(Number.isFinite(r999.sellingPriceNet));
  assert.ok(Math.abs(r999.sellingPriceNet - 400000) < 1e-3); // 400 / (1 - 0.999)
});

test('margin of exactly 100% or more is rejected, never Infinity/NaN', () => {
  for (const m of [100, 100.0001, 150, 1000]) {
    const r = computePricing(costBase400({ targetMarginPct: m }));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'margin_too_high');
  }
});

test('guests of 0 / blank cannot cause divide-by-zero in per-guest figures', () => {
  const r = computePricing({ guests: 0, ingredientCost: 100, targetMarginPct: 50 });
  assert.equal(r.guests, 1);
  assert.ok(Number.isFinite(r.pricePerGuest));
  assert.ok(Number.isFinite(r.ingredientCostPerGuest));
});

test('implied markup is derived from margin correctly (20% margin → 25% markup)', () => {
  const r = computePricing(costBase400({ targetMarginPct: 20 }));
  assert.ok(Math.abs(r.impliedMarkupPct - 25) < 1e-9);
});

test('VAT off by default: no VAT figures', () => {
  const r = computePricing(costBase400({ targetMarginPct: 20 }));
  assert.equal(r.vat, null);
});

test('VAT on: net + VAT + customer total, rate is configurable', () => {
  const r = computePricing(costBase400({ targetMarginPct: 20, vatRegistered: true, vatRatePct: 20 }));
  assert.equal(r.sellingPriceNet, 500);
  assert.equal(r.vat.registered, true);
  assert.equal(r.vat.ratePct, 20);
  assert.equal(r.vat.amount, 100);
  assert.equal(r.vat.customerTotal, 600);
});

test('VAT on with 0% rate: customer total equals net', () => {
  const r = computePricing(costBase400({ targetMarginPct: 0, vatRegistered: true, vatRatePct: 0 }));
  assert.equal(r.vat.amount, 0);
  assert.equal(r.vat.customerTotal, r.sellingPriceNet);
});

test('VAT rate defaults to the UK standard rate when registered but rate left blank', () => {
  const r = computePricing(costBase400({ targetMarginPct: 0, vatRegistered: true, vatRatePct: '' }));
  assert.equal(r.vat.ratePct, calc.UK_STANDARD_VAT_RATE);
  assert.equal(calc.UK_STANDARD_VAT_RATE, 20);
});

test('internal precision is preserved (result is not pre-rounded to pounds)', () => {
  const r = computePricing(costBase400({ targetMarginPct: 30 }));
  assert.notEqual(r.sellingPriceNet, 571);
  assert.notEqual(r.sellingPriceNet, 571.43);
  assert.ok(r.sellingPriceNet > 571.42 && r.sellingPriceNet < 571.43);
});

test('toNumber: coercion, clamping and fallback', () => {
  assert.equal(toNumber('1,234.5'), 1234.5);
  assert.equal(toNumber('abc', 7), 7);
  assert.equal(toNumber('', 0), 0);
  assert.equal(toNumber(-5, 0, 0), 0);        // min clamp
  assert.equal(toNumber(250, 0, 0, 100), 100); // max clamp
  assert.equal(toNumber(undefined, 3), 3);
  assert.equal(toNumber(Infinity, 9), 9);
});

test('formatGBP / formatPct: no locale dependency, sensible rounding', () => {
  assert.equal(formatGBP(500), '£500');
  assert.equal(formatGBP(1234.5), '£1,235');
  assert.equal(formatGBP(571.4285, 2), '£571.43');
  assert.equal(formatGBP(0), '£0');
  assert.equal(formatGBP(-40), '−£40');
  assert.equal(formatPct(59.99), '60.0%');
  assert.equal(formatPct(25, 0), '25%');
});
