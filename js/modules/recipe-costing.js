// Recipe Costing — Costing rebuild Phase 2 (manual recipe entry in the dish editor).
// Supabase-only, no localStorage mirror — same pattern as prep.js. Additive to
// dishes: writes only to dish_recipes/recipe_ingredients/ingredients/
// ingredient_prices (Phase 1 schema), never to the dishes row itself.
// See Architecture Decisions.md: "Recipe costing is additive to dishes, not a
// rewrite of them...". Money is integer pence throughout, per that ADR.
// Relies on: supabaseClient, _esc/toast (menus.js). Hooked into the dish
// editor from menus.js's editDish()/_dishRowHTML().

var UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'each'];

var _recipeState = {};   // dishId -> { loading, error, recipe, lines: [...] }
var _recipeScaleTo = {}; // dishId -> portions currently previewed
var _ingredientsCache = null; // [{id, name, default_unit}]

function _convertQty(qty, fromUnit, toUnit) {
  if (fromUnit === toUnit) return qty;
  var WEIGHT = { g: 1, kg: 1000 };
  var VOL = { ml: 1, l: 1000 };
  if (WEIGHT[fromUnit] != null && WEIGHT[toUnit] != null) return qty * WEIGHT[fromUnit] / WEIGHT[toUnit];
  if (VOL[fromUnit] != null && VOL[toUnit] != null) return qty * VOL[fromUnit] / VOL[toUnit];
  return null; // incompatible units (e.g. "each" vs "g") — can't convert
}

function _lineCostPence(line) {
  if (!line.price) return null;
  var converted = _convertQty(line.quantity, line.unit, line.price.pack_unit);
  if (converted === null) return null;
  return (line.price.pack_price_pence / line.price.pack_size) * converted;
}

function _recipeTotals(dishId) {
  var st = _recipeState[dishId];
  var yieldPortions = (st && st.recipe && st.recipe.yield_portions) || 1;
  if (!st || !st.lines || !st.lines.length) {
    return { totalPence: 0, uncosted: 0, portionPence: 0, yieldPortions: yieldPortions };
  }
  var totalPence = 0, uncosted = 0;
  st.lines.forEach(function (line) {
    var c = _lineCostPence(line);
    if (c === null) uncosted++; else totalPence += c;
  });
  return { totalPence: totalPence, uncosted: uncosted, portionPence: totalPence / yieldPortions, yieldPortions: yieldPortions };
}

function _fmtPence(p) { return '£' + (Math.round(p) / 100).toFixed(2); }

async function _getUid() {
  var sess = await supabaseClient.auth.getSession();
  return sess && sess.data && sess.data.session && sess.data.session.user ? sess.data.session.user.id : null;
}

async function _ensureIngredientsCache() {
  if (_ingredientsCache) return _ingredientsCache;
  var r = await supabaseClient.from('ingredients').select('id,name,default_unit').order('name');
  _ingredientsCache = r.error ? [] : (r.data || []);
  return _ingredientsCache;
}

async function _latestPricesFor(ingredientIds) {
  var out = {};
  var uniq = ingredientIds.filter(function (id, i) { return ingredientIds.indexOf(id) === i; });
  if (!uniq.length) return out;
  var r = await supabaseClient.from('ingredient_prices').select('*').in('ingredient_id', uniq).order('recorded_at', { ascending: false });
  if (r.error || !r.data) return out;
  r.data.forEach(function (p) { if (!out[p.ingredient_id]) out[p.ingredient_id] = p; }); // first seen per id = latest
  return out;
}

async function _loadDishRecipe(dishId) {
  _recipeState[dishId] = { loading: true, recipe: null, lines: [] };
  _renderRecipePanel(dishId);
  try {
    await _ensureIngredientsCache();
    var recRes = await supabaseClient.from('dish_recipes').select('*').eq('dish_id', String(dishId)).maybeSingle();
    if (recRes.error) throw recRes.error;
    var recipe = recRes.data;
    var lines = [];
    if (recipe) {
      var riRes = await supabaseClient.from('recipe_ingredients')
        .select('*, ingredient:ingredients(id,name,default_unit)')
        .eq('dish_recipe_id', recipe.id)
        .order('sort_order');
      if (riRes.error) throw riRes.error;
      var ingredientIds = (riRes.data || []).map(function (r) { return r.ingredient_id; });
      var pricesByIngredient = await _latestPricesFor(ingredientIds);
      lines = (riRes.data || []).map(function (r) {
        return {
          id: r.id,
          ingredient_id: r.ingredient_id,
          name: r.ingredient ? r.ingredient.name : '(unknown)',
          quantity: Number(r.quantity),
          unit: r.unit,
          price: pricesByIngredient[r.ingredient_id] || null
        };
      });
    }
    _recipeState[dishId] = { loading: false, recipe: recipe, lines: lines };
  } catch (e) {
    console.error('[RecipeCosting] load failed:', e);
    _recipeState[dishId] = { loading: false, recipe: null, lines: [], error: e.message || 'Failed to load recipe' };
  }
  _renderRecipePanel(dishId);
}

async function _findOrCreateIngredient(name, defaultUnit, uidVal) {
  var cache = await _ensureIngredientsCache();
  var existing = cache.find(function (i) { return i.name.toLowerCase() === name.toLowerCase(); });
  if (existing) return existing;
  var ins = await supabaseClient.from('ingredients').insert({ name: name, user_id: uidVal, default_unit: defaultUnit || 'g' }).select().single();
  if (ins.error) throw ins.error;
  cache.push(ins.data);
  return ins.data;
}

async function _ensureDishRecipe(dishId) {
  var st = _recipeState[dishId];
  if (st.recipe) return st.recipe;
  var sel = await supabaseClient.from('dish_recipes').select('*').eq('dish_id', String(dishId)).maybeSingle();
  if (sel.error) throw sel.error;
  if (sel.data) return sel.data;
  var ins = await supabaseClient.from('dish_recipes').insert({ dish_id: String(dishId), yield_portions: 1 }).select().single();
  if (ins.error) throw ins.error;
  return ins.data;
}

async function addRecipeIngredientLine(dishId) {
  var nameEl = document.getElementById('ri-name-' + dishId);
  var qtyEl = document.getElementById('ri-qty-' + dishId);
  var unitEl = document.getElementById('ri-unit-' + dishId);
  var priceEl = document.getElementById('ri-price-' + dishId);
  var packSizeEl = document.getElementById('ri-packsize-' + dishId);
  var packUnitEl = document.getElementById('ri-packunit-' + dishId);
  if (!nameEl || !qtyEl || !unitEl || !priceEl || !packSizeEl || !packUnitEl) return;

  var name = (nameEl.value || '').trim();
  var quantity = parseFloat(qtyEl.value);
  var unit = unitEl.value;
  var packPrice = parseFloat(priceEl.value);
  var packSize = parseFloat(packSizeEl.value);
  var packUnit = packUnitEl.value;

  if (!name) { toast('Ingredient name required', 'err'); return; }
  if (!(quantity > 0)) { toast('Enter a quantity', 'err'); return; }
  if (!(packPrice >= 0) || !(packSize > 0)) { toast('Enter a pack price and size', 'err'); return; }

  try {
    var uidVal = await _getUid();
    if (!uidVal) { toast('Not signed in', 'err'); return; }

    var ingredient = await _findOrCreateIngredient(name, unit, uidVal);
    var recipe = await _ensureDishRecipe(dishId);

    var priceIns = await supabaseClient.from('ingredient_prices').insert({
      ingredient_id: ingredient.id,
      pack_price_pence: Math.round(packPrice * 100),
      pack_size: packSize,
      pack_unit: packUnit,
      source: 'manual',
      created_by: uidVal
    }).select().single();
    if (priceIns.error) throw priceIns.error;

    var st = _recipeState[dishId];
    var lineIns = await supabaseClient.from('recipe_ingredients').insert({
      dish_recipe_id: recipe.id,
      ingredient_id: ingredient.id,
      quantity: quantity,
      unit: unit,
      sort_order: st.lines.length
    }).select().single();
    if (lineIns.error) throw lineIns.error;

    st.recipe = recipe;
    st.lines.push({
      id: lineIns.data.id,
      ingredient_id: ingredient.id,
      name: ingredient.name,
      quantity: quantity,
      unit: unit,
      price: priceIns.data
    });

    nameEl.value = ''; qtyEl.value = ''; priceEl.value = ''; packSizeEl.value = '';
    _renderRecipePanel(dishId);
    toast('Ingredient added ✓');
  } catch (e) {
    console.error('[RecipeCosting] add line failed:', e);
    toast('Failed: ' + (e.message || 'Unknown error'), 'err');
  }
}

async function deleteRecipeIngredientLine(dishId, lineId) {
  try {
    var r = await supabaseClient.from('recipe_ingredients').delete().eq('id', lineId);
    if (r.error) throw r.error;
    var st = _recipeState[dishId];
    st.lines = st.lines.filter(function (l) { return String(l.id) !== String(lineId); });
    _renderRecipePanel(dishId);
  } catch (e) {
    console.error('[RecipeCosting] delete line failed:', e);
    toast('Failed to remove: ' + (e.message || 'Unknown error'), 'err');
  }
}

async function updateYieldPortions(dishId, value) {
  var n = parseInt(value, 10);
  if (!(n > 0)) { toast('Yield must be at least 1 portion', 'err'); _renderRecipePanel(dishId); return; }
  try {
    var recipe = await _ensureDishRecipe(dishId);
    var r = await supabaseClient.from('dish_recipes').update({ yield_portions: n, updated_at: new Date().toISOString() }).eq('id', recipe.id).select().single();
    if (r.error) throw r.error;
    _recipeState[dishId].recipe = r.data;
    _recipeScaleTo[dishId] = n;
    _renderRecipePanel(dishId);
  } catch (e) {
    console.error('[RecipeCosting] update yield failed:', e);
    toast('Failed: ' + (e.message || 'Unknown error'), 'err');
  }
}

function previewScale(dishId, value) {
  var n = parseFloat(value);
  _recipeScaleTo[dishId] = (n > 0) ? n : 1;
  var totals = _recipeTotals(dishId);
  var span = document.getElementById('ri-scaled-result-' + dishId);
  if (span) span.textContent = _fmtPence(totals.portionPence * _recipeScaleTo[dishId]);
}

function _recipeIngredientRowHTML(dishId, line) {
  var costPence = _lineCostPence(line);
  var costText = costPence === null
    ? '<span style="color:#C05A18">no price / unit mismatch</span>'
    : _fmtPence(costPence);
  return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:7px 10px;background:#fff;border-radius:7px;border:1px solid #F0EDE8;font-size:12px">'
    + '<div style="flex:1;min-width:0">' + _esc(line.name) + '<div style="color:#A09890">' + line.quantity + ' ' + _esc(line.unit) + '</div></div>'
    + '<div style="text-align:right;min-width:70px;flex-shrink:0">' + costText + '</div>'
    + '<button onclick="event.stopPropagation();deleteRecipeIngredientLine(\'' + dishId + '\',\'' + line.id + '\')" style="background:none;border:none;color:#C0BDB5;font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>'
    + '</div>';
}

function _renderRecipePanel(dishId) {
  var el = document.getElementById('recipe-costing-body-' + dishId);
  if (!el) return;
  var st = _recipeState[dishId];
  if (!st || st.loading) { el.innerHTML = '<p style="font-size:12px;color:#A09890;padding:4px 0">Loading…</p>'; return; }
  if (st.error) { el.innerHTML = '<p style="font-size:12px;color:#8A2D2D;padding:4px 0">' + _esc(st.error) + '</p>'; return; }

  var totals = _recipeTotals(dishId);
  var scaleTo = _recipeScaleTo[dishId] || totals.yieldPortions;
  var scaledPence = totals.portionPence * scaleTo;
  var unitOptionsHtml = UNIT_OPTIONS.map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join('');
  var datalistHtml = '<datalist id="ingredients-datalist">' + (_ingredientsCache || []).map(function (i) { return '<option value="' + _esc(i.name) + '">'; }).join('') + '</datalist>';

  el.innerHTML = datalistHtml
    + '<div style="margin-bottom:8px">' + st.lines.map(function (line) { return _recipeIngredientRowHTML(dishId, line); }).join('') + '</div>'
    + '<div style="display:flex;gap:5px;align-items:stretch;margin-bottom:6px">'
    + '<input id="ri-name-' + dishId + '" list="ingredients-datalist" type="text" placeholder="Ingredient…" style="flex:1.4;padding:7px 9px;border:1px solid #D0C8BE;border-radius:7px;font-size:13px;font-family:inherit;min-width:0" onclick="event.stopPropagation()">'
    + '<input id="ri-qty-' + dishId + '" type="number" step="any" min="0" placeholder="Qty" style="width:56px;padding:7px 9px;border:1px solid #D0C8BE;border-radius:7px;font-size:13px;font-family:inherit" onclick="event.stopPropagation()">'
    + '<select id="ri-unit-' + dishId + '" style="padding:7px 4px;border:1px solid #D0C8BE;border-radius:7px;font-size:12px;font-family:inherit" onclick="event.stopPropagation()">' + unitOptionsHtml + '</select>'
    + '</div>'
    + '<div style="display:flex;gap:5px;align-items:center;margin-bottom:10px;flex-wrap:wrap">'
    + '<span style="font-size:11px;color:#A09890">Pack price £</span>'
    + '<input id="ri-price-' + dishId + '" type="number" step="0.01" min="0" placeholder="0.00" style="width:60px;padding:7px 9px;border:1px solid #D0C8BE;border-radius:7px;font-size:13px;font-family:inherit" onclick="event.stopPropagation()">'
    + '<span style="font-size:11px;color:#A09890">per</span>'
    + '<input id="ri-packsize-' + dishId + '" type="number" step="any" min="0" placeholder="size" style="width:50px;padding:7px 9px;border:1px solid #D0C8BE;border-radius:7px;font-size:13px;font-family:inherit" onclick="event.stopPropagation()">'
    + '<select id="ri-packunit-' + dishId + '" style="padding:7px 4px;border:1px solid #D0C8BE;border-radius:7px;font-size:12px;font-family:inherit" onclick="event.stopPropagation()">' + unitOptionsHtml + '</select>'
    + '<button onclick="event.stopPropagation();addRecipeIngredientLine(\'' + dishId + '\')" style="padding:7px 12px;background:#3A7D44;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Add</button>'
    + '</div>'
    + '<div style="padding-top:8px;border-top:1px solid #E8E2D8;font-size:12px;color:#1C2B1E">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span>Yield</span>'
    + '<span><input id="ri-yield-' + dishId + '" type="number" min="1" step="1" value="' + totals.yieldPortions + '" onclick="event.stopPropagation()" onchange="updateYieldPortions(\'' + dishId + '\',this.value)" style="width:50px;padding:3px 6px;border:1px solid #D0C8BE;border-radius:5px;font-size:12px;font-family:inherit"> portions</span></div>'
    + '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Total recipe cost</span><span>' + _fmtPence(totals.totalPence) + (totals.uncosted ? ' <span style="color:#C05A18">(' + totals.uncosted + ' uncosted)</span>' : '') + '</span></div>'
    + '<div style="display:flex;justify-content:space-between;font-weight:600"><span>Cost / portion</span><span>' + _fmtPence(totals.portionPence) + '</span></div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid #E8E2D8;font-size:12px">'
    + '<span>Scale to</span>'
    + '<input id="ri-scale-' + dishId + '" type="number" min="1" step="1" value="' + scaleTo + '" onclick="event.stopPropagation()" oninput="previewScale(\'' + dishId + '\',this.value)" style="width:50px;padding:3px 6px;border:1px solid #D0C8BE;border-radius:5px;font-size:12px;font-family:inherit">'
    + '<span>portions → <strong id="ri-scaled-result-' + dishId + '">' + _fmtPence(scaledPence) + '</strong></span>'
    + '</div>';
}
