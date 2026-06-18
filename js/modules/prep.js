// prep.js v1 — Prep List module for Veriqo
// Provides: index screen, list view (with tick), and generate-from-menu modal.
// Relies on: supabaseClient, mSettings (from menus.js), _esc (from menus.js),
//            TODAY (from menus.js), toast (from menus.js).

var _prepLists = [];          // in-memory cache of all prep lists
var _prepListViewId = null;   // null = show index; string = show this list

// ── Date formatter ─────────────────────────────────────────────────────────

function _fmtPrepDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr + 'T12:00:00');
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
}

function _fmtPrepDateLong(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr + 'T12:00:00');
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
}

// ── Index ──────────────────────────────────────────────────────────────────

function renderPrepIndex() {
  var indexEl  = document.getElementById('prep-index');
  var viewEl   = document.getElementById('prep-list-view');

  if (_prepListViewId) {
    // Returning to an already-open list view
    if (indexEl) indexEl.style.display = 'none';
    if (viewEl)  viewEl.style.display  = 'block';
    var backBtn = document.getElementById('menus-back-btn');
    if (backBtn) backBtn.onclick = closePrepListView;
    return;
  }

  if (viewEl)  viewEl.style.display  = 'none';
  if (indexEl) indexEl.style.display = 'block';

  if (!indexEl) return;
  indexEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--vq-muted)">Loading…</div>';

  _loadPrepLists();
}

async function _loadPrepLists() {
  try {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      _prepLists = [];
      _renderPrepIndex();
      return;
    }
    var res = await supabaseClient.from('prep_lists').select('*').order('date', { ascending: false });
    if (res.error) throw res.error;
    _prepLists = res.data || [];
  } catch (e) {
    console.error('[Prep] load failed:', e);
    _prepLists = [];
  }
  _renderPrepIndex();
}

function _renderPrepIndex() {
  var el = document.getElementById('prep-index');
  if (!el) return;

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<div style="font-size:18px;font-weight:800;color:var(--vq-ink);letter-spacing:-0.3px">Prep Lists</div>'
    + '<button onclick="openGeneratePrepListModal()" style="background:#F97316;color:#fff;border:none;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg> New List</button>'
    + '</div>';

  if (_prepLists.length === 0) {
    html += '<div style="text-align:center;padding:48px 20px">'
      + '<div style="font-size:44px;margin-bottom:14px">📋</div>'
      + '<div style="font-size:17px;font-weight:700;color:var(--vq-ink);margin-bottom:6px">No prep lists yet</div>'
      + '<div style="font-size:13px;color:var(--vq-muted);line-height:1.6;margin-bottom:22px">Generate a list from any menu — tasks from each dish are flattened into a tappable tick list for service.</div>'
      + '<button onclick="openGeneratePrepListModal()" style="background:#F97316;color:#fff;border:none;padding:13px 24px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Generate First Prep List</button>'
      + '</div>';
  } else {
    html += _prepLists.map(function(pl) {
      var items  = pl.items || [];
      var total  = items.length;
      var done   = items.filter(function(i) { return i.completed; }).length;
      var pct    = total > 0 ? Math.round(done / total * 100) : 0;
      var allDone = done === total && total > 0;
      var accentCol = allDone ? '#2D7A3A' : '#F97316';
      return '<div onclick="openPrepListView(\'' + pl.id + '\')" style="background:#fff;border:1px solid var(--vq-border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;-webkit-tap-highlight-color:transparent">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:15px;font-weight:700;color:var(--vq-ink);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(pl.name) + '</div>'
        + '<div style="font-size:12px;color:var(--vq-muted)">' + _esc(_fmtPrepDate(pl.date)) + '</div>'
        + '</div>'
        + '<div style="font-size:13px;font-weight:700;color:' + accentCol + ';flex-shrink:0;margin-left:12px;margin-top:2px">'
        + (allDone ? 'All done ✓' : done + '/' + total + ' done') + '</div>'
        + '</div>'
        + '<div style="height:6px;background:#F0EDE8;border-radius:3px;overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:' + accentCol + ';border-radius:3px"></div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  el.innerHTML = html;
}

// ── List View ──────────────────────────────────────────────────────────────

function openPrepListView(id) {
  _prepListViewId = id;
  var indexEl = document.getElementById('prep-index');
  var viewEl  = document.getElementById('prep-list-view');
  if (indexEl) indexEl.style.display = 'none';
  if (viewEl)  viewEl.style.display  = 'block';

  var backBtn = document.getElementById('menus-back-btn');
  if (backBtn) backBtn.onclick = closePrepListView;

  _renderPrepListView(id);
  window.scrollTo(0, 0);
}

function closePrepListView() {
  _prepListViewId = null;
  var indexEl = document.getElementById('prep-index');
  var viewEl  = document.getElementById('prep-list-view');
  if (viewEl)  viewEl.style.display  = 'none';
  if (indexEl) { indexEl.style.display = 'block'; _renderPrepIndex(); }

  var backBtn = document.getElementById('menus-back-btn');
  if (backBtn) backBtn.onclick = function() { showTab('home'); };

  window.scrollTo(0, 0);
}

function _renderPrepListView(id) {
  var pl = _prepLists.find(function(p) { return p.id === id; });
  var el = document.getElementById('prep-list-view');
  if (!el) return;
  if (!pl) { el.innerHTML = '<div style="padding:20px;color:var(--vq-muted)">List not found.</div>'; return; }

  var items      = pl.items || [];
  var total      = items.length;
  var done       = items.filter(function(i) { return i.completed; }).length;
  var pct        = total > 0 ? Math.round(done / total * 100) : 0;
  var allDone    = done === total && total > 0;
  var accentCol  = allDone ? '#2D7A3A' : '#F97316';
  var aheadItems = items.filter(function(i) { return i.section !== 'finishing'; });
  var finItems   = items.filter(function(i) { return i.section === 'finishing'; });

  var html = '<div style="margin-bottom:20px">'
    + '<div style="font-size:20px;font-weight:800;color:var(--vq-ink);margin-bottom:3px;letter-spacing:-0.3px">' + _esc(pl.name) + '</div>'
    + '<div style="font-size:13px;color:var(--vq-muted);margin-bottom:14px">' + _esc(_fmtPrepDateLong(pl.date)) + '</div>'
    + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:' + (allDone ? '10px' : '0') + '">'
    + '<div style="flex:1;height:10px;background:#F0EDE8;border-radius:5px;overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:' + accentCol + ';border-radius:5px;transition:width 0.4s"></div>'
    + '</div>'
    + '<div style="font-size:15px;font-weight:800;color:' + (allDone ? '#2D7A3A' : 'var(--vq-ink)') + ';white-space:nowrap">' + done + ' / ' + total + '</div>'
    + '</div>'
    + (allDone ? '<div style="text-align:center;padding:10px 0 4px;font-size:16px;font-weight:800;color:#2D7A3A">All done ✓</div>' : '')
    + '</div>';

  if (aheadItems.length > 0) html += _renderPrepSection(aheadItems, '🥄 Prep Ahead', id);
  if (finItems.length > 0)   html += _renderPrepSection(finItems,   '🔥 Finishing',  id);

  el.innerHTML = html;
}

function _renderPrepSection(items, label, listId) {
  var done = items.filter(function(i) { return i.completed; }).length;
  var html = '<div style="margin-bottom:24px">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
    + '<div style="font-size:16px;font-weight:700;color:var(--vq-ink)">' + label + '</div>'
    + '<div style="font-size:13px;color:var(--vq-muted);font-weight:600">' + done + '/' + items.length + '</div>'
    + '</div>';

  html += items.map(function(item) {
    var isDone = !!item.completed;
    return '<div onclick="tickPrepItem(\'' + listId + '\',\'' + item.id + '\')" '
      + 'style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:#fff;border:1px solid ' + (isDone ? '#C8E6CC' : 'var(--vq-border)') + ';border-radius:12px;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color 0.15s">'
      + '<div style="width:28px;height:28px;border-radius:50%;border:2px solid ' + (isDone ? '#2D7A3A' : '#C8C4BC') + ';background:' + (isDone ? '#2D7A3A' : 'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s">'
      + (isDone ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '')
      + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:15px;font-weight:' + (isDone ? '400' : '500') + ';color:' + (isDone ? '#A0A098' : 'var(--vq-ink)') + ';' + (isDone ? 'text-decoration:line-through;' : '') + '">' + _esc(item.description) + '</div>'
      + '<div style="font-size:12px;color:' + (isDone ? '#C0BDB5' : 'var(--vq-muted)') + ';margin-top:2px">' + _esc(item.dish_name) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  html += '</div>';
  return html;
}

async function tickPrepItem(listId, itemId) {
  var pl = _prepLists.find(function(p) { return p.id === listId; });
  if (!pl) return;
  var item = (pl.items || []).find(function(i) { return i.id === itemId; });
  if (!item) return;

  var wasCompleted = !!item.completed;
  item.completed = !wasCompleted;

  if (!wasCompleted) {
    item.completed_at = new Date().toISOString();
    try {
      var sess = await supabaseClient.auth.getSession();
      item.completed_by = sess.data.session && sess.data.session.user ? sess.data.session.user.id : null;
    } catch(e) { item.completed_by = null; }
  } else {
    item.completed_at = null;
    item.completed_by = null;
  }

  _renderPrepListView(listId);

  try {
    var r = await supabaseClient.from('prep_lists').update({ items: pl.items }).eq('id', listId);
    if (r.error) throw r.error;
  } catch(e) {
    // Revert on failure
    item.completed    = wasCompleted;
    item.completed_at = null;
    item.completed_by = null;
    _renderPrepListView(listId);
    if (typeof toast === 'function') toast('Sync failed — try again', 'err');
  }
}

// ── Generate Prep List Modal ───────────────────────────────────────────────

function openGeneratePrepListModal() {
  var modal = document.getElementById('generate-prep-modal');
  if (!modal) return;

  var menus   = (typeof mSettings !== 'undefined' && mSettings.savedMenus) ? mSettings.savedMenus : [];
  var menuSel = document.getElementById('prep-gen-menu');
  if (menuSel) {
    menuSel.innerHTML = '<option value="">Select a menu…</option>'
      + menus.map(function(m) {
          return '<option value="' + _esc(String(m.id)) + '">' + _esc(m.name) + '</option>';
        }).join('');
    menuSel.value = '';
  }

  var dateEl = document.getElementById('prep-gen-date');
  if (dateEl) dateEl.value = (typeof TODAY !== 'undefined') ? TODAY : '';

  var preview = document.getElementById('prep-gen-preview');
  if (preview) preview.innerHTML = '';

  var btn = document.getElementById('prep-gen-confirm');
  if (btn) { btn.textContent = 'Generate Prep List'; btn.disabled = false; }

  modal.style.display = 'flex';
}

function closeGeneratePrepListModal() {
  var modal = document.getElementById('generate-prep-modal');
  if (modal) modal.style.display = 'none';
}

function onPrepMenuChange() {
  var menuId  = (document.getElementById('prep-gen-menu')    || {}).value;
  var preview = document.getElementById('prep-gen-preview');
  if (!preview) return;
  if (!menuId) { preview.innerHTML = ''; return; }

  var menus  = (typeof mSettings !== 'undefined' && mSettings.savedMenus) ? mSettings.savedMenus : [];
  var dishes = (typeof mSettings !== 'undefined' && mSettings.savedDishes) ? mSettings.savedDishes : [];
  var menu   = menus.find(function(m) { return String(m.id) === String(menuId); });
  if (!menu) { preview.innerHTML = ''; return; }

  var taskCount = 0;
  var dishCount = 0;
  (menu.dishes || []).forEach(function(md) {
    var dish = dishes.find(function(d) { return d.dish === md.dish; });
    if (dish && Array.isArray(dish.prep_tasks) && dish.prep_tasks.length > 0) {
      taskCount += dish.prep_tasks.length;
      dishCount++;
    }
  });

  if (taskCount === 0) {
    preview.innerHTML = '<div style="font-size:13px;color:var(--vq-muted);margin-top:6px;line-height:1.5">'
      + 'None of this menu\'s dishes have prep tasks yet. '
      + '<button onclick="closeGeneratePrepListModal();showTab(\'menus\')" style="background:none;border:none;color:#F97316;font-size:13px;font-weight:700;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline">Go to Dish Library →</button>'
      + ' tap a dish and add tasks under <strong>Prep Tasks</strong>.</div>';
  } else {
    preview.innerHTML = '<div style="font-size:13px;color:#2D7A3A;font-weight:600;margin-top:6px">'
      + taskCount + ' task' + (taskCount !== 1 ? 's' : '') + ' across ' + dishCount + ' dish' + (dishCount !== 1 ? 'es' : '') + ' — ready to generate</div>';
  }
}

async function confirmGeneratePrepList() {
  var menuId = (document.getElementById('prep-gen-menu')    || {}).value;
  var date   = (document.getElementById('prep-gen-date')    || {}).value;
  var btn    =  document.getElementById('prep-gen-confirm');

  if (!menuId) { if (typeof toast === 'function') toast('Select a menu first', 'err'); return; }
  if (!date)   { if (typeof toast === 'function') toast('Select a date', 'err'); return; }

  var menus  = (typeof mSettings !== 'undefined' && mSettings.savedMenus)  ? mSettings.savedMenus  : [];
  var dishes = (typeof mSettings !== 'undefined' && mSettings.savedDishes) ? mSettings.savedDishes : [];
  var menu   = menus.find(function(m) { return String(m.id) === String(menuId); });
  if (!menu) return;

  var items = [];
  (menu.dishes || []).forEach(function(md) {
    var dish = dishes.find(function(d) { return d.dish === md.dish; });
    if (!dish || !Array.isArray(dish.prep_tasks) || dish.prep_tasks.length === 0) return;
    dish.prep_tasks.forEach(function(task) {
      items.push({
        id: 'pi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        dish_id: String(dish.id),
        dish_name: dish.dish,
        description: task.description,
        section: task.section || 'prep_ahead',
        completed: false,
        completed_at: null,
        completed_by: null
      });
    });
  });

  if (items.length === 0) {
    if (typeof toast === 'function') toast('No prep tasks found — add tasks to dishes first', 'warn');
    return;
  }

  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }

  var listName = menu.name + ' — ' + _fmtPrepDate(date);

  try {
    var r = await supabaseClient.from('prep_lists').insert({
      name: listName,
      menu_id: String(menuId),
      date: date,
      items: items
    }).select().single();

    if (r.error) throw r.error;

    _prepLists.unshift(r.data);
    closeGeneratePrepListModal();
    if (typeof toast === 'function') toast('Prep list created ✓');
    openPrepListView(r.data.id);
  } catch(e) {
    console.error('[Prep] insert failed:', e);
    if (typeof toast === 'function') toast('Failed: ' + (e.message || 'Unknown error'), 'err');
    if (btn) { btn.textContent = 'Generate Prep List'; btn.disabled = false; }
  }
}
