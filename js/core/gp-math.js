// js/core/gp-math.js — shared gross-profit / markup math, in pence.
// Same markup formula costing.js's calcCostingFoodPct already uses
// (quote = totalCost / (1 - margin)), extracted so it's reusable from
// js/modules/ai-estimate.js and unit-testable without a DOM.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Veriqo = root.Veriqo || {};
    var api = factory();
    root.Veriqo.priceForTargetGP = api.priceForTargetGP;
    root.Veriqo.gpForPrice = api.gpForPrice;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  // totalCostPence: all-in cost (food + other direct costs), in pence.
  // gpPercent: target gross profit, e.g. 65 for 65%.
  // Returns the price (pence) that yields that GP, or null if gpPercent >= 100
  // (mathematically impossible — would require infinite price).
  function priceForTargetGP(totalCostPence, gpPercent) {
    var gp = Number(gpPercent) / 100;
    if (!(gp < 1)) return null;
    if (!totalCostPence || totalCostPence <= 0) return 0;
    return Math.round(totalCostPence / (1 - gp));
  }

  // Inverse: given a price the user actually entered, what GP% does it give?
  function gpForPrice(totalCostPence, pricePence) {
    if (!pricePence || pricePence <= 0) return 0;
    return Math.round(((pricePence - (totalCostPence || 0)) / pricePence) * 100);
  }

  return { priceForTargetGP: priceForTargetGP, gpForPrice: gpForPrice };
});
