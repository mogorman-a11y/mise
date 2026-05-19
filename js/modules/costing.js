    // ═══════════════════════════════════════════════════════ CONFIG ═══
        // ═══════════════════════════════════════════════════════ STATE ═══
    let currentScreen = 'dashboard';
    let currentSettingsTab = 'business';
    let ySettings = {};
    let yProfile = {};
    let yBank = {};
    let _userEmail = '';
    let yCostings = [];
    let yQuotes = [];
    let yInvoices = [];
    let yPayments = [];
    let yClients = [];
    let yJobs = [];
    let _costingPrefill = null;
    let _editingQuoteId = null;
    let _invoiceFilter = 'all';
    let _quoteFilter = 'all';
    let _markPaidInvId = null;
    let _costingExpandedJobId = null;
    let _costingPastJobsOpen = false;

    // ═══════════════════════════════════════════════════════ UTILITIES ═══
    // Carte bridge jobs use eventDate/_dateKey; shared jobs use job_date
    function getJobDate(j) { return j.job_date || j.eventDate || j._dateKey || ''; }
    function getJobClient(j) { return j.client_name || j.client || ''; }
    function getJobType(j) { return j.job_type || j.jobType || j.event_type || 'Event'; }
    function getJobCovers(j) { return j.covers || j.guests || 0; }

    // Grand total for a quote including any extras line items
    function getQuoteTotal(quote) {
      const base = parseFloat(quote.price_per_head || 0) * parseInt(quote.covers || 0);
      const extras = (quote.extras || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      return base + extras;
    }

    // Sequential invoice number: reads/increments ySettings.invoiceCounter
    function _nextInvoiceNumber() {
      const prefix = (ySettings.invoicePrefix || 'INV').trim() || 'INV';
      const counter = parseInt(ySettings.invoiceCounter || 1);
      ySettings.invoiceCounter = counter + 1;
      localStorage.setItem('yield_settings', JSON.stringify(ySettings));
      return prefix + '-' + String(counter).padStart(3, '0');
    }

    function showScreen(screenId) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.bottom-nav .nav-btn, .sidebar-nav .nav-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('screen-' + screenId).classList.add('active');
      const navBtn = document.getElementById('nav-' + screenId);
      if (navBtn) navBtn.classList.add('active');
      const sideBtn = document.getElementById('snav-' + screenId);
      if (sideBtn) sideBtn.classList.add('active');
      currentScreen = screenId;
      if (screenId === 'dashboard') renderDashboard();
      else if (screenId === 'quotes') renderQuotes();
      else if (screenId === 'invoices') renderInvoices();
      else if (screenId === 'jobs') renderJobs();
      else if (screenId === 'costing') renderSavedCostings();
    }

    function showSettingsTab(tabId) {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('settings-' + tabId).classList.add('active');
      const btn = document.getElementById('stab-btn-' + tabId);
      if (btn) btn.classList.add('active');
      currentSettingsTab = tabId;
    }

    function showModal(modalId) {
      const modal = document.getElementById(modalId);
      modal.style.display = 'flex';
      if (!modal._backdropFn) {
        modal._backdropFn = function(e) { if (e.target === modal) closeModal(modalId); };
        modal.addEventListener('click', modal._backdropFn);
      }
    }

    function closeModal(modalId) {
      const modal = document.getElementById(modalId);
      modal.style.display = 'none';
    }

    function showToast(message, type = 'info') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show' + (type === 'gold' ? ' gold' : '');
      setTimeout(() => { toast.classList.remove('show'); toast.classList.remove('gold'); }, 3000);
    }

    function formatCurrency(amount) {
      const symbols = { GBP: '£', EUR: '€', USD: '$', CHF: 'Fr ' };
      const sym = symbols[ySettings.currency] || '£';
      return sym + parseFloat(amount || 0).toFixed(2);
    }

    function formatDate(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-GB');
    }

    // ═══════════════════════════════════════════════════════ AUTH & INIT ═══
    // Called by auth.js once the user session is confirmed
    window.Mise = window.Mise || {};
    window.Mise.onSyncError = function(msg) { showToast('⚠ ' + msg); };
    window.Mise.onSignedIn = async function(user) {
      try {
        _userEmail = user.email || '';
        // Init sync module with authenticated user — must run before any data load or render
        if (window.Mise.yieldSync && user) {
          const sb = (typeof supabaseClient !== 'undefined') ? supabaseClient : null;
          await window.Mise.yieldSync.init(sb, user.id);
        }

        loadLocalData();
        await loadRemoteData();
        renderDashboard();
        renderQuotes();
        renderInvoices();
        renderJobs();
        renderSettings();

        // Check subscription / paywall
        if (window.Mise.yieldSubscription) {
          window.Mise.yieldSubscription.check(user.id);
        }

        // Stripe Connect: render the Settings card + handle return from onboarding
        renderStripeConnectCard();
        try {
          const _sp = new URLSearchParams(window.location.search);
          const _stripeParam = _sp.get('stripe');
          if (_stripeParam === 'connected' || _stripeParam === 'refresh') {
            window.history.replaceState(null, '', window.location.pathname);
            await refreshStripeStatus(true);
            showSettingsTab('payment');
            showScreen('settings');
          }
        } catch (e) { console.warn('[Yield] stripe return handler:', e); }
      } catch (error) {
        console.error('Yield init error:', error);
      }
    };

    function loadLocalData() {
      try {
        ySettings = JSON.parse(localStorage.getItem('yield_settings') || '{}');
        yProfile = JSON.parse(localStorage.getItem('yield_profile') || '{}');
        yCostings = JSON.parse(localStorage.getItem('yield_costings') || '[]');
        yQuotes = JSON.parse(localStorage.getItem('yield_quotes') || '[]');
        yBank = JSON.parse(localStorage.getItem('yield_bank') || '{}');
      } catch (e) {
        ySettings = {};
        yProfile = {};
        yCostings = [];
        yQuotes = [];
        yBank = {};
      }
    }

    async function loadRemoteData() {
      if (window.Mise && window.Mise.yieldSync) {
        await window.Mise.yieldSync.pull();
        // Load from localStorage after sync
        yInvoices = JSON.parse(localStorage.getItem('yield_invoices') || '[]');
        yPayments = JSON.parse(localStorage.getItem('yield_payments') || '[]');
        yClients = JSON.parse(localStorage.getItem('yield_clients') || '[]');
        yJobs = JSON.parse(localStorage.getItem('yield_jobs') || '[]');
        yCostings = JSON.parse(localStorage.getItem('yield_costings') || '[]');
        // Pull yield_settings from cloud (survives hard reset / new device)
        await window.Mise.yieldSync.pullSettings();
        ySettings = JSON.parse(localStorage.getItem('yield_settings') || '{}');
        // Pull shared profile (synced with Carte/Veriqo)
        const profileData = await window.Mise.yieldSync.pullProfile();
        if (profileData) yProfile = profileData;
      }
    }

    // ═══════════════════════════════════════════════════════ DASHBOARD ═══
    function renderDashboard() {
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
      const lastMonth = lastMonthDate.getMonth();
      const lastYear = lastMonthDate.getFullYear();

      const monthlyRevenue = yPayments
        .filter(p => { const d = new Date(p.paid_at); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; })
        .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

      const lastMonthRevenue = yPayments
        .filter(p => { const d = new Date(p.paid_at); return d.getMonth() === lastMonth && d.getFullYear() === lastYear; })
        .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

      const openTabs = yInvoices
        .filter(inv => inv.status !== 'paid')
        .reduce((sum, inv) => sum + (parseFloat(inv.total) - parseFloat(inv.paid_total || 0)), 0);

      const upcomingJobs = yJobs.filter(job => new Date(getJobDate(job)) >= new Date()).length;

      // Real average food cost from saved costings
      let avgFoodCost = 0;
      if (yCostings.length > 0) {
        const total = yCostings.reduce((sum, c) => sum + calcCostingFoodPct(c), 0);
        avgFoodCost = total / yCostings.length;
      }

      // Update KPI values
      document.getElementById('metric-revenue').textContent = formatCurrency(monthlyRevenue);
      document.getElementById('metric-open-tabs').textContent = formatCurrency(openTabs);
      document.getElementById('metric-upcoming').textContent = upcomingJobs;
      document.getElementById('metric-food-cost').textContent = avgFoodCost.toFixed(1) + '%';

      // Colour-coded trend indicators
      function setTrend(id, cls, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.className = 'metric-trend' + (cls ? ' ' + cls : '');
      }

      // Revenue trend vs last month
      if (lastMonthRevenue > 0) {
        const pct = ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1);
        if (monthlyRevenue >= lastMonthRevenue) setTrend('trend-revenue', 'up', '↑ ' + pct + '% vs last month');
        else setTrend('trend-revenue', 'down', '↓ ' + Math.abs(pct) + '% vs last month');
      } else if (monthlyRevenue > 0) {
        setTrend('trend-revenue', 'up', '↑ First revenue this month');
      } else {
        setTrend('trend-revenue', '', 'No payments yet');
      }

      // Open tabs — amber/red if high
      if (openTabs === 0) setTrend('trend-open-tabs', 'up', '✓ All clear');
      else if (openTabs > 2000) setTrend('trend-open-tabs', 'down', '● High — chase payments');
      else if (openTabs > 500) setTrend('trend-open-tabs', 'warn', '● Pending');
      else setTrend('trend-open-tabs', 'up', '● Low balance');

      // Upcoming jobs
      if (upcomingJobs === 0) setTrend('trend-upcoming', '', 'No upcoming jobs');
      else setTrend('trend-upcoming', 'up', upcomingJobs + ' job' + (upcomingJobs !== 1 ? 's' : '') + ' coming up');

      // Food cost health
      if (yCostings.length === 0) setTrend('trend-food-cost', '', 'No costings saved yet');
      else if (avgFoodCost <= 28) setTrend('trend-food-cost', 'up', '✓ Excellent');
      else if (avgFoodCost <= 38) setTrend('trend-food-cost', 'warn', '● Target range');
      else setTrend('trend-food-cost', 'down', '↑ Above target — review costs');

      // Food cost gauge
      document.getElementById('food-cost-value').textContent = avgFoodCost.toFixed(1) + '%';
      updateGauge('food-cost-gauge', avgFoodCost, 60, false);

      renderRevenueChart();
      renderOpenTabs();
      renderUpcomingJobs();
    }

    // Calculate food cost % from a saved costing object
    function calcCostingFoodPct(c) {
      let rawFood = 0;
      (c.ingredients || []).forEach(ing => {
        rawFood += (parseFloat(ing.packCost) || 0) * (parseFloat(ing.qty) || 0);
      });
      const wastage = parseFloat(c.wastage) / 100 || 0;
      const foodWithWastage = rawFood * (1 + wastage);
      const travel = (parseFloat(c.miles) || 0) * 0.45;
      const labour = (parseFloat(c.hours) || 0) * (parseFloat(c.hourlyRate) || 0);
      const overhead = parseFloat(c.overhead) || 0;
      const margin = parseFloat(c.margin) / 100 || 0;
      const totalCost = foodWithWastage + travel + labour + overhead;
      if (totalCost === 0 || margin >= 1) return 0;
      const quote = totalCost / (1 - margin);
      return quote > 0 ? (foodWithWastage / quote) * 100 : 0;
    }

    function renderRevenueChart() {
      const container = document.getElementById('revenue-chart');
      if (!container) return;

      const now = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ label: d.toLocaleDateString('en-GB', { month: 'short' }), month: d.getMonth(), year: d.getFullYear(), total: 0 });
      }
      yPayments.forEach(p => {
        const d = new Date(p.paid_at);
        const m = months.find(mo => mo.month === d.getMonth() && mo.year === d.getFullYear());
        if (m) m.total += parseFloat(p.amount || 0);
      });

      const maxTotal = Math.max(...months.map(m => m.total), 1);
      const hasData = months.some(m => m.total > 0);
      const W = 400, H = 130, PAD = 8, BAR_W = (W - PAD * 7) / 6, MAX_BAR_H = 88, BASE_Y = H - 26;

      let bars = '', labels = '';
      months.forEach((m, i) => {
        const x = PAD + i * (BAR_W + PAD);
        const bh = hasData ? Math.max((m.total / maxTotal) * MAX_BAR_H, m.total > 0 ? 4 : 0) : 0;
        const y = BASE_Y - bh;
        const isCurrent = m.month === now.getMonth() && m.year === now.getFullYear();
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BAR_W.toFixed(1)}" height="${(bh || 0).toFixed(1)}" rx="3" fill="${m.total > 0 ? '#2D7A3A' : '#2A2A27'}"/>`;
        if (m.total > 0) bars += `<text x="${(x + BAR_W / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="8" fill="#2D7A3A">${m.total >= 1000 ? (m.total / 1000).toFixed(1) + 'k' : m.total.toFixed(0)}</text>`;
        labels += `<text x="${(x + BAR_W / 2).toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="9" fill="${isCurrent ? '#2D7A3A' : '#7A7870'}">${m.label}</text>`;
      });

      container.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block">
        ${bars}${labels}
        ${!hasData ? `<text x="${W / 2}" y="${H / 2 - 10}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="11" font-weight="600" fill="#4A4A47" letter-spacing="1">REVENUE TREND</text><text x="${W / 2}" y="${H / 2 + 8}" text-anchor="middle" font-family="'Instrument Sans',sans-serif" font-size="10" fill="#4A4A47">Record a payment to see your 6-month trend</text>` : ''}
      </svg>`;
    }

    function showRecordPaymentModal() {
      const unpaid = yInvoices.filter(inv => inv.status !== 'paid');
      const form = document.getElementById('record-payment-form');
      if (unpaid.length === 0) {
        form.innerHTML = '<p style="color:var(--muted);font-size:14px;padding:12px 0;">No outstanding invoices — all tabs are closed.</p>';
        showModal('record-payment-modal');
        return;
      }
      form.innerHTML = `
        <div class="form-group">
          <label class="form-label">Invoice</label>
          <select class="form-input" id="rp-invoice-select">
            <option value="">Select invoice…</option>
            ${unpaid.map(inv => {
              const outstanding = (parseFloat(inv.total) - parseFloat(inv.paid_total || 0)).toFixed(2);
              return `<option value="${inv.id}">${inv.client_name || 'Unknown'} — ${inv.type || 'invoice'} — £${outstanding} outstanding</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Amount (£)</label>
          <input class="form-input" id="rp-amount" type="number" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-input" id="rp-method">
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Reference (optional)</label>
          <input class="form-input" id="rp-ref" placeholder="e.g. Bank ref, receipt no.">
        </div>
        <button class="btn btn-primary" onclick="savePaymentRecord()">Record Payment</button>`;
      showModal('record-payment-modal');
    }

    async function savePaymentRecord() {
      const invoiceId = document.getElementById('rp-invoice-select').value;
      const amount = parseFloat(document.getElementById('rp-amount').value) || 0;
      const method = document.getElementById('rp-method').value;
      const ref = document.getElementById('rp-ref').value;
      if (!invoiceId) { showToast('Please select an invoice'); return; }
      if (!amount) { showToast('Please enter a payment amount'); return; }
      const invIdx = yInvoices.findIndex(inv => inv.id === invoiceId);
      if (invIdx < 0) return;
      yInvoices[invIdx].paid_total = parseFloat(yInvoices[invIdx].paid_total || 0) + amount;
      const outstanding = parseFloat(yInvoices[invIdx].total) - yInvoices[invIdx].paid_total;
      if (outstanding <= 0.01) yInvoices[invIdx].status = 'paid';
      localStorage.setItem('yield_invoices', JSON.stringify(yInvoices));
      const payment = { id: Date.now().toString(), invoice_id: invoiceId, job_id: yInvoices[invIdx].job_id, amount, method, ref, paid_at: new Date().toISOString() };
      yPayments.push(payment);
      localStorage.setItem('yield_payments', JSON.stringify(yPayments));
      if (window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
        const ri = await window.Mise.yieldSync.saveInvoice(yInvoices[invIdx]);
        if (ri && ri.error) showToast('⚠ Invoice save: ' + (ri.error.message || ri.error));
        const rp = await window.Mise.yieldSync.savePayment(payment);
        if (rp && rp.error) showToast('⚠ Payment save: ' + (rp.error.message || rp.error));
      } else {
        showToast('⚠ Sync not ready — check sign-in');
      }
      closeModal('record-payment-modal');
      renderInvoices();
      renderDashboard();
      showToast('Payment recorded — ' + formatCurrency(amount) + (outstanding <= 0.01 ? ' · Tab closed 🎉' : ''));
    }

    function updateGauge(gaugeId, value, max, higherIsBetter) {
      const gauge = document.getElementById(gaugeId);
      if (!gauge) return;
      gauge.style.width = Math.min((value / max) * 100, 100) + '%';
      if (higherIsBetter) {
        // Margin: higher = better
        gauge.style.background = value >= 25 ? 'var(--green)' : value >= 15 ? 'var(--amber)' : 'var(--red)';
      } else {
        // Food cost: lower = better
        gauge.style.background = value <= 28 ? 'var(--green)' : value <= 38 ? 'var(--amber)' : 'var(--red)';
      }
    }

    function renderOpenTabs() {
      const container = document.getElementById('open-tabs-list');
      const openInvoices = yInvoices.filter(inv => inv.status !== 'paid');

      if (openInvoices.length === 0) {
        container.innerHTML = '<p style="color:var(--muted);font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;text-align:center;padding:20px 0;line-height:1.7;">No open invoices.<br>Cost a menu to generate your first quote.</p>';
        return;
      }

      container.innerHTML = openInvoices.map(inv => {
        const client = yClients.find(c => c.id === inv.client_id);
        const outstanding = parseFloat(inv.total) - parseFloat(inv.paid_total || 0);
        const dueDate = new Date(inv.due_date);
        const isOverdue = dueDate < new Date();

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border);">
            <div>
              <div style="font-weight: 600; color: var(--text);">${client?.name || 'Unknown'}</div>
              <div style="font-size: 12px; color: var(--muted);">${formatDate(inv.due_date)} • ${formatCurrency(outstanding)} outstanding</div>
            </div>
            <button class="btn btn-secondary" onclick="showInvoiceDetail('${inv.id}')">Close tab →</button>
          </div>
        `;
      }).join('');
    }

    function renderUpcomingJobs() {
      const container = document.getElementById('upcoming-jobs-list');
      const upcoming = yJobs
        .filter(job => new Date(getJobDate(job)) >= new Date())
        .sort((a, b) => new Date(getJobDate(a)) - new Date(getJobDate(b)))
        .slice(0, 5);

      if (upcoming.length === 0) {
        container.innerHTML = '<p style="color:var(--muted);font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;text-align:center;padding:20px 0;">Your accepted quotes will appear here.</p>';
        return;
      }

      container.innerHTML = upcoming.map(job => {
        // Find the accepted quote for this job (prefer accepted, fall back to any)
        const acceptedQuote = yQuotes.find(q => q.job_id === job.id && q.status === 'accepted');
        const anyQuote = yQuotes.find(q => q.job_id === job.id);

        let dotColor, tabStatus;
        if (acceptedQuote && acceptedQuote.depositPaid && acceptedQuote.balancePaid) {
          dotColor = '#4CAF7A'; // green — Fully Paid
          tabStatus = 'Fully Paid';
        } else if (acceptedQuote && acceptedQuote.depositPaid) {
          dotColor = '#2D7A3A'; // green — Deposit Paid
          tabStatus = 'Deposit Paid';
        } else if (acceptedQuote || anyQuote) {
          dotColor = '#7A7870'; // grey — Quoted
          tabStatus = 'Quoted';
        } else {
          dotColor = '#4A4A47'; // hint — no quote
          tabStatus = 'No quote';
        }

        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0;"></span>
              <div>
                <div style="font-weight:600;color:var(--text);">${getJobClient(job) || 'Unknown'}</div>
                <div style="font-size:12px;color:var(--muted);">${formatDate(getJobDate(job))} · ${getJobCovers(job)} covers</div>
              </div>
            </div>
            <span style="font-size:12px;color:${dotColor};font-weight:600;white-space:nowrap;">${tabStatus}</span>
          </div>`;
      }).join('');
    }

    // ═══════════════════════════════════════════════════════ COSTING ═══
    function toggleTip(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function _ingRowHTML(name, packDesc, packCost, qty) {
      return `
        <input class="form-input" placeholder="e.g. Beef fillet" style="flex:2" value="${name||''}">
        <input class="form-input" placeholder="1kg" style="flex:1" value="${packDesc||''}">
        <input class="form-input" placeholder="0.00" type="number" step="0.01" style="flex:1" value="${packCost||''}">
        <input class="form-input" placeholder="1" type="number" style="flex:0.5" value="${qty||''}">
        <span class="ing-total">—</span>
        <button class="btn btn-ghost" style="padding:10px 8px;width:40px" onclick="removeIngredient(this)">×</button>`;
    }

    function addIngredient(name, packDesc, packCost, qty) {
      const container = document.getElementById('ingredients-list');
      const row = document.createElement('div');
      row.className = 'ingredient-row';
      row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
      row.innerHTML = _ingRowHTML(name, packDesc, packCost, qty);
      container.appendChild(row);
      updateIngredientRowTotal(row);
    }

    function removeIngredient(button) {
      button.closest('.ingredient-row').remove();
      calculateCosting();
    }

    function updateIngredientRowTotal(row) {
      const inputs = row.querySelectorAll('input');
      const cost = parseFloat(inputs[2]?.value) || 0;
      const qty  = parseFloat(inputs[3]?.value) || 0;
      const total = cost * qty;
      const el = row.querySelector('.ing-total');
      if (el) el.textContent = total > 0 ? formatCurrency(total) : '—';
    }

    function updateAllIngredientTotals() {
      document.querySelectorAll('.ingredient-row').forEach(updateIngredientRowTotal);
    }

    function showCostingLibraryModal() {
      const list = document.getElementById('costing-library-list');
      if (yCostings.length === 0) {
        list.innerHTML = '<p style="color:var(--muted);font-size:14px">No saved costings yet — save a costing to build your library.</p>';
      } else {
        list.innerHTML = yCostings.map(c => {
          const ingCount = (c.ingredients || []).filter(i => i.name).length;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-weight:600;color:var(--text)">${c.jobName || 'Untitled'}</div>
              <div style="font-size:12px;color:var(--muted)">${c.covers} covers · ${ingCount} ingredient${ingCount!==1?'s':''} · ${formatDate(c.createdAt)}</div>
            </div>
            <button class="btn btn-secondary" onclick="importCostingIngredients('${c.id}')">Import</button>
          </div>`;
        }).join('');
      }
      showModal('costing-library-modal');
    }

    function showMenuLibraryModal() {
      const list = document.getElementById('menu-library-list');
      let mSettings = {};
      try { mSettings = JSON.parse(localStorage.getItem('mise_settings') || '{}'); } catch (e) {}
      const menus = mSettings.savedMenus || [];

      if (menus.length === 0) {
        list.innerHTML = '<p style="color:var(--muted);font-size:14px;padding:12px 0;">No saved menus found. Create menus in Veriqo Menus first, then come back to load them here.</p>';
      } else {
        list.innerHTML = menus.map((menu, i) => {
          const dishes = menu.dishes || [];
          const dishCount = dishes.length;
          const dishNames = dishes.slice(0, 3).map(d => typeof d === 'string' ? d : (d.dish || d.name || '')).filter(Boolean).join(', ');
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-weight:600;color:var(--text);">${menu.name || 'Untitled Menu'}</div>
              <div style="font-size:12px;color:var(--muted);">${dishCount} dish${dishCount !== 1 ? 'es' : ''}${dishNames ? ' — ' + dishNames + (dishCount > 3 ? '…' : '') : ''}</div>
            </div>
            <button class="btn btn-secondary" onclick="loadFromMenuLibrary(${i})">Select</button>
          </div>`;
        }).join('');
      }
      showModal('menu-library-modal');
    }

    function loadFromMenuLibrary(menuIndex) {
      let mSettings = {};
      try { mSettings = JSON.parse(localStorage.getItem('mise_settings') || '{}'); } catch (e) {}
      const menus = mSettings.savedMenus || [];
      const menu = menus[menuIndex];
      if (!menu) return;
      const dishes = menu.dishes || [];
      dishes.forEach(d => {
        const name = typeof d === 'string' ? d : (d.dish || d.name || '');
        if (name) addIngredient(name, '', '', '');
      });
      closeModal('menu-library-modal');
      calculateCosting();
      showToast('Loaded ' + dishes.length + ' dish' + (dishes.length !== 1 ? 'es' : '') + ' from "' + (menu.name || 'menu') + '"');
    }

    function importCostingIngredients(id) {
      const costing = yCostings.find(c => c.id === id);
      if (!costing) return;
      (costing.ingredients || []).forEach(ing => {
        if (ing.name || ing.packCost) addIngredient(ing.name, ing.packDesc, ing.packCost, ing.qty);
      });
      closeModal('costing-library-modal');
      calculateCosting();
      showToast('Ingredients imported');
    }

    async function handleScanReceipt(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      event.target.value = '';

      if (file.size > 4 * 1024 * 1024) {
        showToast('File too large — please use an image under 4MB');
        return;
      }

      const btn = document.getElementById('scan-receipt-btn');
      const origHTML = btn ? btn.innerHTML : '';

      function resetBtn(failed) {
        if (!btn) return;
        if (failed) {
          btn.innerHTML = '❌ Scan failed';
          btn.disabled = true;
          setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; }, 3000);
        } else {
          btn.innerHTML = origHTML;
          btn.disabled = false;
        }
      }

      let dataUrl, mimeType;
      try {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          if (btn) { btn.innerHTML = '⏳ Reading PDF…'; btn.disabled = true; }
          dataUrl = await _pdfPageToDataUrl(file);
          mimeType = 'image/jpeg';
        } else {
          if (btn) { btn.innerHTML = '⏳ Scanning…'; btn.disabled = true; }
          dataUrl = await _readFileAsDataUrl(file);
          mimeType = file.type || 'image/jpeg';
        }
      } catch (e) {
        resetBtn(true);
        showToast('Could not read file — try a different format');
        console.error('[Yield] Scan receipt read:', e);
        return;
      }

      if (btn) btn.innerHTML = '⏳ Scanning…';
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      try {
        const res = await fetch('/api/ai-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'receipt', image: base64, mimeType })
        });
        const data = await res.json();

        if (data.error) {
          resetBtn(true);
          showToast('Scan failed: ' + data.error);
          console.error('[Yield] Scan receipt API:', data.error);
          return;
        }

        const items = data.items || [];
        if (items.length === 0) {
          resetBtn(false);
          showToast('No line items found — try a clearer photo');
          return;
        }

        items.forEach(item => {
          addIngredient(item.itemName, item.unit, item.pricePerUnit > 0 ? item.pricePerUnit : '', 1);
        });
        calculateCosting();
        const vendor = data.vendor && data.vendor !== 'Unknown Supplier' ? ' from ' + data.vendor : '';
        resetBtn(false);
        showToast('✨ ' + items.length + ' item' + (items.length !== 1 ? 's' : '') + ' imported' + vendor);

      } catch (err) {
        resetBtn(true);
        showToast('Scan failed — check your connection and try again');
        console.error('[Yield] Scan receipt fetch:', err);
      }
    }

    function _readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function _pdfPageToDataUrl(file) {
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.85);
    }

    function calculateCosting() {
      // Get form values
      const covers = parseFloat(document.getElementById('costing-covers').value) || 0;
      const wastage = parseFloat(document.getElementById('costing-wastage').value) / 100 || 0;
      const hourlyRate = parseFloat(document.getElementById('costing-hourly-rate').value) || 0;
      const hours = parseFloat(document.getElementById('costing-hours').value) || 0;
      const miles = parseFloat(document.getElementById('costing-miles').value) || 0;
      const margin = parseFloat(document.getElementById('costing-margin').value) / 100 || 0;
      const overhead = parseFloat(document.getElementById('costing-overhead').value) || 0;

      // Calculate ingredient costs
      let rawFoodCost = 0;
      document.querySelectorAll('.ingredient-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const packCost = parseFloat(inputs[2].value) || 0;
        const qty = parseFloat(inputs[3].value) || 0;
        rawFoodCost += packCost * qty;
      });

      // Calculations
      const foodWithWastage = rawFoodCost * (1 + wastage);
      const costPerHead = foodWithWastage / covers;
      const travelCost = miles * 0.45; // HMRC rate
      const labourCost = hours * hourlyRate;
      const totalCost = foodWithWastage + travelCost + labourCost + overhead;
      const recommendedQuote = totalCost / (1 - margin);
      const netProfit = recommendedQuote - totalCost;
      const foodCostPct = (foodWithWastage / recommendedQuote) * 100;

      // Update display — 10 metrics
      document.getElementById('calc-raw-cost').textContent = formatCurrency(rawFoodCost);
      document.getElementById('calc-food-with-wastage').textContent = formatCurrency(foodWithWastage);
      document.getElementById('calc-travel-cost').textContent = formatCurrency(travelCost);
      document.getElementById('calc-labour-cost').textContent = formatCurrency(labourCost);
      document.getElementById('calc-cost-per-head').textContent = formatCurrency(costPerHead);
      document.getElementById('calc-total-cost').textContent = formatCurrency(totalCost);
      document.getElementById('calc-recommended-quote').textContent = formatCurrency(recommendedQuote);
      document.getElementById('calc-net-profit').textContent = formatCurrency(netProfit);
      document.getElementById('calc-food-cost-pct').textContent = foodCostPct.toFixed(1) + '%';

      const effectiveHourly = hours > 0 ? netProfit / hours : 0;
      document.getElementById('calc-hourly-profit').textContent = '£' + effectiveHourly.toFixed(2) + '/hr';

      // Achieved margin = net profit / recommended quote
      const achievedMargin = recommendedQuote > 0 ? (netProfit / recommendedQuote) * 100 : 0;
      updateGauge('margin-gauge', achievedMargin, 50, true);
      document.getElementById('margin-value').textContent = achievedMargin.toFixed(1) + '%';

      updateGauge('food-cost-gauge-costing', foodCostPct, 60, false);
      document.getElementById('food-cost-value-costing').textContent = foodCostPct.toFixed(1) + '%';

      // Efficiency ring
      const targetHourly = parseFloat(ySettings.defaultHourlyRate || 20);
      const ringPct = targetHourly > 0 ? Math.min((effectiveHourly / targetHourly) * 100, 100) : 0;
      const circumference = 251.3; // 2π × 40
      const dashOffset = circumference * (1 - ringPct / 100);
      const ringFill = document.getElementById('efficiency-ring-fill');
      if (ringFill) {
        ringFill.setAttribute('stroke-dashoffset', dashOffset.toFixed(1));
        ringFill.setAttribute('stroke', ringPct >= 75 ? '#2D7A3A' : ringPct >= 40 ? '#5BAF6A' : '#D45F4A');
      }
      const ringPctText = document.getElementById('ring-pct-text');
      const ringRateText = document.getElementById('ring-rate-text');
      const ringDesc = document.getElementById('ring-desc');
      const ringTarget = document.getElementById('ring-target');
      if (ringPctText) ringPctText.textContent = ringPct.toFixed(0) + '%';
      if (ringRateText) ringRateText.textContent = '£' + effectiveHourly.toFixed(0) + '/hr';
      if (ringDesc) ringDesc.textContent = hours > 0
        ? '£' + effectiveHourly.toFixed(2) + '/hr effective vs £' + targetHourly + '/hr target'
        : 'Enter hours to calculate efficiency.';
      if (ringTarget) ringTarget.textContent = targetHourly.toFixed(0);

      // Update benchmark
      document.getElementById('benchmark-your-quote').textContent = formatCurrency(recommendedQuote / covers);

      // VAT section
      const vatEnabled = ySettings.vatEnabled;
      const vatSection = document.getElementById('calc-vat-section');
      if (vatSection) vatSection.style.display = vatEnabled ? 'block' : 'none';
      if (vatEnabled) {
        const vatRate = parseFloat(ySettings.vatRate || 20) / 100;
        const vatAmount = recommendedQuote * vatRate;
        document.getElementById('calc-vat-amount').textContent = formatCurrency(vatAmount);
        document.getElementById('calc-quote-inc-vat').textContent = formatCurrency(recommendedQuote + vatAmount);
        document.getElementById('calc-vat-rate').textContent = Math.round(vatRate * 100);
      }

      // Update line totals
      updateAllIngredientTotals();
    }

    function saveCosting() {
      const costing = {
        id: Date.now().toString(),
        jobName: document.getElementById('costing-job-name').value,
        covers: document.getElementById('costing-covers').value,
        wastage: document.getElementById('costing-wastage').value,
        hourlyRate: document.getElementById('costing-hourly-rate').value,
        hours: document.getElementById('costing-hours').value,
        miles: document.getElementById('costing-miles').value,
        margin: document.getElementById('costing-margin').value,
        overhead: document.getElementById('costing-overhead').value,
        ingredients: [],
        createdAt: new Date().toISOString()
      };

      // Save ingredients
      document.querySelectorAll('.ingredient-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        costing.ingredients.push({
          name: inputs[0].value,
          packDesc: inputs[1].value,
          packCost: inputs[2].value,
          qty: inputs[3].value
        });
      });

      yCostings.push(costing);
      if (window.Mise && window.Mise.yieldSync) {
        window.Mise.yieldSync.saveCosting(costing);
      } else {
        localStorage.setItem('yield_costings', JSON.stringify(yCostings));
      }
      renderSavedCostings();
      showToast('Costing saved');
    }

    function renderSavedCostings() {
      const container = document.getElementById('saved-costings-list');
      if (yCostings.length === 0) {
        container.innerHTML = '<p style="color: var(--muted); font-size: 14px;">No saved costings</p>';
        return;
      }

      container.innerHTML = yCostings.map(costing => {
        const pct = calcCostingFoodPct(costing);
        const pctColor = pct <= 28 ? 'var(--green)' : pct <= 38 ? 'var(--amber)' : 'var(--red)';
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:600;color:var(--text);">${costing.jobName || 'Untitled'}</div>
            <div style="font-size:12px;color:var(--muted);">${costing.covers} covers • ${formatDate(costing.createdAt)}${pct > 0 ? ' · <span style="color:' + pctColor + '">' + pct.toFixed(1) + '% food cost</span>' : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-secondary" onclick="loadCosting('${costing.id}')">Load</button>
            <button class="btn btn-ghost" onclick="deleteCosting('${costing.id}')" style="padding:10px 10px;color:var(--red)" title="Delete costing">×</button>
          </div>
        </div>`;
      }).join('');
    }

    function deleteCosting(id) {
      if (!confirm('Delete this costing?')) return;
      yCostings = yCostings.filter(c => c.id !== id);
      if (window.Mise && window.Mise.yieldSync) {
        window.Mise.yieldSync.deleteCosting(id);
      } else {
        localStorage.setItem('yield_costings', JSON.stringify(yCostings));
      }
      renderSavedCostings();
      showToast('Costing deleted');
    }

    function loadCosting(id) {
      const costing = yCostings.find(c => c.id === id);
      if (!costing) return;

      // Load form values
      document.getElementById('costing-job-name').value = costing.jobName || '';
      document.getElementById('costing-covers').value = costing.covers || '';
      document.getElementById('costing-wastage').value = costing.wastage || '';
      document.getElementById('costing-hourly-rate').value = costing.hourlyRate || '';
      document.getElementById('costing-hours').value = costing.hours || '';
      document.getElementById('costing-miles').value = costing.miles || '';
      document.getElementById('costing-margin').value = costing.margin || '';
      document.getElementById('costing-overhead').value = costing.overhead || '';

      // Load ingredients
      document.getElementById('ingredients-list').innerHTML = '';
      (costing.ingredients || []).forEach(ing => addIngredient(ing.name, ing.packDesc, ing.packCost, ing.qty));

      calculateCosting();
      showToast('Costing loaded');
    }

    function sendToQuotes() {
      const covers = parseFloat(document.getElementById('costing-covers').value) || 0;
      const jobName = document.getElementById('costing-job-name').value || '';
      const recText = document.getElementById('calc-recommended-quote').textContent.replace(/[£,]/g, '');
      const recommendedQuote = parseFloat(recText) || 0;
      if (!recommendedQuote) { showToast('Calculate a costing first'); return; }
      _costingPrefill = { jobName, covers, recommendedQuote };
      showScreen('quotes');
      showNewQuoteModal(_costingPrefill);
      _costingPrefill = null;
    }

    // ═══════════════════════════════════════════════════════ QUOTES ═══
    function showNewQuoteModal(prefill, existingQuote) {
      if (!existingQuote) {
        _editingQuoteId = null;
        document.getElementById('quote-modal').querySelector('.modal-title').textContent = 'New Quote';
      }
      showModal('quote-modal');
      const src = existingQuote || {};
      const pph = existingQuote ? (src.price_per_head || '') : (prefill && prefill.covers > 0 ? (prefill.recommendedQuote / prefill.covers).toFixed(2) : '');
      const pCovers = existingQuote ? (src.covers || '') : (prefill ? (prefill.covers || '') : '');
      const pClient = existingQuote ? (src.client_name || '') : (prefill ? (prefill.jobName || '') : '');
      const jobOptions = yJobs
        .filter(job => new Date(getJobDate(job)) >= new Date())
        .sort((a, b) => new Date(getJobDate(a)) - new Date(getJobDate(b)))
        .map(job => `<option value="${job.id}" data-date="${getJobDate(job)}" data-client="${getJobClient(job)}" data-covers="${getJobCovers(job)}">${getJobClient(job) || 'Unknown'} — ${formatDate(getJobDate(job))}</option>`)
        .join('');
      const pNotes = src.notes || '';
      const pDate = src.event_date || '';
      const pJobId = src.job_id || '';
      const pExtras = src.extras || [];
      // Job options — when editing, include past jobs too so the linked job still appears
      const allJobOptions = (existingQuote
        ? yJobs
        : yJobs.filter(job => new Date(getJobDate(job)) >= new Date()))
        .sort((a, b) => new Date(getJobDate(a)) - new Date(getJobDate(b)))
        .map(job => `<option value="${job.id}" data-date="${getJobDate(job)}" data-client="${getJobClient(job)}" data-covers="${getJobCovers(job)}" ${job.id === pJobId ? 'selected' : ''}>${getJobClient(job) || 'Unknown'} — ${formatDate(getJobDate(job))}</option>`)
        .join('');
      const isJobLinked = !!pJobId;
      const extrasRows = pExtras.map(e => `
        <div class="extra-row" style="display:flex;gap:8px;margin-bottom:6px;align-items:center;">
          <input class="form-input" placeholder="e.g. Staffing" style="flex:2" value="${(e.label||'').replace(/"/g,'&quot;')}">
          <input class="form-input" placeholder="0.00" type="number" step="0.01" style="flex:1" value="${e.amount||''}">
          <button class="btn btn-ghost" style="padding:10px 8px;width:36px;flex-shrink:0" onclick="removeExtra(this)">×</button>
        </div>`).join('');
      document.getElementById('quote-form').innerHTML = `
        <div class="form-group">
          <label class="form-label">Link to Booking (optional)</label>
          <select class="form-input" id="quote-job-select" onchange="onQuoteJobChange()">
            <option value="">Standalone — no linked booking</option>
            ${allJobOptions}
          </select>
        </div>
        <div id="quote-standalone-fields" style="${isJobLinked ? 'display:none' : ''}">
          <div class="form-group">
            <label class="form-label">Client / Event Name</label>
            <input class="form-input" id="quote-client-name" type="text" placeholder="e.g. Smith Wedding" value="${pClient}">
          </div>
          <div class="form-group">
            <label class="form-label">Event Date</label>
            <input class="form-input" id="quote-event-date" type="date" value="${pDate}" onchange="checkYieldDateUnavailable(this.value)">
            <div id="yield-date-warn" style="display:none;background:rgba(45,122,58,0.08);border:1px solid var(--gold);border-radius:8px;padding:8px 12px;margin-top:6px;font-size:13px;color:var(--gold)">⚠️ This date is marked unavailable in Menus</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Price per Head (£)</label>
          <input class="form-input" id="quote-price-per-head" type="number" step="0.01" value="${pph}">
        </div>
        <div class="form-group">
          <label class="form-label">Covers</label>
          <input class="form-input" id="quote-covers" type="number" value="${pCovers}">
        </div>
        <div class="form-group">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <label class="form-label" style="margin-bottom:0">Extras</label>
            <span style="font-size:11px;color:var(--muted);">Add line items beyond per-head catering</span>
          </div>
          <div style="display:flex;gap:4px;margin-bottom:6px;padding:0 2px;">
            <span style="flex:2;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Item</span>
            <span style="flex:1;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Amount</span>
            <span style="width:36px;"></span>
          </div>
          <div id="extras-list">${extrasRows}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-ghost" onclick="addExtra('Staffing')" style="font-size:11px;padding:5px 9px;">+ Staffing</button>
            <button class="btn btn-ghost" onclick="addExtra('Equipment')" style="font-size:11px;padding:5px 9px;">+ Equipment</button>
            <button class="btn btn-ghost" onclick="addExtra('Travel')" style="font-size:11px;padding:5px 9px;">+ Travel</button>
            <button class="btn btn-ghost" onclick="addExtra('Gratuity')" style="font-size:11px;padding:5px 9px;">+ Gratuity</button>
            <button class="btn btn-ghost" onclick="addExtra('')" style="font-size:11px;padding:5px 9px;">+ Custom</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="quote-notes" rows="3">${pNotes}</textarea>
        </div>
        <button class="btn btn-primary" onclick="saveQuote()">${existingQuote ? 'Update Quote' : 'Save Quote'}</button>
      `;
      // Check pre-filled date against Carte unavailable dates
      if (pDate && !isJobLinked) checkYieldDateUnavailable(pDate);
    }

    function checkYieldDateUnavailable(dateStr) {
      const warnEl = document.getElementById('yield-date-warn');
      if (!warnEl) return;
      try {
        const ms = JSON.parse(localStorage.getItem('mise_settings') || '{}');
        const unavail = ms.unavailableDates || [];
        warnEl.style.display = unavail.indexOf(dateStr) !== -1 ? 'block' : 'none';
      } catch(e) {
        warnEl.style.display = 'none';
      }
    }

    function onQuoteJobChange() {
      const sel = document.getElementById('quote-job-select');
      const standaloneFields = document.getElementById('quote-standalone-fields');
      if (sel.value) {
        standaloneFields.style.display = 'none';
        const opt = sel.options[sel.selectedIndex];
        if (opt.dataset.covers) document.getElementById('quote-covers').value = opt.dataset.covers;
      } else {
        standaloneFields.style.display = '';
      }
    }

    function addExtra(label) {
      const container = document.getElementById('extras-list');
      if (!container) return;
      const row = document.createElement('div');
      row.className = 'extra-row';
      row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;align-items:center;';
      row.innerHTML = `
        <input class="form-input" placeholder="e.g. ${label || 'Custom item'}" style="flex:2" value="${label}">
        <input class="form-input" placeholder="0.00" type="number" step="0.01" style="flex:1">
        <button class="btn btn-ghost" style="padding:10px 8px;width:36px;flex-shrink:0" onclick="removeExtra(this)">×</button>`;
      container.appendChild(row);
    }

    function removeExtra(btn) {
      btn.closest('.extra-row').remove();
    }

    function _collectExtras() {
      const extras = [];
      document.querySelectorAll('.extra-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const label = inputs[0] ? inputs[0].value.trim() : '';
        const amount = parseFloat(inputs[1] ? inputs[1].value : 0) || 0;
        if (label || amount) extras.push({ label, amount });
      });
      return extras;
    }

    function saveQuote() {
      const jobId = document.getElementById('quote-job-select').value;
      const clientEl = document.getElementById('quote-client-name');
      const dateEl = document.getElementById('quote-event-date');
      const extras = _collectExtras();

      if (_editingQuoteId) {
        // Update existing quote — preserve status and payment fields
        const idx = yQuotes.findIndex(q => q.id === _editingQuoteId);
        if (idx >= 0) {
          yQuotes[idx].job_id = jobId || null;
          yQuotes[idx].client_name = !jobId && clientEl ? clientEl.value : null;
          yQuotes[idx].event_date = !jobId && dateEl ? dateEl.value : null;
          yQuotes[idx].price_per_head = document.getElementById('quote-price-per-head').value;
          yQuotes[idx].covers = document.getElementById('quote-covers').value;
          yQuotes[idx].notes = document.getElementById('quote-notes').value;
          yQuotes[idx].extras = extras;
          yQuotes[idx].vatEnabled = !!ySettings.vatEnabled;
          yQuotes[idx].vatRate = parseFloat(ySettings.vatRate || 20);
        }
        localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
        if (window.Mise.yieldSync) window.Mise.yieldSync.saveQuote(yQuotes[idx]);
        const updQ = yQuotes[idx];
        if (!updQ.job_id && updQ.event_date && window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
          window.Mise.yieldSync.syncQuoteToCarte(updQ);
        }
        closeModal('quote-modal');
        renderQuotes();
        showToast('Quote updated');
        _editingQuoteId = null;
        return;
      }

      const quote = {
        id: Date.now().toString(),
        job_id: jobId || null,
        client_name: !jobId && clientEl ? clientEl.value : null,
        event_date: !jobId && dateEl ? dateEl.value : null,
        price_per_head: document.getElementById('quote-price-per-head').value,
        covers: document.getElementById('quote-covers').value,
        notes: document.getElementById('quote-notes').value,
        extras,
        vatEnabled: !!ySettings.vatEnabled,
        vatRate: parseFloat(ySettings.vatRate || 20),
        status: 'draft',
        created_at: new Date().toISOString()
      };

      yQuotes.unshift(quote);
      localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
      if (window.Mise.yieldSync) window.Mise.yieldSync.saveQuote(quote);
      closeModal('quote-modal');
      renderQuotes();
      showToast('Quote saved');
      if (!quote.job_id && quote.event_date && window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
        window.Mise.yieldSync.syncQuoteToCarte(quote);
      }
    }

    function _quoteBadgeClass(quote) {
      if (quote.status === 'accepted') {
        if (quote.depositPaid && quote.balancePaid) return 'badge-paid';
        if (quote.overdue) return 'badge-overdue';
      }
      return 'badge-' + (quote.status || 'draft');
    }

    function _quoteStatusLabel(quote) {
      if (quote.status === 'accepted') {
        if (quote.depositPaid && quote.balancePaid) return 'Paid';
        if (quote.overdue) return 'Overdue';
        if (quote.depositPaid) return 'Deposit Paid';
        return 'Accepted';
      }
      const map = { draft: 'Draft', sent: 'Sent', declined: 'Declined', expired: 'Expired' };
      return map[quote.status] || quote.status;
    }

    function renderQuotes() {
      const container = document.getElementById('quotes-list');
      let list = yQuotes;
      if (_quoteFilter === 'active')   list = yQuotes.filter(q => q.status === 'draft' || q.status === 'sent');
      else if (_quoteFilter === 'accepted') list = yQuotes.filter(q => q.status === 'accepted');
      else if (_quoteFilter === 'declined') list = yQuotes.filter(q => q.status === 'declined' || q.status === 'expired');
      if (list.length === 0) {
        container.innerHTML = `<p style="color:var(--muted);font-size:14px;">${yQuotes.length === 0 ? 'No quotes yet' : 'No quotes matching this filter'}</p>`;
        return;
      }
      container.innerHTML = list.map(quote => {
        const job = yJobs.find(j => j.id === quote.job_id);
        const total = getQuoteTotal(quote);
        const displayClient = job ? getJobClient(job) : (quote.client_name || 'Standalone');
        const displayDate = job ? formatDate(getJobDate(job)) : (quote.event_date ? formatDate(quote.event_date) : '—');
        return `
          <div class="card" style="margin-bottom:12px;cursor:pointer;" onclick="showQuoteDetail('${quote.id}')">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
              <div>
                <div style="font-weight:600;color:var(--text);">${displayClient}</div>
                <div style="font-size:12px;color:var(--muted);">${displayDate} · ${quote.covers} covers</div>
              </div>
              <div style="text-align:right;">
                <div style="font-weight:600;color:var(--gold);">${formatCurrency(total)}</div>
                <span class="badge ${_quoteBadgeClass(quote)}">${_quoteStatusLabel(quote)}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px;" onclick="event.stopPropagation()">
              <button class="btn btn-secondary" onclick="exportQuotePDF('${quote.id}')" style="flex:1;padding:9px;">📄 PDF</button>
              <button class="btn btn-ghost" onclick="deleteQuote('${quote.id}')" style="padding:9px;">×</button>
            </div>
          </div>`;
      }).join('');
    }

    function showQuoteDetail(id) {
      const quote = yQuotes.find(q => q.id === id);
      if (!quote) return;
      window._currentQuoteId = id;
      const job = yJobs.find(j => j.id === quote.job_id);
      const baseTotal = parseFloat(quote.price_per_head || 0) * parseInt(quote.covers || 0);
      const extras = quote.extras || [];
      const extrasTotal = extras.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      const grandTotal = baseTotal + extrasTotal;
      const vatEnabled = ySettings.vatEnabled;
      const vatRate = parseFloat(ySettings.vatRate || 20) / 100;
      const vatAmount = vatEnabled ? grandTotal * vatRate : 0;
      const billableTotal = grandTotal + vatAmount;
      const depositPct = parseFloat(ySettings.defaultDepositPct || 30);
      const depositAmt = billableTotal * (depositPct / 100);
      const balanceAmt = billableTotal - depositAmt;
      const balanceDays = parseInt(ySettings.defaultBalanceDue || 14);
      const displayClient = job ? getJobClient(job) : (quote.client_name || 'Standalone');
      const displayDate = job ? formatDate(getJobDate(job)) : (quote.event_date ? formatDate(quote.event_date) : '—');
      const s = quote.status || 'draft';

      document.getElementById('quote-detail-title').textContent = displayClient;

      let actions = '';
      if (s === 'draft') {
        actions = `<button class="btn btn-primary" style="flex:1" onclick="updateQuoteStatus('${id}','accepted')">Accept</button>
                   <button class="btn btn-secondary" style="flex:1" onclick="showSendQuoteEmailPanel('${id}')">✉️ Send to Client</button>
                   <button class="btn btn-secondary" style="flex:1" onclick="editQuote('${id}')">Edit</button>`;
      } else if (s === 'sent') {
        actions = `<button class="btn btn-primary" style="flex:1" onclick="updateQuoteStatus('${id}','accepted')">Accept</button>
                   <button class="btn btn-secondary" style="flex:1" onclick="showSendQuoteEmailPanel('${id}')">✉️ Resend</button>
                   <button class="btn btn-secondary" style="flex:1" onclick="editQuote('${id}')">Edit</button>
                   <button class="btn btn-ghost" style="flex:1;color:var(--red)" onclick="updateQuoteStatus('${id}','declined')">Decline</button>`;
      } else if (s === 'accepted') {
        actions = `<button class="btn btn-secondary" style="flex:1" onclick="editQuote('${id}')">Edit</button>
                   <button class="btn btn-secondary" style="flex:1" onclick="exportQuotePDF('${id}')">📄 PDF</button>`;
      } else {
        actions = `<button class="btn btn-secondary" style="flex:1" onclick="updateQuoteStatus('${id}','draft')">Reopen as Draft</button>
                   <button class="btn btn-secondary" style="flex:1" onclick="editQuote('${id}')">Edit</button>`;
      }

      // Extras rows for Tab Summary
      const extrasLines = extras.map(e =>
        `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:var(--muted);">
           <span>${e.label || 'Extra'}</span><span>${formatCurrency(e.amount)}</span>
         </div>`).join('');

      // Tab Summary block
      const tabSummary = `
        <div style="background:var(--surface-el);border-radius:var(--radius);padding:14px;margin:14px 0;">
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">Tab Summary</div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:var(--muted);">
            <span>Catering (${quote.covers} × £${parseFloat(quote.price_per_head||0).toFixed(2)})</span>
            <span>${formatCurrency(baseTotal)}</span>
          </div>
          ${extrasLines}
          ${extrasTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:var(--muted);"><span>Extras subtotal</span><span>${formatCurrency(extrasTotal)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0 6px;font-size:${vatEnabled ? '13px' : '15px'};font-weight:700;border-top:1px solid var(--border);margin-top:6px;">
            <span>${vatEnabled ? 'Subtotal (ex. VAT)' : 'Grand Total'}</span><span style="color:var(--gold)">${formatCurrency(grandTotal)}</span>
          </div>
          ${vatEnabled ? `
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:var(--muted);">
            <span>VAT (${Math.round(vatRate * 100)}%)</span><span>${formatCurrency(vatAmount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0 6px;font-size:15px;font-weight:700;border-top:1px solid var(--border);margin-top:4px;">
            <span>Total inc. VAT</span><span style="color:var(--gold)">${formatCurrency(billableTotal)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:var(--muted);">
            <span>Deposit (${depositPct}%)${vatEnabled ? ' <em style="font-style:normal;font-size:10px">inc. VAT</em>' : ''}</span><span>${formatCurrency(depositAmt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:var(--muted);">
            <span>Balance (due ${balanceDays} days before event)${vatEnabled ? ' <em style="font-style:normal;font-size:10px">inc. VAT</em>' : ''}</span><span>${formatCurrency(balanceAmt)}</span>
          </div>
          ${ySettings.paymentInstructions ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);white-space:pre-wrap;">${ySettings.paymentInstructions}</div>` : ''}
        </div>`;

      let paySection = '';
      if (s === 'accepted') {
        const dep = quote.depositPaid;
        const bal = quote.balancePaid;
        const ov = quote.overdue;
        paySection = `
          <div style="margin-top:4px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Payment Status</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div>
                <div style="color:var(--text);font-size:14px;">Deposit <span style="color:var(--muted)">${formatCurrency(depositAmt)}</span>${vatEnabled ? '<span style="font-size:10px;color:var(--muted);margin-left:3px">inc. VAT</span>' : ''}</div>
                <div style="font-size:12px;color:${dep?'var(--green)':ov?'var(--red)':'var(--muted)'}">${dep?'✓ Paid':ov?'Overdue':'Pending'}</div>
              </div>
              <button class="btn ${dep?'btn-ghost':'btn-primary'}" style="padding:8px 14px;font-size:13px" onclick="markQuotePayment('${id}','depositPaid',${!dep})">${dep?'Mark Unpaid':'Mark Paid'}</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div>
                <div style="color:var(--text);font-size:14px;">Balance <span style="color:var(--muted)">${formatCurrency(balanceAmt)}</span>${vatEnabled ? '<span style="font-size:10px;color:var(--muted);margin-left:3px">inc. VAT</span>' : ''}</div>
                <div style="font-size:12px;color:${bal?'var(--green)':ov?'var(--red)':'var(--muted)'}">${bal?'✓ Paid':ov?'Overdue':'Pending'}</div>
              </div>
              <button class="btn ${bal?'btn-ghost':'btn-primary'}" style="padding:8px 14px;font-size:13px" onclick="markQuotePayment('${id}','balancePaid',${!bal})">${bal?'Mark Unpaid':'Mark Paid'}</button>
            </div>
            ${!dep||!bal ? `<button class="btn btn-ghost" style="width:100%;color:var(--red);font-size:13px" onclick="markQuoteOverdue('${id}')">${ov?'Clear Overdue':'Mark Overdue'}</button>` : ''}
          </div>`;
      }

      document.getElementById('quote-detail-body').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
          <div>
            <div style="color:var(--muted);font-size:13px;">${displayDate} · ${quote.covers} covers</div>
            <div style="color:var(--muted);font-size:13px;">£${parseFloat(quote.price_per_head||0).toFixed(2)}/head</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:700;color:var(--gold);font-family:var(--font-display)">${formatCurrency(grandTotal)}</div>
            <span class="badge ${_quoteBadgeClass(quote)}">${_quoteStatusLabel(quote)}</span>
          </div>
        </div>
        ${quote.notes ? `<div style="background:var(--surface-el);border-radius:var(--radius);padding:12px;font-size:13px;color:var(--muted);margin-bottom:12px;white-space:pre-wrap;">${quote.notes}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}</div>
        ${tabSummary}
        ${paySection}
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
          <button class="btn" style="background:${quote.status==='draft'?'rgba(100,100,100,0.1)':'rgba(201,168,76,0.1)'};border:1px solid ${quote.status==='draft'?'#555':'var(--gold)'};color:${quote.status==='draft'?'#666':'var(--gold)'};font-size:13px" onclick="copyMagicLink(this)">🔗 ${quote.status==='draft'?'Client Portal (send first)':'Copy Client Portal Link'}</button>
          <div style="text-align:right"><button class="btn btn-ghost" style="color:var(--red);font-size:13px" onclick="deleteQuoteFromDetail('${id}')">Delete quote</button></div>
        </div>`;
      showModal('quote-detail-modal');
    }

    function updateQuoteStatus(id, newStatus) {
      const idx = yQuotes.findIndex(q => q.id === id);
      if (idx < 0) return;
      yQuotes[idx].status = newStatus;
      yQuotes[idx].vatEnabled = !!ySettings.vatEnabled;
      yQuotes[idx].vatRate = parseFloat(ySettings.vatRate || 20);
      localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
      if (window.Mise.yieldSync) window.Mise.yieldSync.saveQuote(yQuotes[idx]);
      if (newStatus === 'accepted') {
        _createInvoicesFromQuote(yQuotes[idx]);
        showToast('Tab opened 🎉 — deposit & balance invoices created', 'gold');
      } else {
        showToast('Quote marked as ' + newStatus);
      }
      // Keep Carte calendar in sync for standalone quotes
      const q = yQuotes[idx];
      if (!q.job_id && q.event_date && window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
        if (newStatus === 'declined' || newStatus === 'expired') {
          window.Mise.yieldSync.removeQuoteFromCarte(id);
        } else {
          window.Mise.yieldSync.syncQuoteToCarte(q);
        }
      }
      renderQuotes();
      showQuoteDetail(id);
    }

    async function _createInvoicesFromQuote(quote) {
      if (yInvoices.some(inv => inv.quote_id === quote.id)) return;
      const job = yJobs.find(j => j.id === quote.job_id);
      const depositPct    = parseFloat(ySettings.defaultDepositPct || 30) / 100;
      const balanceDays   = parseInt(ySettings.defaultBalanceDue || 14);
      const quoteTotal    = getQuoteTotal(quote);
      const vatRate       = ySettings.vatEnabled ? parseFloat(ySettings.vatRate || 20) / 100 : 0;
      const billableTotal = quoteTotal * (1 + vatRate);
      const jobDate       = job ? getJobDate(job) : (quote.event_date || '');
      const clientName    = job ? getJobClient(job) : (quote.client_name || '');
      const today         = new Date().toISOString().split('T')[0];
      const depositDue    = new Date(Date.now() + 3 * 864e5).toISOString().split('T')[0];
      const balanceDue    = jobDate
        ? new Date(new Date(jobDate).getTime() - balanceDays * 864e5).toISOString().split('T')[0]
        : new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
      const base = {
        quote_id: quote.id,
        client_name: clientName,
        job_id: job ? job.id : null,
        invoice_date: today,
        paid_total: 0,
        status: 'draft',
        notes: '',
        created_at: new Date().toISOString()
      };
      const depositInv = Object.assign({}, base, {
        id: Date.now().toString(),
        inv_number: _nextInvoiceNumber(),
        type: 'deposit',
        total: billableTotal * depositPct,
        due_date: depositDue
      });
      const balanceInv = Object.assign({}, base, {
        id: (Date.now() + 1).toString(),
        inv_number: _nextInvoiceNumber(),
        type: 'balance',
        total: billableTotal * (1 - depositPct),
        due_date: balanceDue
      });
      yInvoices.unshift(balanceInv);
      yInvoices.unshift(depositInv);
      localStorage.setItem('yield_invoices', JSON.stringify(yInvoices));
      if (window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
        const r1 = await window.Mise.yieldSync.saveInvoice(depositInv);
        if (r1 && r1.error) showToast('⚠ Invoice save: ' + (r1.error.message || r1.error));
        const r2 = await window.Mise.yieldSync.saveInvoice(balanceInv);
        if (r2 && r2.error) showToast('⚠ Invoice save: ' + (r2.error.message || r2.error));
      } else {
        showToast('⚠ Sync not ready — check sign-in');
      }
    }

    function markQuotePayment(id, field, value) {
      const idx = yQuotes.findIndex(q => q.id === id);
      if (idx < 0) return;
      yQuotes[idx][field] = value;
      if (value) yQuotes[idx].overdue = false;
      localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
      if (window.Mise.yieldSync) window.Mise.yieldSync.saveQuote(yQuotes[idx]);
      renderQuotes();
      showQuoteDetail(id);
      const bothPaid = yQuotes[idx].depositPaid && yQuotes[idx].balancePaid;
      if (bothPaid) showToast('Tab closed — fully paid!');
    }

    function markQuoteOverdue(id) {
      const idx = yQuotes.findIndex(q => q.id === id);
      if (idx < 0) return;
      yQuotes[idx].overdue = !yQuotes[idx].overdue;
      localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
      if (window.Mise.yieldSync) window.Mise.yieldSync.saveQuote(yQuotes[idx]);
      renderQuotes();
      showQuoteDetail(id);
    }

    function editQuote(id) {
      const quote = yQuotes.find(q => q.id === id);
      if (!quote) return;
      closeModal('quote-detail-modal');
      _editingQuoteId = id;
      document.getElementById('quote-modal').querySelector('.modal-title').textContent = 'Edit Quote';
      showNewQuoteModal(null, quote);
    }

    function deleteQuoteFromDetail(id) {
      closeModal('quote-detail-modal');
      deleteQuote(id);
    }

    function copyMagicLink(btn) {
      if (!window._currentQuoteId) return;
      const quote = yQuotes.find(q => q.id === window._currentQuoteId);
      if (quote && quote.status === 'draft') {
        showToast('Send the quote to the client first — draft links show "not available" to clients', 'error');
        return;
      }
      const portalUrl = window.location.origin + '/pay?q=' + window._currentQuoteId;
      const orig = btn.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(portalUrl).then(function() {
          btn.textContent = 'Link Copied! ✓';
          btn.style.background = 'var(--gold)';
          btn.style.color = '#0E0E0D';
          setTimeout(function(){ btn.textContent = orig; btn.style.background = 'rgba(201,168,76,0.1)'; btn.style.color = 'var(--gold)'; }, 2000);
        });
      } else {
        const tmp = document.createElement('input');
        tmp.value = portalUrl;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
        btn.textContent = 'Link Copied! ✓';
        btn.style.background = 'var(--gold)';
        btn.style.color = '#0E0E0D';
        setTimeout(function(){ btn.textContent = orig; btn.style.background = 'rgba(201,168,76,0.1)'; btn.style.color = 'var(--gold)'; }, 2000);
      }
    }

    function showSendQuoteEmailPanel(quoteId) {
      const quote = yQuotes.find(q => q.id === quoteId);
      if (!quote) return;
      const job = yJobs.find(j => j.id === quote.job_id);
      const clientName = job ? getJobClient(job) : (quote.client_name || 'Client');
      const businessName = yProfile.business_name || ySettings.businessName || 'Your Chef';
      const grandTotal = getQuoteTotal(quote);
      const depositPct = parseFloat(ySettings.defaultDepositPct || 30);
      const depositAmt = grandTotal * (depositPct / 100);
      const portalLink = window.location.origin + '/pay?q=' + quoteId;
      const subject = encodeURIComponent(`Your Quote from ${businessName}`);
      const defaultQuoteBody = `Hi ${clientName},\n\nPlease find your quote details below.\n\nEvent Total: ${formatCurrency(grandTotal)}\nDeposit (${depositPct}%): ${formatCurrency(depositAmt)}\n\nYou can view your quote here:\n${portalLink}\n\nPlease let me know if you have any questions.\n\nBest regards,\n${businessName}`;
      const templateVars = { clientName, businessName, total: formatCurrency(grandTotal), depositPct, depositAmt: formatCurrency(depositAmt), portalLink };
      const bodyText = ySettings.quoteEmailTemplate ? _applyTemplate(ySettings.quoteEmailTemplate, templateVars) : defaultQuoteBody;
      const body = encodeURIComponent(bodyText);
      document.getElementById('email-compose-title').textContent = `Send Quote to ${clientName}`;
      document.getElementById('email-compose-form').innerHTML = `
        <div class="form-group">
          <label class="form-label">To</label>
          <input class="form-input" id="email-to" type="email" placeholder="client@email.com" value="${quote.client_email || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <input class="form-input" id="email-subject" value="Your Quote from ${businessName}">
        </div>
        <div class="form-group">
          <label class="form-label">Preview</label>
          <textarea class="form-input" rows="7" style="font-size:12px;color:var(--muted)" readonly>${bodyText}</textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-primary" style="flex:1" onclick="sendQuoteEmail('${quoteId}','${subject}','${body}')">Open Mail App →</button>
          <button class="btn btn-secondary" onclick="closeModal('email-compose-modal')">Cancel</button>
        </div>`;
      closeModal('quote-detail-modal');
      showModal('email-compose-modal');
    }

    function sendQuoteEmail(quoteId, subject, body) {
      const to = document.getElementById('email-to').value.trim();
      const sub = encodeURIComponent(document.getElementById('email-subject').value);
      window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
      closeModal('email-compose-modal');
      updateQuoteStatus(quoteId, 'sent');
    }

    function showSendInvoiceEmailPanel(invId) {
      const inv = yInvoices.find(i => i.id === invId);
      if (!inv) return;
      const businessName = yProfile.business_name || ySettings.businessName || 'Your Chef';
      const typeLabel = inv.type === 'deposit' ? 'Deposit Invoice' : 'Balance Invoice';
      const outstanding = parseFloat(inv.total || 0) - parseFloat(inv.paid_total || 0);
      const instructions = ySettings.paymentInstructions || '';
      const subject = encodeURIComponent(`${typeLabel} from ${businessName}`);
      const defaultInvoiceBody = `Hi ${inv.client_name || 'there'},\n\nPlease find your ${typeLabel.toLowerCase()} attached.\n\nAmount Due: ${formatCurrency(outstanding)}\nDue Date: ${inv.due_date || 'Please pay promptly'}\n\n${instructions}\n\nBest regards,\n${businessName}`;
      const invTemplateVars = { clientName: inv.client_name || 'there', businessName, invoiceType: typeLabel.toLowerCase(), amount: formatCurrency(outstanding), dueDate: inv.due_date || 'Please pay promptly', paymentInstructions: instructions };
      const invBodyText = ySettings.invoiceEmailTemplate ? _applyTemplate(ySettings.invoiceEmailTemplate, invTemplateVars) : defaultInvoiceBody;
      const body = encodeURIComponent(invBodyText);
      document.getElementById('email-compose-title').textContent = `Send ${typeLabel}`;
      document.getElementById('email-compose-form').innerHTML = `
        <div class="form-group">
          <label class="form-label">To</label>
          <input class="form-input" id="email-to" type="email" placeholder="client@email.com" value="${inv.client_email || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <input class="form-input" id="email-subject" value="${typeLabel} from ${businessName}">
        </div>
        <div class="form-group">
          <label class="form-label">Preview</label>
          <textarea class="form-input" rows="7" style="font-size:12px;color:var(--muted)" readonly>${invBodyText}</textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-primary" style="flex:1" onclick="sendInvoiceEmail('${invId}','${subject}','${body}')">Open Mail App →</button>
          <button class="btn btn-secondary" onclick="closeModal('email-compose-modal')">Cancel</button>
        </div>`;
      closeModal('invoice-detail-modal');
      showModal('email-compose-modal');
    }

    function sendInvoiceEmail(invId, subject, body) {
      const to = document.getElementById('email-to').value.trim();
      const sub = encodeURIComponent(document.getElementById('email-subject').value);
      window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
      const idx = yInvoices.findIndex(i => i.id === invId);
      if (idx >= 0 && yInvoices[idx].status !== 'paid') {
        yInvoices[idx].status = 'sent';
        localStorage.setItem('yield_invoices', JSON.stringify(yInvoices));
      }
      closeModal('email-compose-modal');
      renderInvoices();
      showToast('Mail app opened — invoice marked as Sent');
    }

    function filterQuotes(status) {
      _quoteFilter = status;
      document.querySelectorAll('.qt-filter-btn').forEach(btn => {
        btn.className = btn.id === 'qt-filter-' + status
          ? 'btn btn-primary qt-filter-btn'
          : 'btn btn-secondary qt-filter-btn';
      });
      renderQuotes();
    }

    function deleteQuote(id) {
      if (confirm('Delete this quote?')) {
        const quote = yQuotes.find(q => q.id === id);
        yQuotes = yQuotes.filter(q => q.id !== id);
        localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
        renderQuotes();
        showToast('Quote deleted');
        if (quote && !quote.job_id && quote.event_date && window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
          window.Mise.yieldSync.removeQuoteFromCarte(id, quote.event_date);
        }
      }
    }

    function showInvoiceDetail(invId) {
      const inv = yInvoices.find(i => i.id === invId);
      if (!inv) return;
      const quote = inv.quote_id ? yQuotes.find(q => q.id === inv.quote_id) : null;
      const outstanding = Math.max(0, parseFloat(inv.total || 0) - parseFloat(inv.paid_total || 0));
      const isFullyPaid = inv.status === 'paid';
      const today = new Date(); today.setHours(0,0,0,0);
      const isOverdue = !isFullyPaid && inv.due_date && new Date(inv.due_date) < today;
      const typeLabel = inv.type === 'deposit' ? 'Deposit Invoice' : 'Balance Invoice';
      const invNum = inv.inv_number || ('INV-' + inv.id.slice(-4).toUpperCase());

      // Determine timeline state based on quote + invoice
      const depPaid  = quote ? !!quote.depositPaid  : (inv.type === 'deposit' && isFullyPaid);
      const balPaid  = quote ? !!quote.balancePaid  : (inv.type === 'balance' && isFullyPaid);
      const tabClosed = depPaid && balPaid;

      function tlDot(step) {
        const doneSteps = {
          quoted:   true,
          accepted: quote && quote.status === 'accepted',
          deposit:  depPaid,
          balance:  balPaid,
          closed:   tabClosed
        };
        const cls = doneSteps[step] ? (step === 'closed' ? 'complete' : 'done') : '';
        const icons = { quoted:'Q', accepted:'A', deposit:'D', balance:'B', closed:'✓' };
        return `<div class="tl-dot ${cls}">${icons[step]}</div>`;
      }
      function tlLine(afterStep) {
        const passedAt = {deposit:depPaid, balance:balPaid, closed:tabClosed, accepted: quote?.status==='accepted', quoted:true};
        const cls = passedAt[afterStep] ? (afterStep==='closed'?'complete':'done') : '';
        return `<div class="tl-line ${cls}"></div>`;
      }

      const timeline = `
        <div class="timeline-strip">
          <div class="tl-step">${tlDot('quoted')}<div class="tl-label done">Quoted</div></div>
          ${tlLine('quoted')}
          <div class="tl-step">${tlDot('accepted')}<div class="tl-label ${quote?.status==='accepted'?'done':''}">Accepted</div></div>
          ${tlLine('accepted')}
          <div class="tl-step">${tlDot('deposit')}<div class="tl-label ${depPaid?'done':''}">Deposit<br>Paid</div></div>
          ${tlLine('deposit')}
          <div class="tl-step">${tlDot('balance')}<div class="tl-label ${balPaid?'done':''}">Balance<br>Paid</div></div>
          ${tlLine('balance')}
          <div class="tl-step">${tlDot('closed')}<div class="tl-label ${tabClosed?'complete':''}">Tab<br>Closed</div></div>
        </div>`;

      const statusBadge = isFullyPaid
        ? '<span class="badge badge-accepted">Paid</span>'
        : isOverdue
          ? '<span class="badge badge-declined">Overdue</span>'
          : inv.status === 'sent'
            ? '<span class="badge badge-sent">Sent</span>'
            : '<span class="badge badge-draft">Draft</span>';

      document.getElementById('invoice-detail-title').textContent = `${invNum} — ${typeLabel}`;
      document.getElementById('invoice-detail-body').innerHTML = `
        ${timeline}
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
          <div>
            <div style="font-weight:600;font-size:15px;">${inv.client_name || '—'}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">Due: ${formatDate(inv.due_date)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:700;color:var(--gold);font-family:var(--font-display)">${formatCurrency(inv.total)}</div>
            ${statusBadge}
          </div>
        </div>
        <div style="background:var(--surface-el);border-radius:var(--radius);padding:14px;margin-bottom:16px;">
          ${ySettings.vatEnabled ? (() => {
            const vr = parseFloat(ySettings.vatRate || 20) / 100;
            const exVat = inv.total / (1 + vr);
            const vatAmt = inv.total - exVat;
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:var(--muted)">Ex. VAT</span><span>${formatCurrency(exVat)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:var(--muted)">VAT (${Math.round(vr*100)}%)</span><span>${formatCurrency(vatAmt)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0 8px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border);margin-bottom:4px;"><span>Total inc. VAT</span><span>${formatCurrency(inv.total)}</span></div>`;
          })() : `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:var(--muted)">Invoice total</span><span>${formatCurrency(inv.total)}</span></div>`}
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span style="color:var(--muted)">Paid to date</span><span style="color:var(--green)">${formatCurrency(inv.paid_total || 0)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0 4px;font-size:15px;font-weight:700;border-top:1px solid var(--border);margin-top:4px;"><span>Outstanding</span><span style="color:${outstanding>0?(isOverdue?'var(--red)':'var(--gold)'):'var(--green)'}">${formatCurrency(outstanding)}</span></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${!isFullyPaid ? `<button class="btn btn-primary" style="flex:1" onclick="showMarkPaidModal('${invId}')">Mark as Paid</button>` : ''}
          <button class="btn btn-secondary" style="flex:1" onclick="showSendInvoiceEmailPanel('${invId}')">✉️ Send Invoice</button>
          <button class="btn btn-secondary" onclick="exportInvoicePDF('${invId}')" style="padding:10px 14px;">📄 PDF</button>
        </div>`;
      showModal('invoice-detail-modal');
    }

    function showMarkPaidModal(invId) {
      _markPaidInvId = invId;
      const inv = yInvoices.find(i => i.id === invId);
      if (!inv) return;
      const outstanding = Math.max(0, parseFloat(inv.total || 0) - parseFloat(inv.paid_total || 0));
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('mark-paid-form').innerHTML = `
        <div class="form-group">
          <label class="form-label">Amount Received</label>
          <input class="form-input" id="mp-amount" type="number" step="0.01" value="${outstanding.toFixed(2)}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date Received</label>
            <input class="form-input" id="mp-date" type="date" value="${today}">
          </div>
          <div class="form-group">
            <label class="form-label">Method</label>
            <select class="form-input" id="mp-method">
              <option>Bank Transfer</option>
              <option>Cash</option>
              <option>Card</option>
              <option>Cheque</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Reference (optional)</label>
          <input class="form-input" id="mp-ref" placeholder="e.g. bank ref, receipt #">
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-primary" style="flex:1" onclick="saveMarkPaid()">Save Payment</button>
          <button class="btn btn-secondary" onclick="closeModal('mark-paid-modal')">Cancel</button>
        </div>`;
      closeModal('invoice-detail-modal');
      showModal('mark-paid-modal');
    }

    async function saveMarkPaid() {
      const invId = _markPaidInvId;
      if (!invId) return;
      const idx = yInvoices.findIndex(i => i.id === invId);
      if (idx < 0) return;

      const amount = parseFloat(document.getElementById('mp-amount').value) || 0;
      const method = document.getElementById('mp-method').value;
      const ref    = document.getElementById('mp-ref').value.trim();
      const paidAt = document.getElementById('mp-date').value;

      yInvoices[idx].paid_total = parseFloat(yInvoices[idx].paid_total || 0) + amount;
      const fullyPaid = yInvoices[idx].paid_total >= yInvoices[idx].total;
      if (fullyPaid) yInvoices[idx].status = 'paid';
      localStorage.setItem('yield_invoices', JSON.stringify(yInvoices));

      const payment = {
        id: Date.now().toString(),
        invoice_id: invId,
        job_id: yInvoices[idx].job_id || null,
        amount: amount,
        method: method,
        ref: ref,
        paid_at: paidAt,
        created_at: new Date().toISOString()
      };
      yPayments.push(payment);
      localStorage.setItem('yield_payments', JSON.stringify(yPayments));

      if (window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
        const ri = await window.Mise.yieldSync.saveInvoice(yInvoices[idx]);
        if (ri && ri.error) showToast('⚠ Invoice save: ' + (ri.error.message || ri.error));
        const rp = await window.Mise.yieldSync.savePayment(payment);
        if (rp && rp.error) showToast('⚠ Payment save: ' + (rp.error.message || rp.error));
      } else {
        showToast('⚠ Sync not ready — check sign-in');
      }

      // Update quote payment flags + sync to Carte
      const inv = yInvoices[idx];
      if (inv.quote_id) {
        const qi = yQuotes.findIndex(q => q.id === inv.quote_id);
        if (qi >= 0) {
          if (inv.type === 'deposit' && fullyPaid) yQuotes[qi].depositPaid = true;
          if (inv.type === 'balance' && fullyPaid) yQuotes[qi].balancePaid = true;
          localStorage.setItem('yield_quotes', JSON.stringify(yQuotes));
          if (window.Mise.yieldSync) window.Mise.yieldSync.saveQuote(yQuotes[qi]);
          const depPaid = !!yQuotes[qi].depositPaid;
          const balPaid = !!yQuotes[qi].balancePaid;
          const jobKey  = yQuotes[qi].job_id || null;
          if (jobKey && window.Mise.yieldSync && window.Mise.yieldSync.isReady()) {
            window.Mise.yieldSync.syncTabStatusToCarte(jobKey, depPaid, balPaid);
          }
          if (depPaid && balPaid) {
            closeModal('mark-paid-modal');
            renderInvoices();
            renderQuotes();
            showToast('Tab closed 🎉');
            return;
          }
        }
      }

      closeModal('mark-paid-modal');
      renderInvoices();
      renderQuotes();
      showToast(fullyPaid ? 'Payment recorded — invoice fully paid' : 'Payment recorded');
    }

    // ═══════════════════════════════════════════════════════ INVOICES ═══
    function showNewInvoiceModal() {
      showModal('invoice-modal');
      // Populate invoice form
      document.getElementById('invoice-form').innerHTML = `
        <div class="form-group">
          <label class="form-label">From Quote</label>
          <select class="form-input" id="invoice-quote-select">
            <option value="">Select accepted quote</option>
            ${yQuotes.filter(q => q.status === 'accepted').map(quote => {
              const job = yJobs.find(j => j.id === quote.job_id);
              const label = job ? getJobClient(job) : (quote.client_name || 'Standalone');
              const total = parseFloat(quote.price_per_head||0) * parseInt(quote.covers||0);
              return `<option value="${quote.id}">${label} — ${formatCurrency(total)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Invoice Type</label>
          <select class="form-input" id="invoice-type">
            <option value="deposit">Deposit</option>
            <option value="balance">Balance</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="createInvoice()">Create Invoice</button>
      `;
    }

    function createInvoice() {
      const quoteId = document.getElementById('invoice-quote-select').value;
      const type = document.getElementById('invoice-type').value;

      if (!quoteId) {
        showToast('Please select a quote', 'error');
        return;
      }

      const quote = yQuotes.find(q => q.id === quoteId);
      const job = yJobs.find(j => j.id === quote.job_id);

      const depositPct = parseFloat(ySettings.defaultDepositPct || 30) / 100;
      const balanceDueDays = parseInt(ySettings.defaultBalanceDue || 14);
      const quoteTotal = quote.price_per_head * quote.covers;
      const jobDate = job ? getJobDate(job) : '';
      const clientName = job ? getJobClient(job) : '';
      const balanceDue = jobDate
        ? new Date(new Date(jobDate).getTime() - balanceDueDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const invoice = {
        id: Date.now().toString(),
        client_id: job?.client_id,
        client_name: clientName,
        job_id: job?.id,
        job_name: `${clientName} — ${formatDate(jobDate)}`,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: type === 'deposit'
          ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          : balanceDue,
        total: type === 'deposit' ?
          (quoteTotal * depositPct) :
          (quoteTotal * (1 - depositPct)),
        paid_total: 0,
        status: 'draft',
        type: type,
        notes: '',
        created_at: new Date().toISOString()
      };

      yInvoices.push(invoice);
      localStorage.setItem('yield_invoices', JSON.stringify(yInvoices));
      closeModal('invoice-modal');
      renderInvoices();
      showToast('Invoice created');
    }

    function renderInvoices() {
      const tbody = document.getElementById('invoices-table-body');
      const today = new Date(); today.setHours(0,0,0,0);

      let list = yInvoices.map(inv => {
        const isOverdue = inv.status !== 'paid' && inv.due_date && new Date(inv.due_date) < today;
        return Object.assign({}, inv, { _isOverdue: isOverdue });
      });

      if (_invoiceFilter === 'outstanding') list = list.filter(inv => inv.status !== 'paid' && !inv._isOverdue);
      else if (_invoiceFilter === 'paid')   list = list.filter(inv => inv.status === 'paid');
      else if (_invoiceFilter === 'overdue') list = list.filter(inv => inv._isOverdue);

      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px;">No invoices${_invoiceFilter !== 'all' ? ' matching this filter' : ' yet — accept a quote to generate invoices'}</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(inv => {
        const job = yJobs.find(j => j.id === inv.job_id);
        const jobDateDisplay = job ? formatDate(getJobDate(job)) : (inv.job_date ? formatDate(inv.job_date) : '—');
        const clientDisplay  = inv.client_name || (job ? getJobClient(job) : '—');
        const badgeClass  = inv.status === 'paid' ? 'badge-accepted' : inv._isOverdue ? 'badge-declined' : inv.status === 'sent' ? 'badge-sent' : 'badge-draft';
        const statusLabel = inv.status === 'paid' ? 'Paid' : inv._isOverdue ? 'Overdue' : inv.status === 'sent' ? 'Sent' : 'Draft';
        const typeLabel   = inv.type === 'deposit' ? 'Deposit' : 'Balance';
        const rowStyle    = inv._isOverdue ? 'background:rgba(220,53,69,0.05)' : '';
        const dueDateStyle = inv._isOverdue ? 'color:var(--red);font-weight:600' : '';
        const invNum = inv.inv_number || ('INV-' + inv.id.slice(-4).toUpperCase());
        return `
          <tr class="inv-row" style="${rowStyle}" onclick="showInvoiceDetail('${inv.id}')">
            <td style="font-family:monospace;font-size:12px">${invNum}</td>
            <td>${clientDisplay}</td>
            <td>${jobDateDisplay}</td>
            <td><span style="font-size:12px;color:var(--muted)">${typeLabel}</span></td>
            <td style="font-weight:600">${formatCurrency(inv.total)}</td>
            <td style="${dueDateStyle}">${formatDate(inv.due_date)}</td>
            <td style="white-space:nowrap" onclick="event.stopPropagation()">
              <span class="badge ${badgeClass}">${statusLabel}</span>
              <button class="btn btn-ghost" onclick="showSendInvoiceEmailPanel('${inv.id}')" style="padding:4px 8px;font-size:11px;margin-left:4px">✉️</button>
              <button class="btn btn-ghost" onclick="exportInvoicePDF('${inv.id}')" style="padding:4px 8px;font-size:11px;margin-left:2px">PDF</button>
            </td>
          </tr>`;
      }).join('');
    }

    function filterInvoices(status) {
      _invoiceFilter = status;
      document.querySelectorAll('.inv-filter-btn').forEach(btn => {
        btn.className = btn.id === 'inv-filter-' + status ? 'btn btn-primary inv-filter-btn' : 'btn btn-secondary inv-filter-btn';
      });
      renderInvoices();
    }

    // ═══════════════════════════════════════════════════════ JOBS ═══
    function _buildJobCardHTML(job) {
      const jobId = job.id;
      const client = getJobClient(job) || 'Unknown';
      const date = getJobDate(job);
      const covers = getJobCovers(job);
      const type = getJobType(job);

      // Related data
      const jobQuotes   = yQuotes.filter(q => q.job_id === jobId);
      const jobInvs     = yInvoices.filter(inv => inv.job_id === jobId);
      const acceptedQ   = jobQuotes.find(q => q.status === 'accepted') || jobQuotes[0] || null;
      const hasQuote    = jobQuotes.length > 0;
      const isAccepted  = acceptedQ && acceptedQ.status === 'accepted';
      const depPaid     = acceptedQ ? !!acceptedQ.depositPaid : false;
      const balPaid     = acceptedQ ? !!acceptedQ.balancePaid : false;
      const tabClosed   = depPaid && balPaid;
      const hasInvoices = jobInvs.length > 0;
      const unpaidInv   = jobInvs.find(inv => inv.status !== 'paid');

      // Financials
      const totalQuoted   = hasInvoices
        ? jobInvs.reduce((s, inv) => s + parseFloat(inv.total || 0), 0)
        : (acceptedQ ? getQuoteTotal(acceptedQ) : 0);
      const totalReceived = jobInvs.reduce((s, inv) => s + parseFloat(inv.paid_total || 0), 0);
      const outstanding   = Math.max(0, totalQuoted - totalReceived);

      // Status chip
      let chipText, chipColor;
      if (tabClosed)       { chipText = 'Tab closed';    chipColor = 'var(--green)'; }
      else if (depPaid)    { chipText = 'Deposit paid';  chipColor = 'var(--gold)';  }
      else if (isAccepted) { chipText = 'Tab open';      chipColor = 'var(--gold)';  }
      else if (hasQuote)   { chipText = 'Quoted';        chipColor = 'var(--amber)'; }
      else                 { chipText = 'No tab';        chipColor = 'var(--hint)';  }

      const isExpanded = _costingExpandedJobId === jobId;

      // Timeline
      const _dot = (step, done, complete) => {
        const icons = { quoted:'Q', accepted:'A', deposit:'D', balance:'B', closed:'✓' };
        const cls = done ? (complete ? 'complete' : 'done') : '';
        return `<div class="tl-dot ${cls}">${icons[step]}</div>`;
      };
      const _line = (done, complete) =>
        `<div class="tl-line ${done ? (complete ? 'complete' : 'done') : ''}"></div>`;

      const timeline = `
        <div class="timeline-strip" style="margin-bottom:14px;">
          <div class="tl-step">${_dot('quoted', hasQuote, false)}<div class="tl-label ${hasQuote?'done':''}">Quoted</div></div>
          ${_line(hasQuote, false)}
          <div class="tl-step">${_dot('accepted', isAccepted, false)}<div class="tl-label ${isAccepted?'done':''}">Accepted</div></div>
          ${_line(isAccepted, false)}
          <div class="tl-step">${_dot('deposit', depPaid, false)}<div class="tl-label ${depPaid?'done':''}">Deposit<br>Paid</div></div>
          ${_line(depPaid, false)}
          <div class="tl-step">${_dot('balance', balPaid, false)}<div class="tl-label ${balPaid?'done':''}">Balance<br>Paid</div></div>
          ${_line(tabClosed, true)}
          <div class="tl-step">${_dot('closed', tabClosed, true)}<div class="tl-label ${tabClosed?'complete':''}">Tab<br>Closed</div></div>
        </div>`;

      // Financial summary
      const summary = totalQuoted > 0 ? `
        <div style="background:var(--surface-el);border-radius:var(--radius);padding:12px;margin-bottom:12px;">
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Financial Summary</div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;">
            <span style="color:var(--muted)">Total Quoted</span><span>${formatCurrency(totalQuoted)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;">
            <span style="color:var(--muted)">Received</span><span style="color:var(--green)">${formatCurrency(totalReceived)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:6px 0 2px;font-size:14px;font-weight:700;border-top:1px solid var(--border);margin-top:4px;">
            <span>Outstanding</span>
            <span style="color:${outstanding > 0 ? 'var(--gold)' : 'var(--green)'}">${formatCurrency(outstanding)}</span>
          </div>
        </div>` : '';

      // Action buttons
      let btnHTML = '';
      if (!hasQuote) {
        btnHTML += `<button class="btn btn-primary" style="flex:1" onclick="showScreen('quotes')">Open Tab</button>`;
      } else if (isAccepted && !hasInvoices) {
        btnHTML += `<button class="btn btn-primary" style="flex:1" onclick="createJobInvoices('${jobId}')">Create Invoice</button>`;
      } else if (unpaidInv) {
        btnHTML += `<button class="btn btn-primary" style="flex:1" onclick="showMarkPaidModal('${unpaidInv.id}')">Record Payment</button>`;
      }
      if (isAccepted && !tabClosed) {
        btnHTML += `<button class="btn btn-ghost" style="flex:1;border-color:var(--gold);color:var(--gold)" onclick="forceCloseTab('${acceptedQ.id}')">Close Tab</button>`;
        btnHTML += `<button class="btn btn-ghost" style="flex:1;color:var(--red);border-color:var(--red)" onclick="cancelTab('${acceptedQ.id}')">Cancel</button>`;
      }
      btnHTML += `<button class="btn btn-secondary" style="flex:1" onclick="window.location.href='/mise'">View in Carte →</button>`;

      const expandedBody = isExpanded ? `
        <div class="job-expanded-body">
          ${timeline}
          ${summary}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">${btnHTML}</div>
        </div>` : '';

      return `
        <div class="card" style="margin-bottom:10px;">
          <div class="job-card-header" onclick="toggleJob('${jobId}')">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div>
                <div style="font-weight:600;color:var(--text);">${client}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px;">${formatDate(date)} · ${covers} covers · ${type}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:11px;font-weight:600;color:${chipColor};margin-bottom:3px;">${chipText}</div>
                ${totalQuoted > 0 ? `<div style="font-size:12px;color:var(--muted);">${formatCurrency(totalReceived)} / ${formatCurrency(totalQuoted)}</div>` : ''}
                <div style="font-size:11px;color:var(--hint);margin-top:4px;">${isExpanded ? '▲' : '▼'}</div>
              </div>
            </div>
          </div>
          ${expandedBody}
        </div>`;
    }

    function renderJobs() {
      const container = document.getElementById('jobs-list');

      if (yJobs.length === 0) {
        container.innerHTML = '<p style="color:var(--muted);font-size:14px;">No jobs yet — import from Carte to see your bookings here.</p>';
        return;
      }

      const today = new Date(); today.setHours(0, 0, 0, 0);

      const upcoming = yJobs
        .filter(j => { const d = getJobDate(j); return !d || new Date(d) >= today; })
        .sort((a, b) => new Date(getJobDate(a)) - new Date(getJobDate(b)));

      const past = yJobs
        .filter(j => { const d = getJobDate(j); return d && new Date(d) < today; })
        .sort((a, b) => new Date(getJobDate(b)) - new Date(getJobDate(a)));

      let html = upcoming.length === 0
        ? '<p style="color:var(--muted);font-size:14px;margin-bottom:16px;">No upcoming jobs</p>'
        : upcoming.map(_buildJobCardHTML).join('');

      if (past.length > 0) {
        // Group past by month
        const groups = {};
        past.forEach(job => {
          const d = getJobDate(job);
          const label = d
            ? new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
            : 'Unknown';
          if (!groups[label]) groups[label] = [];
          groups[label].push(job);
        });

        const pastHTML = Object.entries(groups).map(([month, jobs]) =>
          `<div class="past-month-label">${month}</div>${jobs.map(_buildJobCardHTML).join('')}`
        ).join('');

        html += `
          <button class="past-jobs-toggle" onclick="togglePastJobs()">
            ${_costingPastJobsOpen ? '▲ Hide' : '▼ View'} previous jobs (${past.length})
          </button>
          <div id="past-jobs-section" style="display:${_costingPastJobsOpen ? 'block' : 'none'};margin-top:8px;">
            ${pastHTML}
          </div>`;
      }

      container.innerHTML = html;
    }

    function toggleJob(id) {
      _costingExpandedJobId = (_costingExpandedJobId === id) ? null : id;
      renderJobs();
    }

    function togglePastJobs() {
      _costingPastJobsOpen = !_costingPastJobsOpen;
      renderJobs();
    }

    function createJobInvoices(jobId) {
      const quote = yQuotes.find(q => q.job_id === jobId && q.status === 'accepted');
      if (!quote) { showToast('No accepted quote found for this job', 'error'); return; }
      _createInvoicesFromQuote(quote);
      showToast('Deposit & balance invoices created');
      renderJobs();
    }

    function forceCloseTab(quoteId) {
      const idx = yQuotes.findIndex(q => q.id === quoteId);
      if (idx < 0) return;
      yQuotes[idx].depositPaid = true;
      yQuotes[idx].balancePaid = true;
      window.Mise.yieldSync.saveQuote(yQuotes[idx]);
      window.Mise.yieldSync.syncTabStatusToCarte(quoteId, true, true);
      showToast('Tab closed 🎉');
      renderJobs();
    }

    function cancelTab(quoteId) {
      const idx = yQuotes.findIndex(q => q.id === quoteId);
      if (idx < 0) return;
      const date = yQuotes[idx].event_date;
      yQuotes[idx].status = 'declined';
      window.Mise.yieldSync.saveQuote(yQuotes[idx]);
      window.Mise.yieldSync.removeQuoteFromCarte(quoteId, date);
      showToast('Tab cancelled');
      renderJobs();
      renderQuotes();
    }

    // ═══════════════════════════════════════════════════════ SETTINGS ═══
    function renderSettings() {
      // Account email (read-only)
      const emailEl = document.getElementById('account-email-display');
      if (emailEl) emailEl.textContent = _userEmail || '—';

      // Yield-specific business settings
      document.getElementById('business-email').value = ySettings.businessEmail || '';
      document.getElementById('business-phone').value = ySettings.businessPhone || '';
      document.getElementById('business-address').value = ySettings.businessAddress || '';
      document.getElementById('business-vat').value = ySettings.businessVat || '';

      // Load default settings
      document.getElementById('default-deposit-pct').value = ySettings.defaultDepositPct || 30;
      document.getElementById('default-balance-due').value = ySettings.defaultBalanceDue || 14;
      document.getElementById('default-quote-validity').value = ySettings.defaultQuoteValidity || 30;
      document.getElementById('default-hourly-rate').value = ySettings.defaultHourlyRate || 25;
      document.getElementById('default-overhead').value = ySettings.defaultOverhead || 80;
      document.getElementById('default-margin').value = ySettings.defaultMargin || 30;
      // Invoice numbering
      const pfxEl = document.getElementById('default-invoice-prefix');
      const ctrEl = document.getElementById('default-invoice-counter');
      if (pfxEl) pfxEl.value = ySettings.invoicePrefix || 'INV';
      if (ctrEl) ctrEl.value = ySettings.invoiceCounter || 1;

      // VAT settings
      const vatEnabledEl = document.getElementById('business-vat-enabled');
      const vatRateEl = document.getElementById('business-vat-rate');
      const vatRateGroup = document.getElementById('vat-rate-group');
      if (vatEnabledEl) vatEnabledEl.checked = !!ySettings.vatEnabled;
      if (vatRateEl) vatRateEl.value = ySettings.vatRate || 20;
      if (vatRateGroup) vatRateGroup.style.display = ySettings.vatEnabled ? 'block' : 'none';

      // Email templates
      const qtEl = document.getElementById('default-quote-template');
      const itEl = document.getElementById('default-invoice-template');
      const rtEl = document.getElementById('default-reminder-template');
      if (qtEl) qtEl.value = ySettings.quoteEmailTemplate || '';
      if (itEl) itEl.value = ySettings.invoiceEmailTemplate || '';
      if (rtEl) rtEl.value = ySettings.reminderEmailTemplate || '';

      // Payment settings
      document.getElementById('payment-instructions').value = ySettings.paymentInstructions || '';
      document.getElementById('payment-link').value = ySettings.paymentLink || '';
      const currEl = document.getElementById('payment-currency');
      if (currEl) currEl.value = ySettings.currency || 'GBP';

      // Bank details (local only)
      document.getElementById('bank-account-name').value = yBank.accountName || '';
      document.getElementById('bank-name').value = yBank.bankName || '';
      document.getElementById('bank-sort-code').value = yBank.sortCode || '';
      document.getElementById('bank-account-number').value = yBank.accountNumber || '';

      // Render saved costings
      renderSavedCostings();
    }

    function toggleVatRate(checked) {
      const el = document.getElementById('vat-rate-group');
      if (el) el.style.display = checked ? 'block' : 'none';
    }

    function _applyTemplate(template, vars) {
      return Object.keys(vars).reduce(function(s, k) {
        return s.split('{' + k + '}').join(vars[k] != null ? vars[k] : '');
      }, template);
    }

    async function saveBusinessSettings() {
      // Yield-only fields (localStorage + cloud)
      ySettings.businessEmail = document.getElementById('business-email').value;
      ySettings.businessPhone = document.getElementById('business-phone').value;
      ySettings.businessAddress = document.getElementById('business-address').value;
      ySettings.businessVat = document.getElementById('business-vat').value;
      ySettings.vatEnabled = document.getElementById('business-vat-enabled').checked;
      ySettings.vatRate = parseFloat(document.getElementById('business-vat-rate').value) || 20;
      localStorage.setItem('yield_settings', JSON.stringify(ySettings));
      if (window.Mise && window.Mise.yieldSync) window.Mise.yieldSync.saveYieldSettings(ySettings);

      showToast('Saved ✓');
    }

    function handleLogoUpload(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        yProfile.logo = e.target.result;
        document.getElementById('logo-img').src = e.target.result;
        document.getElementById('logo-preview').style.display = 'block';
      };
      reader.readAsDataURL(file);
    }

    function saveDefaultSettings() {
      ySettings.defaultDepositPct = document.getElementById('default-deposit-pct').value;
      ySettings.defaultBalanceDue = document.getElementById('default-balance-due').value;
      ySettings.defaultQuoteValidity = document.getElementById('default-quote-validity').value;
      ySettings.defaultHourlyRate = document.getElementById('default-hourly-rate').value;
      ySettings.defaultOverhead = document.getElementById('default-overhead').value;
      ySettings.defaultMargin = document.getElementById('default-margin').value;
      const pfxEl = document.getElementById('default-invoice-prefix');
      const ctrEl = document.getElementById('default-invoice-counter');
      if (pfxEl) ySettings.invoicePrefix = pfxEl.value.trim() || 'INV';
      if (ctrEl) ySettings.invoiceCounter = parseInt(ctrEl.value) || 1;
      const qtEl = document.getElementById('default-quote-template');
      const itEl = document.getElementById('default-invoice-template');
      const rtEl = document.getElementById('default-reminder-template');
      if (qtEl) ySettings.quoteEmailTemplate = qtEl.value;
      if (itEl) ySettings.invoiceEmailTemplate = itEl.value;
      if (rtEl) ySettings.reminderEmailTemplate = rtEl.value;
      localStorage.setItem('yield_settings', JSON.stringify(ySettings));
      if (window.Mise && window.Mise.yieldSync) window.Mise.yieldSync.saveYieldSettings(ySettings);
      showToast('Default settings saved');
    }

    // ─────────────────────── STRIPE CONNECT (chef onboarding) ────────────
    function _yieldUid() {
      try { return (window.Mise && window.Mise.yieldSync && window.Mise.yieldSync.uid && window.Mise.yieldSync.uid())
        || (yProfile && yProfile.id)
        || (JSON.parse(localStorage.getItem('yield_profile') || '{}').id); }
      catch (e) { return null; }
    }

    function renderStripeConnectCard() {
      const body = document.getElementById('stripe-connect-body');
      if (!body) return;

      const status = yProfile ? yProfile.stripe_account_status : null;
      const hasAcct = yProfile && yProfile.stripe_account_id;

      if (!hasAcct) {
        body.innerHTML =
          '<p style="margin: 0 0 12px; color: var(--text); line-height: 1.5;">' +
            'Connect Stripe so clients can pay deposits and balances by card from your quote portal. ' +
            'Funds go directly into your Stripe account — Mise Labs never holds them, and we charge no fee on top of Stripe’s standard rates.' +
          '</p>' +
          '<button class="btn btn-primary" onclick="connectStripeAccount()" id="stripe-connect-btn" style="width:100%;">Connect Stripe</button>';
        return;
      }

      if (status === 'active') {
        body.innerHTML =
          '<p style="margin:0 0 12px; color: var(--accent); font-weight:600;">✓ Card payments active</p>' +
          '<p style="margin:0 0 12px; color: var(--muted); font-size:13px;">Clients can pay deposits and balances directly from the quote link.</p>' +
          '<button class="btn btn-ghost" onclick="openStripeDashboard()" style="width:100%; margin-bottom:8px;">Open Stripe Dashboard</button>' +
          '<button class="btn btn-ghost" onclick="refreshStripeStatus(true)" style="width:100%;">Refresh status</button>';
        return;
      }

      // pending / restricted / rejected
      const label = status === 'pending' ? 'Onboarding incomplete'
                  : status === 'restricted' ? 'Account restricted by Stripe'
                  : status === 'rejected' ? 'Account rejected by Stripe'
                  : 'Status unknown';
      body.innerHTML =
        '<p style="margin:0 0 12px; color: var(--text); line-height: 1.5;">' +
          '<strong>' + label + '.</strong> Finish the onboarding form so you can accept card payments.' +
        '</p>' +
        '<button class="btn btn-primary" onclick="connectStripeAccount()" style="width:100%; margin-bottom:8px;">Continue Stripe Onboarding</button>' +
        '<button class="btn btn-ghost" onclick="refreshStripeStatus(true)" style="width:100%;">Refresh status</button>';
    }

    async function connectStripeAccount() {
      const uid = _yieldUid();
      if (!uid) { showToast('Sign in first'); return; }
      const btn = document.getElementById('stripe-connect-btn');
      if (btn) { btn.innerHTML = 'Opening Stripe…'; btn.disabled = true; }
      try {
        const res = await fetch('/api/stripe-connect?action=onboard&uid=' + encodeURIComponent(uid));
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || 'Could not start onboarding');
        window.location.href = data.url;
      } catch (err) {
        console.error('[Yield] connect:', err);
        showToast('Stripe error: ' + (err.message || 'unknown'));
        if (btn) { btn.innerHTML = 'Connect Stripe'; btn.disabled = false; }
      }
    }

    async function refreshStripeStatus(showFeedback) {
      const uid = _yieldUid();
      if (!uid) return;
      try {
        const res = await fetch('/api/stripe-connect?action=refresh&uid=' + encodeURIComponent(uid));
        const data = await res.json();
        if (res.ok) {
          if (!yProfile) yProfile = {};
          yProfile.stripe_account_status = data.status;
          try {
            const cached = JSON.parse(localStorage.getItem('yield_profile') || '{}');
            cached.stripe_account_status = data.status;
            localStorage.setItem('yield_profile', JSON.stringify(cached));
          } catch (e) {}
          renderStripeConnectCard();
          if (showFeedback) showToast(data.status === 'active' ? 'Card payments active ✓' : 'Status updated');
        } else if (showFeedback) {
          showToast('Refresh failed');
        }
      } catch (err) {
        console.error('[Yield] refresh:', err);
        if (showFeedback) showToast('Refresh failed');
      }
    }

    async function openStripeDashboard() {
      const uid = _yieldUid();
      if (!uid) return;
      try {
        const res = await fetch('/api/stripe-connect?action=dashboard&uid=' + encodeURIComponent(uid));
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || 'Could not open dashboard');
        window.open(data.url, '_blank');
      } catch (err) {
        console.error('[Yield] dashboard:', err);
        showToast('Dashboard error: ' + (err.message || 'unknown'));
      }
    }

    function savePaymentSettings() {
      ySettings.paymentInstructions = document.getElementById('payment-instructions').value;
      ySettings.paymentLink = document.getElementById('payment-link').value;
      ySettings.currency = document.getElementById('payment-currency').value;
      localStorage.setItem('yield_settings', JSON.stringify(ySettings));
      if (window.Mise && window.Mise.yieldSync) window.Mise.yieldSync.saveYieldSettings(ySettings);

      // Bank details stored locally only — never synced to Supabase
      yBank.accountName = document.getElementById('bank-account-name').value;
      yBank.bankName = document.getElementById('bank-name').value;
      yBank.sortCode = document.getElementById('bank-sort-code').value;
      yBank.accountNumber = document.getElementById('bank-account-number').value;
      localStorage.setItem('yield_bank', JSON.stringify(yBank));
      showToast('Payment settings saved');
    }

    function copyBankDetails() {
      const b = yBank;
      const parts = [];
      if (b.accountName) parts.push('Account Name: ' + b.accountName);
      if (b.bankName)    parts.push('Bank: ' + b.bankName);
      if (b.sortCode)    parts.push('Sort Code: ' + b.sortCode);
      if (b.accountNumber) parts.push('Account Number: ' + b.accountNumber);
      if (ySettings.paymentInstructions) parts.push('', ySettings.paymentInstructions);
      if (parts.length === 0) { showToast('No bank details saved yet', 'error'); return; }
      const text = parts.join('\n');
      const btn = document.getElementById('copy-bank-btn');
      const _flash = () => { btn.textContent = 'Copied ✓'; btn.style.color = 'var(--gold)'; setTimeout(() => { btn.textContent = 'Copy bank details'; btn.style.color = ''; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(_flash);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); _flash();
      }
    }

    // ═══════════════════════════════════════════════════════ PDF EXPORT ═══
    function exportQuotePDF(quoteId) {
      const quote = yQuotes.find(q => q.id === quoteId);
      if (!quote) {
        showToast('Quote not found', 'error');
        return;
      }

      const job = yJobs.find(j => j.id === quote.job_id);
      const client = yClients.find(c => c.id === job?.client_id);

      buildQuotePDF(quote, job, client);
    }

    function _pdfStyles(accentColor) {
      return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1A1A18; background: #fff; padding: 32px; font-size: 13px; line-height: 1.5; }
    .toolbar { position: sticky; top: 0; z-index: 10; background: #fff; border-bottom: 1px solid #E5E3DC; padding: 10px 0; margin: -32px -32px 28px; padding-left: 32px; display: flex; gap: 10px; align-items: center; }
    .btn-pdf { background: ${accentColor}; color: #fff; border: none; border-radius: 6px; padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-close { background: #fff; color: #555; border: 1px solid #ccc; border-radius: 6px; padding: 10px 14px; font-size: 14px; cursor: pointer; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; margin-bottom: 24px; border-bottom: 2px solid ${accentColor}; }
    .logo-img { max-height: 56px; max-width: 160px; object-fit: contain; margin-bottom: 8px; display: block; }
    .business-name { font-size: 18px; font-weight: 700; color: #1A1A18; margin-bottom: 2px; }
    .business-info { font-size: 11px; color: #6B6860; line-height: 1.7; margin-top: 6px; }
    .doc-type { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${accentColor}; margin-bottom: 6px; }
    .doc-number { font-size: 13px; font-weight: 600; color: #1A1A18; }
    .doc-date { font-size: 12px; color: #6B6860; margin-top: 4px; }
    .status-chip { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 8px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6B6860; margin-bottom: 6px; }
    .section-value { color: #1A1A18; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    thead th { background: #F5F4F0; padding: 9px 12px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #6B6860; border-bottom: 1px solid #E5E3DC; }
    tbody td { padding: 11px 12px; border-bottom: 1px solid #F0EDE8; font-size: 13px; color: #1A1A18; }
    .totals { background: #F5F4F0; border-radius: 6px; padding: 16px; margin: 16px 0; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .totals-row.grand { font-weight: 700; font-size: 15px; color: ${accentColor}; border-top: 1px solid #E5E3DC; padding-top: 12px; margin-top: 6px; }
    .totals-label { color: #6B6860; }
    .totals-value { font-weight: 500; }
    .bank-box { background: #F5F4F0; border-left: 3px solid ${accentColor}; border-radius: 0 6px 6px 0; padding: 14px 16px; margin: 16px 0; font-size: 12px; color: #1A1A18; line-height: 1.8; }
    .bank-box strong { color: ${accentColor}; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; display: block; margin-bottom: 6px; }
    .validity-box { background: #FFFEF7; border: 1px solid #E8E2C8; border-radius: 6px; padding: 12px 16px; margin: 16px 0; font-size: 12px; color: #6B6860; }
    .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #E5E3DC; display: flex; justify-content: space-between; font-size: 10px; color: #9A9890; }
    @media print {
      @page { size: A4; margin: 16mm 18mm; }
      .no-print { display: none !important; }
      body { padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }`;
    }

    function buildQuotePDF(quote, job, client) {
      function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }

      const businessName = yProfile.business_name || ySettings.businessName || 'Private Chef';
      const chefName     = yProfile.chef_name || '';
      const logo         = yProfile.logo || '';
      const businessEmail   = ySettings.businessEmail || '';
      const businessPhone   = ySettings.businessPhone || '';
      const businessAddress = ySettings.businessAddress || '';
      const businessVat     = ySettings.businessVat || '';
      const paymentInstructions = ySettings.paymentInstructions || '';

      const clientName = client?.name || (job ? getJobClient(job) : quote.client_name) || 'Client';
      const jobDate    = job ? formatDate(getJobDate(job)) : (quote.event_date ? formatDate(quote.event_date) : 'TBD');
      const covers     = parseInt(quote.covers || 0);
      const pricePerHead  = parseFloat(quote.price_per_head || 0);
      const cateringTotal = covers * pricePerHead;
      const extras        = quote.extras || [];
      const extrasTotal   = extras.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
      const subTotal      = cateringTotal + extrasTotal;
      const vatEnabled    = !!ySettings.vatEnabled;
      const vatRate       = parseFloat(ySettings.vatRate || 20) / 100;
      const vatAmount     = vatEnabled ? subTotal * vatRate : 0;
      const totalPrice    = subTotal + vatAmount;
      const depositPct    = parseFloat(ySettings.defaultDepositPct || 30) / 100;
      const depositAmount = totalPrice * depositPct;
      const balanceAmount = totalPrice - depositAmount;
      const balanceDays   = parseInt(ySettings.defaultBalanceDue || 14);

      const now = new Date();
      const quoteDate = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const quoteValidityDays = parseInt(ySettings.defaultQuoteValidity || 30);
      const validUntil = new Date(now.getTime() + quoteValidityDays * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const quoteNum = 'Q-' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + quote.id.slice(-4).toUpperCase();

      const businessLines = [
        chefName && chefName !== businessName ? esc(chefName) : '',
        businessAddress ? esc(businessAddress) : '',
        businessEmail   ? esc(businessEmail)   : '',
        businessPhone   ? esc(businessPhone)   : '',
        businessVat     ? 'VAT: ' + esc(businessVat) : ''
      ].filter(Boolean).join('<br>');

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Quote ${quoteNum} — ${esc(businessName)}</title>
  <style>${_pdfStyles('#B8941F')}</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="btn-pdf" onclick="window.print()">⬇ Save as PDF</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>

  <div class="header">
    <div>
      ${logo ? `<img class="logo-img" src="${logo}" alt="logo">` : ''}
      <div class="business-name">${esc(businessName)}</div>
      <div class="business-info">${businessLines}</div>
    </div>
    <div style="text-align:right">
      <div class="doc-type">Quotation</div>
      <div class="doc-number">${esc(quoteNum)}</div>
      <div class="doc-date">${esc(quoteDate)}</div>
      <div class="doc-date">Valid until ${esc(validUntil)}</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="section-label">Prepared for</div>
      <div class="section-value" style="font-weight:600">${esc(clientName)}</div>
    </div>
    <div>
      <div class="section-label">Event Details</div>
      <div class="section-value">${esc(jobDate)}</div>
      <div class="section-value" style="color:#6B6860">${covers} covers</div>
    </div>
  </div>

  ${quote.notes ? `<div class="bank-box" style="margin-bottom:20px"><strong>Notes</strong>${esc(quote.notes)}</div>` : ''}

  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Unit price</th><th style="text-align:right">Qty</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>
      <tr>
        <td>Private chef services — per head</td>
        <td style="text-align:right">${formatCurrency(pricePerHead)}</td>
        <td style="text-align:right">${covers}</td>
        <td style="text-align:right">${formatCurrency(cateringTotal)}</td>
      </tr>
      ${extras.map(e => `<tr>
        <td>${esc(e.label || 'Extra')}</td>
        <td style="text-align:right">—</td>
        <td style="text-align:right">—</td>
        <td style="text-align:right">${formatCurrency(e.amount)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    ${vatEnabled ? `
    <div class="totals-row"><span class="totals-label">Subtotal (ex. VAT)</span><span class="totals-value">${formatCurrency(subTotal)}</span></div>
    <div class="totals-row"><span class="totals-label">VAT (${Math.round(vatRate * 100)}%)</span><span class="totals-value">${formatCurrency(vatAmount)}</span></div>
    <div class="totals-row grand"><span>Total inc. VAT</span><span>${formatCurrency(totalPrice)}</span></div>
    ` : `
    <div class="totals-row grand"><span>Total</span><span>${formatCurrency(totalPrice)}</span></div>
    `}
  </div>

  <table>
    <thead><tr><th>Payment schedule</th><th style="text-align:right">Amount</th><th>Due</th></tr></thead>
    <tbody>
      <tr>
        <td>Deposit (${(depositPct*100).toFixed(0)}%)${vatEnabled ? ' <span style="font-size:11px;color:#6B6860">inc. VAT</span>' : ''}</td>
        <td style="text-align:right">${formatCurrency(depositAmount)}</td>
        <td>On acceptance</td>
      </tr>
      <tr>
        <td>Balance${vatEnabled ? ' <span style="font-size:11px;color:#6B6860">inc. VAT</span>' : ''}</td>
        <td style="text-align:right">${formatCurrency(balanceAmount)}</td>
        <td>${balanceDays} days before event</td>
      </tr>
    </tbody>
  </table>

  ${paymentInstructions ? `<div class="bank-box"><strong>Bank &amp; Payment Details</strong>${esc(paymentInstructions)}</div>` : ''}

  <div class="footer">
    <span>${esc(businessName)}${businessEmail ? ' · ' + esc(businessEmail) : ''}</span>
    <span>${esc(quoteNum)}</span>
  </div>
</body>
</html>`;

      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to view the PDF', 'error'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    }

    function exportInvoicePDF(invoiceId) {
      const invoice = yInvoices.find(i => i.id === invoiceId);
      if (!invoice) {
        showToast('Invoice not found', 'error');
        return;
      }

      const job = yJobs.find(j => j.id === invoice.job_id);
      const client = yClients.find(c => c.id === invoice.client_id);

      buildInvoicePDF(invoice, job, client);
    }

    function buildInvoicePDF(invoice, job, client) {
      function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }

      const businessName = yProfile.business_name || ySettings.businessName || 'Private Chef';
      const chefName     = yProfile.chef_name || '';
      const logo         = yProfile.logo || '';
      const businessEmail   = ySettings.businessEmail || '';
      const businessPhone   = ySettings.businessPhone || '';
      const businessAddress = ySettings.businessAddress || '';
      const businessVat     = ySettings.businessVat || '';
      const paymentInstructions = ySettings.paymentInstructions || '';

      const clientName = client?.name || invoice.client_name || 'Client';
      const invoiceDate = formatDate(invoice.invoice_date) || formatDate(invoice.created_at) || '';
      const dueDate     = formatDate(invoice.due_date) || '';
      const depositPct  = parseFloat(ySettings.defaultDepositPct || 30) / 100;

      const now = new Date();
      const invoiceNum = 'INV-' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + invoice.id.slice(-4).toUpperCase();

      const total      = parseFloat(invoice.total || 0);
      const paidTotal  = parseFloat(invoice.paid_total || 0);
      const outstanding = total - paidTotal;
      const isPaid = invoice.status === 'paid';
      const statusLabel = isPaid ? 'PAID' : 'OUTSTANDING';
      const statusBg    = isPaid ? '#E8F5EE' : '#FEF9EC';
      const statusColor = isPaid ? '#1A7A40' : '#8A6300';

      const businessLines = [
        chefName && chefName !== businessName ? esc(chefName) : '',
        businessAddress ? esc(businessAddress) : '',
        businessEmail   ? esc(businessEmail)   : '',
        businessPhone   ? esc(businessPhone)   : '',
        businessVat     ? 'VAT No: ' + esc(businessVat) : ''
      ].filter(Boolean).join('<br>');

      const invoiceTypeLabel = invoice.type === 'deposit'
        ? `Deposit (${(depositPct*100).toFixed(0)}% of total)`
        : 'Balance payment';

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invoice ${invoiceNum} — ${esc(businessName)}</title>
  <style>${_pdfStyles('#B8941F')}</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="btn-pdf" onclick="window.print()">⬇ Save as PDF</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>

  <div class="header">
    <div>
      ${logo ? `<img class="logo-img" src="${logo}" alt="logo">` : ''}
      <div class="business-name">${esc(businessName)}</div>
      <div class="business-info">${businessLines}</div>
    </div>
    <div style="text-align:right">
      <div class="doc-type">Invoice</div>
      <div class="doc-number">${esc(invoiceNum)}</div>
      <div class="doc-date">Issued: ${esc(invoiceDate)}</div>
      <div class="doc-date">Due: ${esc(dueDate)}</div>
      <div style="margin-top:10px">
        <span class="status-chip" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
      </div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="section-label">Bill to</div>
      <div class="section-value" style="font-weight:600">${esc(clientName)}</div>
    </div>
    <div style="text-align:right">
      <div class="section-label">Invoice date</div>
      <div class="section-value">${esc(invoiceDate)}</div>
      <div class="section-label" style="margin-top:10px">Due date</div>
      <div class="section-value">${esc(dueDate)}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>${esc(invoiceTypeLabel)}${job ? ' — ' + esc(getJobClient(job)) : ''}</td>
        <td style="text-align:right;font-weight:600">${formatCurrency(total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span class="totals-label">Amount due</span><span class="totals-value">${formatCurrency(total)}</span></div>
    <div class="totals-row"><span class="totals-label">Amount received</span><span class="totals-value">${formatCurrency(paidTotal)}</span></div>
    <div class="totals-row grand"><span>Outstanding</span><span>${formatCurrency(outstanding)}</span></div>
  </div>

  ${paymentInstructions ? `<div class="bank-box"><strong>Bank &amp; Payment Details</strong>${esc(paymentInstructions)}</div>` : ''}

  <div class="footer">
    <span>${esc(businessName)}${businessEmail ? ' · ' + esc(businessEmail) : ''}</span>
    <span>${esc(invoiceNum)}</span>
  </div>
</body>
</html>`;

      const w = window.open('', '_blank');
      if (!w) { showToast('Allow pop-ups to view the PDF', 'error'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    }

    // ═══════════════════════════════════════════════════════ PORTAL ═══
    function openVeriqo() { window.location.href = '/app'; }
    function openCarte() { if (typeof showModule === 'function') showModule('menus'); else window.location.href = '/app'; }

    async function openYieldPortal() {
      try {
        showToast('Opening billing portal…');
        const sb = window.supabaseClient || supabaseClient;
        const sess = await sb.auth.getSession();
        const token = sess.data.session.access_token;
        const res = await fetch('https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/create-portal-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
        });
        const json = await res.json();
        if (json.url) window.location.href = json.url;
        else showToast('Could not open billing portal');
      } catch (e) {
        showToast('Could not open billing portal');
      }
    }

    // ═══════════════════════════════════════════════════════ INIT ═══
    // auth.init() is called by app.html — do not call it again here

    // Add event listeners for live calculation
    document.getElementById('costing-covers').addEventListener('input', calculateCosting);
    document.getElementById('costing-wastage').addEventListener('input', calculateCosting);
    document.getElementById('costing-hourly-rate').addEventListener('input', calculateCosting);
    document.getElementById('costing-hours').addEventListener('input', calculateCosting);
    document.getElementById('costing-miles').addEventListener('input', calculateCosting);
    document.getElementById('costing-margin').addEventListener('input', calculateCosting);
    document.getElementById('costing-overhead').addEventListener('input', calculateCosting);
    document.addEventListener('input', function(e) {
      const row = e.target.closest('.ingredient-row');
      if (row) {
        updateIngredientRowTotal(row);
        calculateCosting();
      }
    });

// ═══════════════════════════════════════════════════════ MODULE EXPORT ═══
// Exposes init() for the unified app shell (showModule calls this on first visit)
window.modules = window.modules || {};
window.modules.costing = {
  init: function() {
    // Hydrate in-memory state from localStorage immediately
    loadLocalData();
    renderDashboard();
    renderQuotes();
    renderInvoices();
    renderJobs();
    renderSettings();

    // Init yieldSync with the authenticated user and pull remote data
    var profile = window.Mise && window.Mise.profile;
    var uid = profile && profile.id;
    if (uid && window.Mise && window.Mise.yieldSync) {
      var sb = (typeof supabaseClient !== 'undefined') ? supabaseClient : null;
      Promise.resolve(window.Mise.yieldSync.init(sb, uid)).then(function() {
        return loadRemoteData();
      }).then(function() {
        renderDashboard();
        renderQuotes();
        renderInvoices();
        renderJobs();
      }).catch(function(e) {
        console.warn('[Costing] remote sync failed:', e);
      });
    }

    // Check subscription / paywall
    if (uid && window.Mise.yieldSubscription) {
      window.Mise.yieldSubscription.check(uid);
    }
    renderStripeConnectCard();
  }
};

// Unified shell stubs
function openVeriqo() { if (typeof showModule === 'function') showModule('haccp'); }
function openMise() { if (typeof showModule === 'function') showModule('menus'); }
