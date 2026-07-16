// js/core/allergens.js — single source of truth for the 14 UK regulated
// allergens. Works both as a browser global (window.Veriqo.ALLERGENS_14 /
// normalizeAllergen) and as a CommonJS module (require()'d from api/*.js).
//
// Canonical spelling matches HACCP's pre-existing list (UK FSA naming).
// Before this file existed, haccp.js, menus.js, api/ai-scan.js, and
// api/parse-menu.js each hardcoded their own copy, and two of them used
// different spellings for gluten and sulphites — so a guest with a declared
// gluten or sulphite allergy never matched against a dish tagged via Menus
// or AI import. Do not reintroduce a second copy of this list anywhere.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Veriqo = root.Veriqo || {};
    var api = factory();
    root.Veriqo.ALLERGENS_14 = api.ALLERGENS_14;
    root.Veriqo.normalizeAllergen = api.normalizeAllergen;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  var ALLERGENS_14 = [
    'Celery', 'Cereals containing gluten', 'Crustaceans', 'Eggs', 'Fish',
    'Lupin', 'Milk', 'Molluscs', 'Mustard', 'Nuts', 'Peanuts', 'Sesame',
    'Soya', 'Sulphur dioxide'
  ];

  // Maps any known spelling/case variant to the canonical string. Values not
  // recognized at all are returned unchanged (trimmed) rather than dropped —
  // an allergen a dish/guest was tagged with must never silently disappear,
  // even if this normalizer doesn't recognize the exact wording.
  function normalizeAllergen(a) {
    if (a === null || a === undefined) return a;
    var trimmed = String(a).trim();
    if (!trimmed) return trimmed;
    var lc = trimmed.toLowerCase();

    if (lc.indexOf('cereal') >= 0 || lc.indexOf('gluten') >= 0) return 'Cereals containing gluten';
    // Covers both British (sulph-) and American (sulf-) spellings of
    // sulphite/sulphate/sulphur dioxide in one check.
    if (lc.indexOf('sulph') >= 0 || lc.indexOf('sulf') >= 0) return 'Sulphur dioxide';

    for (var i = 0; i < ALLERGENS_14.length; i++) {
      if (ALLERGENS_14[i].toLowerCase() === lc) return ALLERGENS_14[i];
    }
    return trimmed;
  }

  return { ALLERGENS_14: ALLERGENS_14, normalizeAllergen: normalizeAllergen };
});
