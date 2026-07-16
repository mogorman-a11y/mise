// js/core/menu-dishes.js — shared resolver for menu → dishes.
//
// Three menu shapes coexist in this app: hand-built menus carry both
// `dishIds` and an embedded `dishes` array; AI-imported menus historically
// carried only `dishIds`; job-menu snapshots sometimes pre-expand `dishIds`
// into `dishes` at attach time. Multiple modules (Menus, Costing, HACCP,
// sync.js) each had their own inline dishIds→dishes lookup — this is the one
// implementation all of them should use instead of duplicating it.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Veriqo = root.Veriqo || {};
    root.Veriqo.resolveMenuDishes = factory().resolveMenuDishes;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  // menu: {dishes?: Dish[], dishIds?: string[]}
  // dishesById: {[id]: Dish} — only needed when menu has no embedded `dishes`.
  // Returns Dish[] — never throws, never returns null.
  function resolveMenuDishes(menu, dishesById) {
    if (!menu) return [];
    if (Array.isArray(menu.dishes) && menu.dishes.length) return menu.dishes;
    if (Array.isArray(menu.dishIds) && menu.dishIds.length && dishesById) {
      return menu.dishIds.map(function (id) { return dishesById[id]; }).filter(Boolean);
    }
    return [];
  }

  return { resolveMenuDishes: resolveMenuDishes };
});
