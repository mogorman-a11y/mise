// js/pricing-calculator.js
// Pure pricing math for the public /private-chef-pricing-calculator page,
// plus the browser-only DOM wiring for that page.
//
// PRIVACY: every value entered stays in the browser. This file makes no
// network calls and records nothing to analytics. Do not add either.
//
// The core selling-price formula is the same one used elsewhere in Veriqo
// (see js/core/gp-math.js priceForTargetGP): price = cost / (1 - margin).
// Margin is NOT added to cost as a flat percentage.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Veriqo = root.Veriqo || {};
    root.Veriqo.pricingCalculator = api;
  }
  // Browser-only: wire the calculator form once the DOM is ready.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { api._initDom(document); });
    } else {
      api._initDom(document);
    }
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var UK_STANDARD_VAT_RATE = 20; // per HMRC at time of writing; editable in the UI.

  // Coerce anything to a finite number, clamped to [min, max], else `fallback`.
  function toNumber(value, fallback, min, max) {
    if (fallback === undefined) fallback = 0;
    var n = typeof value === 'number' ? value : parseFloat(String(value == null ? '' : value).replace(/[, ]+/g, ''));
    if (!isFinite(n)) n = fallback;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }

  // input: {
  //   guests, ingredientCost, prepHours, serviceHours, adminHours, hourlyRate,
  //   travelCost, staffCost, otherCosts, targetMarginPct,
  //   vatRegistered (bool), vatRatePct
  // }
  // Returns { ok:true, ...figures } or { ok:false, error }.
  function computePricing(input) {
    input = input || {};

    var guests = Math.max(1, Math.round(toNumber(input.guests, 1, 1)));
    var ingredientCost = toNumber(input.ingredientCost, 0, 0);
    var travelCost = toNumber(input.travelCost, 0, 0);
    var staffCost = toNumber(input.staffCost, 0, 0);
    var otherCosts = toNumber(input.otherCosts, 0, 0);

    var prepHours = toNumber(input.prepHours, 0, 0);
    var serviceHours = toNumber(input.serviceHours, 0, 0);
    var adminHours = toNumber(input.adminHours, 0, 0);
    var hourlyRate = toNumber(input.hourlyRate, 0, 0);

    // Margin: clamp a negative to 0; a value of 100%+ is mathematically
    // impossible (price would be infinite) so it is rejected, not clamped.
    var marginPct = toNumber(input.targetMarginPct, 0, 0);
    if (marginPct >= 100) {
      return { ok: false, error: 'margin_too_high' };
    }
    var m = marginPct / 100;

    var directCosts = round2(ingredientCost + travelCost + staffCost + otherCosts);
    var ownerHours = round2(prepHours + serviceHours + adminHours);
    var ownerLabour = round2(ownerHours * hourlyRate);
    var costBeforeProfit = round2(directCosts + ownerLabour);

    // price = cost / (1 - margin). Denominator is always > 0 here because
    // marginPct < 100 is enforced above.
    var sellingPriceNet = costBeforeProfit <= 0 ? 0 : costBeforeProfit / (1 - m);

    var pricePerGuest = sellingPriceNet / guests;
    var ingredientCostPerGuest = ingredientCost / guests;
    var foodCostPct = sellingPriceNet > 0 ? (ingredientCost / sellingPriceNet) * 100 : 0;
    var grossContribution = sellingPriceNet - costBeforeProfit; // == sellingPriceNet * m
    var revenuePerOwnerHour = ownerHours > 0 ? sellingPriceNet / ownerHours : null;
    var impliedMarkupPct = m < 1 && costBeforeProfit > 0 ? (m / (1 - m)) * 100 : 0;

    var vat = null;
    if (input.vatRegistered) {
      var vatRatePct = toNumber(input.vatRatePct, UK_STANDARD_VAT_RATE, 0, 100);
      var vatAmount = sellingPriceNet * (vatRatePct / 100);
      vat = {
        registered: true,
        ratePct: vatRatePct,
        amount: vatAmount,
        customerTotal: sellingPriceNet + vatAmount
      };
    }

    return {
      ok: true,
      guests: guests,
      ingredientCost: ingredientCost,
      travelCost: travelCost,
      staffCost: staffCost,
      otherCosts: otherCosts,
      directCosts: directCosts,
      ownerHours: ownerHours,
      hourlyRate: hourlyRate,
      ownerLabour: ownerLabour,
      costBeforeProfit: costBeforeProfit,
      targetMarginPct: marginPct,
      impliedMarkupPct: impliedMarkupPct,
      sellingPriceNet: sellingPriceNet,
      pricePerGuest: pricePerGuest,
      ingredientCostPerGuest: ingredientCostPerGuest,
      foodCostPct: foodCostPct,
      grossContribution: grossContribution,
      revenuePerOwnerHour: revenuePerOwnerHour,
      vat: vat
    };
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // £ formatting with thousands separators, no Intl/ICU dependency.
  function formatGBP(value, dp) {
    dp = dp === undefined ? 0 : dp;
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    n = Math.abs(n);
    var parts = n.toFixed(dp).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−£' : '£') + parts.join('.');
  }

  function formatPct(value, dp) {
    dp = dp === undefined ? 1 : dp;
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return n.toFixed(dp) + '%';
  }

  // ---- Browser-only DOM wiring -------------------------------------------------
  function _initDom(doc) {
    var form = doc.getElementById('pcpc-form');
    if (!form) return;

    var ids = [
      'guests', 'ingredientCost', 'prepHours', 'serviceHours', 'adminHours',
      'hourlyRate', 'travelCost', 'staffCost', 'otherCosts', 'targetMarginPct',
      'vatRegistered', 'vatRatePct'
    ];
    var els = {};
    ids.forEach(function (id) { els[id] = doc.getElementById('pcpc-' + id); });

    var vatRow = doc.getElementById('pcpc-vat-rate-row');
    var errBox = doc.getElementById('pcpc-error');
    var out = doc.getElementById('pcpc-results');

    function readInputs() {
      return {
        guests: els.guests && els.guests.value,
        ingredientCost: els.ingredientCost && els.ingredientCost.value,
        prepHours: els.prepHours && els.prepHours.value,
        serviceHours: els.serviceHours && els.serviceHours.value,
        adminHours: els.adminHours && els.adminHours.value,
        hourlyRate: els.hourlyRate && els.hourlyRate.value,
        travelCost: els.travelCost && els.travelCost.value,
        staffCost: els.staffCost && els.staffCost.value,
        otherCosts: els.otherCosts && els.otherCosts.value,
        targetMarginPct: els.targetMarginPct && els.targetMarginPct.value,
        vatRegistered: !!(els.vatRegistered && els.vatRegistered.checked),
        vatRatePct: els.vatRatePct && els.vatRatePct.value
      };
    }

    function setText(id, text) {
      var node = doc.getElementById(id);
      if (node) node.textContent = text;
    }

    function recalc() {
      if (vatRow && els.vatRegistered) {
        vatRow.hidden = !els.vatRegistered.checked;
      }

      var res = computePricing(readInputs());

      if (!res.ok) {
        if (errBox) {
          errBox.hidden = false;
          errBox.textContent = res.error === 'margin_too_high'
            ? 'A target margin of 100% or more isn’t possible — the price would be infinite. Enter a margin below 100%.'
            : 'Please check your inputs.';
        }
        if (out) out.setAttribute('data-state', 'error');
        if (els.targetMarginPct) els.targetMarginPct.setAttribute('aria-invalid', 'true');
        return;
      }

      if (errBox) { errBox.hidden = true; errBox.textContent = ''; }
      if (out) out.setAttribute('data-state', 'ok');
      if (els.targetMarginPct) els.targetMarginPct.removeAttribute('aria-invalid');

      setText('pcpc-r-price', formatGBP(res.sellingPriceNet));
      setText('pcpc-r-per-guest', formatGBP(res.pricePerGuest) + ' per guest');

      setText('pcpc-r-direct', formatGBP(res.directCosts));
      setText('pcpc-r-labour', formatGBP(res.ownerLabour)
        + ' (' + trimNum(res.ownerHours) + ' hrs × ' + formatGBP(res.hourlyRate) + ')');
      setText('pcpc-r-costbase', formatGBP(res.costBeforeProfit));
      setText('pcpc-r-margin', formatPct(res.targetMarginPct, 0));
      setText('pcpc-r-markup', formatPct(res.impliedMarkupPct, 0));
      setText('pcpc-r-price2', formatGBP(res.sellingPriceNet));
      setText('pcpc-r-per-guest2', formatGBP(res.pricePerGuest));

      setText('pcpc-r-ingredient', formatGBP(res.ingredientCost));
      setText('pcpc-r-ingredient-guest', formatGBP(res.ingredientCostPerGuest));
      setText('pcpc-r-foodcost', formatPct(res.foodCostPct, 1));
      setText('pcpc-r-contribution', formatGBP(res.grossContribution));
      setText('pcpc-r-owner-hours', trimNum(res.ownerHours) + ' hrs');
      setText('pcpc-r-rev-per-hour',
        res.revenuePerOwnerHour == null ? '— (no owner hours entered)' : formatGBP(res.revenuePerOwnerHour) + ' / hr');

      var vatBlock = doc.getElementById('pcpc-vat-block');
      if (vatBlock) {
        if (res.vat) {
          vatBlock.hidden = false;
          setText('pcpc-r-net', formatGBP(res.sellingPriceNet));
          setText('pcpc-r-vat', formatGBP(res.vat.amount) + ' (VAT at ' + formatPct(res.vat.ratePct, res.vat.ratePct % 1 ? 1 : 0) + ')');
          setText('pcpc-r-customer-total', formatGBP(res.vat.customerTotal));
        } else {
          vatBlock.hidden = true;
        }
      }
    }

    function trimNum(n) {
      return (Math.round(n * 100) / 100).toString();
    }

    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    form.addEventListener('submit', function (e) { e.preventDefault(); recalc(); });

    var clearBtn = doc.getElementById('pcpc-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        ids.forEach(function (id) {
          var el = els[id];
          if (!el) return;
          if (el.type === 'checkbox') el.checked = false;
          else el.value = '';
        });
        recalc();
        if (els.guests) els.guests.focus();
      });
    }

    recalc(); // show results immediately on load
  }

  return {
    computePricing: computePricing,
    toNumber: toNumber,
    formatGBP: formatGBP,
    formatPct: formatPct,
    UK_STANDARD_VAT_RATE: UK_STANDARD_VAT_RATE,
    _initDom: _initDom
  };
});
