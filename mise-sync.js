// mise-sync.js v8 — cloud sync for Carte (mirrors localStorage ↔ Supabase)
// Phase 3: jobs now written to shared jobs table. All JSONB bridge mirror
// functions removed. saveDay still writes mise_records for non-job record types.
//
// Tables:
//   mise_records  — user_id, date, records (JSON array) — daily logs
//   mise_settings — id (user_id), config (JSON)         — app settings
//   clients/dishes/menus/menu_dishes/jobs               — shared suite tables

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;
  var _visibilityBound = false;

  // ── loadAll ────────────────────────────────────────────────────────────────
  async function loadAll(userId) {
    _userId = userId;
    console.log('[Carte sync] loadAll — userId:', userId);

    try {
      await _pullRecords(userId);
      await _pullSettings(userId);
      _refreshAppViews();
      console.log('[Carte sync] ✓ full sync complete');
    } catch (err) {
      console.error('[Carte sync] loadAll error:', err.message || err);
    }

    if (!_visibilityBound) {
      _visibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && _userId) {
          _pullRecords(_userId)
            .then(function () { return _pullSettings(_userId); })
            .then(_refreshAppViews)
            .catch(function () {});
        }
      });
    }
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) { console.warn('[Carte sync] saveDay skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('mise_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
      if (r.error) throw r.error;
      console.log('[Carte sync] ✓ day saved:', dateStr);
      _refreshAppViews();
    } catch (err) {
      console.error('[Carte sync] saveDay failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — data saved locally only', 'err');
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  async function saveSettings(settingsObj) {
    if (!_userId) { console.warn('[Carte sync] saveSettings skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('mise_settings').upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
      if (r.error) throw r.error;
      console.log('[Carte sync] ✓ settings saved');
      _refreshAppViews();
    } catch (err) {
      console.error('[Carte sync] saveSettings failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — settings saved locally only', 'err');
    }
  }

  // ── saveJob ────────────────────────────────────────────────────────────────
  async function saveJob(rec) {
    if (!_userId) return;
    var r = await supabaseClient.from('jobs').upsert({
      id: String(rec.id),
      user_id: _userId,
      title: rec.jobType || '',
      job_date: rec.eventDate,
      start_time: rec.eventTime || null,
      location: rec.location || null,
      headcount: rec.covers ? (parseInt(rec.covers) || null) : null,
      status: 'confirmed',
      notes: rec.notes || null,
      source: rec.source || 'carte',
      metadata: {
        client_name: rec.client || '',
        menus: rec.menus || [],
        tabDepositPaid: rec.tabDepositPaid || false,
        tabBalancePaid: rec.tabBalancePaid || false,
        tabClosed: rec.tabClosed || false
      },
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (r.error) console.error('[Carte sync] saveJob failed:', r.error.message);
    else console.log('[Carte sync] ✓ job saved:', rec.id);
  }

  // ── deleteJob ──────────────────────────────────────────────────────────────
  async function deleteJob(id) {
    if (!_userId) return;
    var r = await supabaseClient.from('jobs').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Carte sync] deleteJob failed:', r.error.message);
  }

  // ── _pullRecords ───────────────────────────────────────────────────────────
  async function _pullRecords(userId) {
    var result = await supabaseClient
      .from('mise_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (result.error) throw result.error;
    if (!result.data) return;

    Object.keys(localStorage)
      .filter(function (k) { return k.startsWith('mise_') && k !== 'mise_settings'; })
      .forEach(function (k) { localStorage.removeItem(k); });

    result.data.forEach(function (row) {
      try { localStorage.setItem('mise_' + row.date, JSON.stringify(row.records)); } catch (e) {}
    });

    var today = new Date().toISOString().slice(0, 10);
    var todayRow = result.data.find(function (r) { return r.date === today; });
    if (typeof mRecords !== 'undefined') {
      mRecords.length = 0;
      if (todayRow) todayRow.records.forEach(function (r) { mRecords.push(r); });
    }
  }

  // ── _pullSettings ──────────────────────────────────────────────────────────
  async function _pullSettings(userId) {
    var result = await supabaseClient
      .from('mise_settings')
      .select('config')
      .eq('id', userId)
      .single();

    if (result.error && result.error.code !== 'PGRST116') throw result.error;

    if (result.data && result.data.config && typeof mSettings !== 'undefined') {
      var _cloud = result.data.config;
      Object.keys(mSettings).forEach(function (k) { delete mSettings[k]; });
      Object.assign(mSettings, _cloud);
      try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
      if (typeof loadSettings === 'function') loadSettings();
    }

    // Phase 1+2: shared tables are authoritative for clients/dishes/menus
    await _pullSharedLibrary(userId);
    // Phase 3+: pull yield-sourced jobs into Carte calendar
    await _pullSharedJobs(userId);
  }

  // ── _pullSharedLibrary ─────────────────────────────────────────────────────
  async function _pullSharedLibrary(userId) {
    try {
      var results = await Promise.all([
        supabaseClient.from('clients').select('*').eq('user_id', userId).order('name'),
        supabaseClient.from('dishes').select('*').eq('user_id', userId).order('name'),
        supabaseClient.from('menus').select('*').eq('user_id', userId).order('name'),
        supabaseClient.from('menu_dishes').select('*').eq('user_id', userId).order('sort_order')
      ]);
      var clients    = results[0].data || [];
      var dishes     = results[1].data || [];
      var menus      = results[2].data || [];
      var menuDishes = results[3].data || [];

      if (clients.length > 0) {
        mSettings.savedClients = clients.map(function (c) {
          return { id: c.id, name: c.name || '', address: c.address || '', phone: c.phone || '', email: c.email || '', diet: c.notes || '' };
        });
      }
      if (dishes.length > 0) {
        mSettings.savedDishes = dishes.map(function (d) {
          return { id: d.id, dish: d.name || '', category: d.category || '', allergens: Array.isArray(d.allergens) ? d.allergens : [] };
        });
      }
      if (menus.length > 0) {
        mSettings.savedMenus = menus.map(function (m) {
          var dishIds = menuDishes
            .filter(function (md) { return md.menu_id === m.id; })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
            .map(function (md) { return md.dish_id; });
          return { id: m.id, name: m.name || '', dishIds: dishIds };
        });
      }
      try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
      console.log('[Carte sync] ✓ shared library pulled — clients:', clients.length, 'dishes:', dishes.length, 'menus:', menus.length);
    } catch (e) {
      console.warn('[Carte sync] shared library pull failed:', e.message);
    }
  }

  // ── _pullSharedJobs ────────────────────────────────────────────────────────
  // Pulls all jobs from the shared jobs table and injects Yield-sourced jobs
  // into Carte's localStorage calendar. Uses the `source` column to distinguish:
  //   source='carte' → already in mise_records via _pullRecords, skip
  //   source='yield' or null → Yield-originated, always inject/update as _fromYield
  // Must run AFTER _pullRecords to avoid being cleared by the records wipe.
  async function _pullSharedJobs(userId) {
    try {
      var res = await supabaseClient.from('jobs').select('*').eq('user_id', userId).order('job_date');
      if (res.error) { console.warn('[Carte sync] _pullSharedJobs error:', res.error.message); return; }
      if (!res.data || !res.data.length) return;
      var injected = 0;
      res.data.forEach(function (j) {
        if (!j.job_date) return;
        // Jobs written by Carte have source='carte' and are already in mise_records.
        // Skip them here to avoid duplicating records that _pullRecords already handled.
        if (j.source === 'carte') return;
        var meta = j.metadata || {};
        var dayKey = 'mise_' + j.job_date;
        try {
          var existing = JSON.parse(localStorage.getItem(dayKey) || '[]');
          var idx = existing.findIndex(function (r) { return r.id === j.id; });
          var rec = {
            id: j.id,
            type: 'job',
            source: j.source || 'yield',
            date: j.job_date,
            time: '',
            client: meta.client_name || 'Yield Quote',
            location: j.location || '',
            eventDate: j.job_date,
            eventTime: j.start_time || '',
            covers: j.headcount ? String(j.headcount) : '',
            jobType: j.title || '',
            notes: j.notes || '',
            menus: meta.menus || [],
            _fromYield: true,
            _quoteStatus: meta.status || 'quoted'
          };
          if (idx >= 0) existing[idx] = rec;
          else existing.push(rec);
          localStorage.setItem(dayKey, JSON.stringify(existing));
          injected++;
        } catch (e) {}
      });
      console.log('[Carte sync] ✓ shared jobs pulled — injected:', injected, 'of', res.data.length);
    } catch (e) {
      console.warn('[Carte sync] _pullSharedJobs failed:', e.message);
    }
  }

  // ── Client shared table methods ────────────────────────────────────────────
  async function saveClient(c) {
    if (!_userId) return;
    try {
      await supabaseClient.from('clients').upsert(
        { id: c.id, user_id: _userId, name: c.name || '', email: c.email || '', phone: c.phone || '', address: c.address || '', notes: c.diet || '' },
        { onConflict: 'id' }
      );
    } catch (e) { console.warn('[Carte sync] saveClient failed:', e.message); }
  }

  async function deleteClient(id) {
    if (!_userId) return;
    try { await supabaseClient.from('clients').delete().eq('id', id).eq('user_id', _userId); }
    catch (e) { console.warn('[Carte sync] deleteClient failed:', e.message); }
  }

  // ── Dish shared table methods ──────────────────────────────────────────────
  async function saveDish(d) {
    if (!_userId) return;
    try {
      await supabaseClient.from('dishes').upsert(
        { id: d.id, user_id: _userId, name: d.dish || d.name || '', category: d.category || '', allergens: d.allergens || [] },
        { onConflict: 'id' }
      );
    } catch (e) { console.warn('[Carte sync] saveDish failed:', e.message); }
  }

  async function deleteDish(id) {
    if (!_userId) return;
    try {
      await Promise.all([
        supabaseClient.from('dishes').delete().eq('id', id).eq('user_id', _userId),
        supabaseClient.from('menu_dishes').delete().eq('dish_id', id).eq('user_id', _userId)
      ]);
    } catch (e) { console.warn('[Carte sync] deleteDish failed:', e.message); }
  }

  // ── Menu shared table methods ──────────────────────────────────────────────
  async function saveMenu(m) {
    if (!_userId) return;
    try {
      await supabaseClient.from('menus').upsert(
        { id: m.id, user_id: _userId, name: m.name || '' },
        { onConflict: 'id' }
      );
      await supabaseClient.from('menu_dishes').delete().eq('menu_id', m.id).eq('user_id', _userId);
      if (m.dishIds && m.dishIds.length > 0) {
        var rows = m.dishIds.map(function (dishId, idx) {
          return { menu_id: m.id, dish_id: dishId, user_id: _userId, sort_order: idx };
        });
        await supabaseClient.from('menu_dishes').insert(rows);
      }
    } catch (e) { console.warn('[Carte sync] saveMenu failed:', e.message); }
  }

  async function deleteMenu(id) {
    if (!_userId) return;
    try {
      await Promise.all([
        supabaseClient.from('menus').delete().eq('id', id).eq('user_id', _userId),
        supabaseClient.from('menu_dishes').delete().eq('menu_id', id).eq('user_id', _userId)
      ]);
    } catch (e) { console.warn('[Carte sync] deleteMenu failed:', e.message); }
  }

  function _refreshAppViews() {
    if (typeof loadSettings === 'function') loadSettings();
    if (typeof loadToday === 'function') loadToday();
    if (typeof populateAllSelects === 'function') populateAllSelects();
    if (typeof renderDishLibrary === 'function') renderDishLibrary();
    if (typeof renderMenuDishSelect === 'function') renderMenuDishSelect();
    if (typeof renderSavedMenus === 'function') renderSavedMenus();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof updateDashboard === 'function') updateDashboard();
    if (typeof renderJobsHistory === 'function') renderJobsHistory();
  }

  return {
    loadAll, saveDay, saveSettings,
    saveJob, deleteJob,
    saveClient, deleteClient,
    saveDish, deleteDish,
    saveMenu, deleteMenu
  };

})();
