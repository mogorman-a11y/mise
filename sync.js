// sync.js v12 — cloud sync (Supabase mirrors localStorage)
// Phase 2: dishes/menus now read from and written to shared row-based tables
// (clients, dishes, menus, menu_dishes) instead of JSONB cross-pull.
// Job mirroring via mise_records kept until Phase 3.
//
// On sign-in:  pull own settings + shared library → REPLACE localStorage → app reads normally
// On save:     push to Supabase → update localStorage
// On tab focus: re-pull so open tabs stay current

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;
  var _visibilityBound = false;

  function _resolveProfile() {
    if (window.Mise && window.Mise.profile) return window.Mise.profile;
    try { return JSON.parse(localStorage.getItem('veriqo_profile') || 'null'); } catch(e) { return null; }
  }

  function _applyProfileToSettings() {
    var profile = _resolveProfile();
    if (!profile) return;

    var hs;
    try {
      hs = typeof settings !== 'undefined' ? settings : JSON.parse(localStorage.getItem('haccp_settings') || '{}');
    } catch(e) { hs = {}; }
    if (!hs) hs = {};

    var changed = false;
    if (profile.business_name && hs.business_name !== profile.business_name) { hs.business_name = profile.business_name; changed = true; }
    if (profile.chef_name && hs.chef_name !== profile.chef_name) { hs.chef_name = profile.chef_name; changed = true; }
    if (profile.logo && hs.logo !== profile.logo) { hs.logo = profile.logo; changed = true; }

    if (!changed) return;
    try { localStorage.setItem('haccp_settings', JSON.stringify(hs)); } catch (e) {}
    if (typeof settings !== 'undefined') {
      Object.keys(hs).forEach(function(key) { settings[key] = hs[key]; });
    }
    if (typeof loadSettings === 'function') loadSettings();
  }

  // ── loadAll ────────────────────────────────────────────────────────────────
  async function loadAll(userId) {
    _userId = userId;
    console.log('[Veriqo sync] loadAll — userId:', userId);

    try {
      await Promise.all([
        _pullRecords(userId),
        _pullSettings(userId)
      ]);
      await _pullSharedJobs(userId);
      _applyProfileToSettings();
      _refreshAppViews();
      console.log('[Veriqo sync] ✓ full sync complete');
    } catch (err) {
      console.error('[Veriqo sync] loadAll error:', err.message || err);
    }

    if (!_visibilityBound) {
      _visibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && _userId) {
          Promise.all([_pullRecords(_userId), _pullSettings(_userId)])
            .then(function () { return _pullSharedJobs(_userId); })
            .then(_refreshAppViews)
            .catch(function () {});
        }
      });
    }
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) { console.warn('[Veriqo sync] saveDay skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('haccp_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ day saved:', dateStr);
      _refreshAppViews();
    } catch (err) {
      console.error('[Veriqo sync] saveDay failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — data saved locally only', 'err');
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  async function saveSettings(settingsObj) {
    if (!_userId) { console.warn('[Veriqo sync] saveSettings skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('settings').upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ settings saved');
      _refreshAppViews();
    } catch (err) {
      console.error('[Veriqo sync] saveSettings failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — settings saved locally only', 'err');
    }
  }

  // ── saveDish ───────────────────────────────────────────────────────────────
  async function saveDish(d) {
    if (!_userId) return;
    var r = await supabaseClient.from('dishes').upsert({
      id: String(d.id),
      user_id: _userId,
      name: d.dish || d.name || '',
      category: d.category || null,
      allergens: d.allergens || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (r.error) console.error('[Veriqo sync] saveDish failed:', r.error.message);
    else console.log('[Veriqo sync] ✓ dish saved:', d.dish || d.name);
  }

  // ── deleteDish ─────────────────────────────────────────────────────────────
  async function deleteDish(id) {
    if (!_userId) return;
    await supabaseClient.from('menu_dishes').delete().eq('dish_id', String(id)).eq('user_id', _userId);
    var r = await supabaseClient.from('dishes').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Veriqo sync] deleteDish failed:', r.error.message);
  }

  // ── saveMenu ───────────────────────────────────────────────────────────────
  async function saveMenu(m) {
    if (!_userId) return;
    var menuId = String(m.id);

    var mr = await supabaseClient.from('menus').upsert({
      id: menuId,
      user_id: _userId,
      name: m.name,
      notes: m.notes || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (mr.error) { console.error('[Veriqo sync] saveMenu failed:', mr.error.message); return; }

    await supabaseClient.from('menu_dishes').delete().eq('menu_id', menuId).eq('user_id', _userId);

    var dishes = m.dishes || [];
    if (!dishes.length) return;

    var dishRes = await supabaseClient.from('dishes').select('id, name').eq('user_id', _userId);
    var dishMap = {};
    if (!dishRes.error && dishRes.data) {
      dishRes.data.forEach(function (d) { dishMap[d.name.toLowerCase()] = d.id; });
    }

    var rows = dishes.map(function (d, i) {
      return {
        user_id: _userId,
        menu_id: menuId,
        dish_id: dishMap[(d.dish || d.name || '').toLowerCase()] || null,
        dish_name: d.dish || d.name || '',
        category: d.category || null,
        allergens: d.allergens || [],
        sort_order: i
      };
    });

    var ir = await supabaseClient.from('menu_dishes').insert(rows);
    if (ir.error) console.error('[Veriqo sync] saveMenu dishes failed:', ir.error.message);
    else console.log('[Veriqo sync] ✓ menu saved:', m.name);
  }

  // ── deleteMenu ─────────────────────────────────────────────────────────────
  async function deleteMenu(id) {
    if (!_userId) return;
    await supabaseClient.from('menu_dishes').delete().eq('menu_id', String(id)).eq('user_id', _userId);
    var r = await supabaseClient.from('menus').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Veriqo sync] deleteMenu failed:', r.error.message);
  }

  // Keep old names as aliases so any remaining callers don't break
  async function deleteSuiteMenu(id) { return deleteMenu(id); }
  async function deleteSuiteDish(id) { return deleteDish(id); }

  // ── _pullRecords ───────────────────────────────────────────────────────────
  async function _pullRecords(userId) {
    var result = await supabaseClient
      .from('haccp_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (result.error) throw result.error;
    if (!result.data) return;

    console.log('[Veriqo sync] _pullRecords: got', result.data.length, 'rows from Supabase');

    Object.keys(localStorage)
      .filter(function (k) {
        return k.startsWith('haccp_') && k !== 'haccp_settings' && k !== 'haccp_credentials' && k !== 'haccp_suppliers';
      })
      .forEach(function (k) { localStorage.removeItem(k); });

    result.data.forEach(function (row) {
      try {
        localStorage.setItem('haccp_' + row.date, JSON.stringify(row.records));
      } catch (e) { console.warn('[Veriqo sync] localStorage.setItem failed for', row.date); }
    });

    var today = new Date().toISOString().slice(0, 10);
    var todayRow = result.data.find(function (r) { return r.date === today; });
    if (typeof records !== 'undefined') {
      records.length = 0;
      if (todayRow) todayRow.records.forEach(function (r) { records.push(r); });
    }

  }

  // ── _pullSettings ──────────────────────────────────────────────────────────
  async function _pullSettings(userId) {
    var result = await supabaseClient
      .from('settings')
      .select('config')
      .eq('id', userId)
      .single();

    if (result.error && result.error.code !== 'PGRST116') throw result.error;

if (result.data && result.data.config) {
        var _cloud = result.data.config;
        if (typeof settings !== 'undefined') {
          Object.keys(settings).forEach(function (k) { delete settings[k]; });
          Object.assign(settings, _cloud);
        }
        try { localStorage.setItem('haccp_settings', JSON.stringify(_cloud)); } catch (e) {}
        if (typeof loadSettings === 'function') loadSettings();
      }

      _applyProfileToSettings();

    // Phase 2: pull dishes/menus from shared tables (replaces mise_settings cross-pull)
    await _pullSharedLibrary(userId);
    _applyProfileToSettings();
  }

  // ── _pullSharedLibrary ─────────────────────────────────────────────────────
  // Reads dishes/menus/menu_dishes from shared row-based tables and overrides
  // settings.savedDishes / settings.savedMenus when rows are present.
  async function _pullSharedLibrary(userId) {
    try {
      var results = await Promise.all([
        supabaseClient.from('dishes').select('*').eq('user_id', userId),
        supabaseClient.from('menus').select('*').eq('user_id', userId),
        supabaseClient.from('menu_dishes').select('*').eq('user_id', userId).order('sort_order')
      ]);

      var dishesRes = results[0], menusRes = results[1], menuDishesRes = results[2];
      if (dishesRes.error || menusRes.error || menuDishesRes.error) return;
      if (!dishesRes.data.length && !menusRes.data.length) return;
      if (typeof settings === 'undefined') return;

      // Map shared dishes → Veriqo format {id, dish, category, allergens}
      if (dishesRes.data.length) {
        settings.savedDishes = dishesRes.data.map(function (d) {
          return { id: d.id, dish: d.name, category: d.category || '', allergens: d.allergens || [] };
        });
      }

      // Map shared menus + menu_dishes → Veriqo format {id, name, dishes:[{dish,category,allergens}]}
      if (menusRes.data.length) {
        settings.savedMenus = menusRes.data.map(function (m) {
          var mDishes = menuDishesRes.data
            .filter(function (md) { return md.menu_id === m.id; })
            .map(function (md) {
              return {
                dish: md.dish_name,
                category: md.category || '',
                allergens: md.allergens || []
              };
            });
          return { id: m.id, name: m.name, dishes: mDishes };
        });
      }

      try { localStorage.setItem('haccp_settings', JSON.stringify(settings)); } catch (e) {}
      if (typeof loadSettings === 'function') loadSettings();
      console.log('[Veriqo sync] ✓ shared library pulled (' + dishesRes.data.length + ' dishes, ' + menusRes.data.length + ' menus)');
    } catch (err) {
      console.error('[Veriqo sync] _pullSharedLibrary failed:', err.message || err);
    }
  }

  // ── _pullSharedJobs ────────────────────────────────────────────────────────
  // Pulls Carte (and Yield) jobs from the shared jobs table and injects them
  // into haccp_YYYY-MM-DD localStorage so updateNextJobBanner() sees them.
  // Must be called AFTER _pullRecords — that wipe clears haccp_ date keys.
  async function _pullSharedJobs(userId) {
    try {
      var res = await supabaseClient.from('jobs').select('*').eq('user_id', userId).order('job_date');
      if (!res.data || !res.data.length) return;
      res.data.forEach(function (j) {
        var meta = j.metadata || {};
        var rec = {
          id: j.id,
          type: 'job',
          date: j.job_date,
          time: j.start_time || '',
          client: meta.client_name || '',
          location: j.location || '',
          eventDate: j.job_date,
          eventTime: j.start_time || '',
          covers: j.headcount ? String(j.headcount) : '',
          jobType: j.title || '',
          notes: j.notes || '',
          menus: meta.menus || [],
          _fromCarte: true
        };
        var dayKey = 'haccp_' + j.job_date;
        try {
          var existing = JSON.parse(localStorage.getItem(dayKey) || '[]');
          var idx = existing.findIndex(function (r) { return r.id === rec.id; });
          if (idx >= 0) existing[idx] = rec;
          else existing.push(rec);
          localStorage.setItem(dayKey, JSON.stringify(existing));
        } catch (e) {}
      });
      console.log('[Veriqo sync] ✓ shared jobs pulled:', res.data.length);
    } catch (e) {
      console.warn('[Veriqo sync] _pullSharedJobs failed:', e.message);
    }
  }

  function _refreshAppViews() {
    if (typeof loadSettings === 'function') loadSettings();
    if (typeof loadToday === 'function') loadToday();
    if (typeof populateAllSelects === 'function') populateAllSelects();
    if (typeof renderMenuLibrary === 'function') renderMenuLibrary();
    if (typeof renderDishLibrary === 'function') renderDishLibrary();
    if (typeof renderSavedMenus === 'function') renderSavedMenus();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof updateDashboard === 'function') updateDashboard();
    if (typeof renderAllSections === 'function') renderAllSections();
    document.dispatchEvent(new CustomEvent('vq:sync-complete'));
  }

  return { loadAll, saveDay, saveSettings, saveDish, deleteDish, saveMenu, deleteMenu, deleteSuiteMenu, deleteSuiteDish };

})();
