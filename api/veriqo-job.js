// api/veriqo-job.js
// GET   ?id=<jobId>                  — fetch a single job
// GET   (no params)                  — list jobs for the authenticated user
// PATCH { id, quoted_price_pence }   — set the quoted price on an estimated job
// POST  { jobId, action, ... }       — reconcile a job (action: 'quick' | 'manual')

const { createClient } = require('@supabase/supabase-js');

let _sb;
function getSB() {
  if (!_sb) _sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  return _sb;
}

async function verifyUser(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

function calculateFinancials(slots, quotedPricePence) {
  const reconciled = slots.filter(s => s.reconciled && s.actual_spend_pence !== null);
  const totalEstimated = reconciled.reduce((s, x) => s + x.estimated_portion_cost_pence, 0);
  const totalActual = reconciled.reduce((s, x) => s + x.actual_spend_pence, 0);
  const variance_pence = totalActual - totalEstimated;
  const variance_percentage = totalEstimated === 0 ? 0 : Math.round((variance_pence / totalEstimated) * 100);
  if (quotedPricePence === null) {
    return { total_estimated_cost_pence: totalEstimated, total_actual_cost_pence: totalActual,
             variance_pence, variance_percentage,
             estimated_margin_pence: null, actual_margin_pence: null, actual_margin_percentage: null };
  }
  const estimated_margin_pence = quotedPricePence - totalEstimated;
  const actual_margin_pence = quotedPricePence - totalActual;
  const actual_margin_percentage = quotedPricePence === 0 ? 0
    : Math.round((actual_margin_pence / quotedPricePence) * 100);
  return { total_estimated_cost_pence: totalEstimated, total_actual_cost_pence: totalActual,
           variance_pence, variance_percentage,
           estimated_margin_pence, actual_margin_pence, actual_margin_percentage };
}

function mapRow(row) {
  const job = {
    id: row.id,
    userId: row.user_id,
    dish_name: row.dish_name,
    serves: row.serves,
    service_style: row.service_style,
    reconciliation_status: row.reconciliation_status,
    reconciliation_method: row.reconciliation_method ?? null,
    vat_registered: row.vat_registered,
    quoted_price_pence: row.quoted_price_pence ?? null,
    post_job_actuals: row.post_job_actuals || [],
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
  if (row.financials) job.financials = row.financials;
  return job;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://getveriqo.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const userId = await verifyUser(token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session' });

  const sb = getSB();

  try {
    if (req.method === 'GET') {
      const { id, limit = '20', offset = '0' } = req.query || {};

      if (id) {
        const { data, error } = await sb.rpc('costing_get_job', { p_id: id, p_user_id: userId });
        if (error) throw new Error(error.message || 'Database error');
        if (!data) return res.status(404).json({ error: 'Job not found' });
        return res.status(200).json(mapRow(data));
      }

      const pageLimit = Math.min(Number(limit) || 20, 100);
      const pageOffset = Math.max(Number(offset) || 0, 0);
      const { data, error } = await sb.rpc('costing_list_jobs', {
        p_user_id: userId,
        p_limit: pageLimit,
        p_offset: pageOffset,
      });
      if (error) throw new Error(error.message || 'Database error');
      const jobs = Array.isArray(data) ? data : [];
      return res.status(200).json({ jobs: jobs.map(mapRow), limit: pageLimit, offset: pageOffset });
    }

    if (req.method === 'PATCH') {
      const { id, quoted_price_pence } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      if (quoted_price_pence !== undefined) {
        if (!Number.isInteger(quoted_price_pence) || quoted_price_pence < 0) {
          return res.status(400).json({ error: 'quoted_price_pence must be a non-negative integer' });
        }
      }

      const now = new Date().toISOString();
      const { data, error } = await sb.rpc('costing_set_quoted_price', {
        p_id: id,
        p_user_id: userId,
        p_quoted_price_pence: quoted_price_pence ?? null,
        p_updated_at: now,
      });
      if (error) throw new Error(error.message || 'Database error');
      if (!data) return res.status(404).json({ error: 'Job not found' });
      return res.status(200).json(mapRow(data));
    }

    if (req.method === 'POST') {
      const { jobId, action } = req.body || {};
      if (!jobId || !action) return res.status(400).json({ error: 'jobId and action are required' });

      const { data: jobData, error: jobErr } = await sb.rpc('costing_get_job', {
        p_id: jobId,
        p_user_id: userId,
      });
      if (jobErr) throw new Error(jobErr.message || 'Database error');
      if (!jobData) return res.status(404).json({ error: 'Job not found' });

      const row = jobData;
      if (row.reconciliation_status === 'reconciled') {
        return res.status(409).json({ error: 'Job already fully reconciled' });
      }

      let slots = row.post_job_actuals || [];
      let newStatus, newMethod, financials;
      const now = new Date().toISOString();

      if (!slots.length) {
        return res.status(400).json({ error: 'Cannot reconcile a job with no ingredients' });
      }

      if (action === 'quick') {
        const { totalActualSpendPence } = req.body;
        if (typeof totalActualSpendPence !== 'number' || !Number.isInteger(totalActualSpendPence) || totalActualSpendPence < 0) {
          return res.status(400).json({ error: 'totalActualSpendPence must be a non-negative integer' });
        }
        const totalEstimated = slots.reduce((s, x) => s + x.estimated_portion_cost_pence, 0);
        slots = slots.map(slot => {
          const proportion = totalEstimated === 0 ? 1 / slots.length : slot.estimated_portion_cost_pence / totalEstimated;
          return { ...slot, actual_spend_pence: Math.round(totalActualSpendPence * proportion), reconciled: true, vat_rate_applied: slot.vat_rate_applied ?? 0 };
        });
        const drift = totalActualSpendPence - slots.reduce((s, x) => s + x.actual_spend_pence, 0);
        if (drift !== 0) slots[slots.length - 1].actual_spend_pence += drift;
        newStatus = 'reconciled_total_only';
        newMethod = 'quick_total';
        financials = calculateFinancials(slots, row.quoted_price_pence);

      } else if (action === 'manual') {
        const { actuals } = req.body;
        if (!Array.isArray(actuals) || !actuals.length) return res.status(400).json({ error: 'actuals array is required' });
        const actualsMap = {};
        for (const a of actuals) {
          if (typeof a.ingredient_name !== 'string') continue;
          if (!Number.isInteger(a.actual_spend_pence) || a.actual_spend_pence < 0) continue;
          if (![0, 20].includes(a.vat_rate_applied)) continue;
          actualsMap[a.ingredient_name.toLowerCase().trim()] = a;
        }
        slots = slots.map(slot => {
          const match = actualsMap[slot.ingredient_name.toLowerCase().trim()];
          if (!match) return slot;
          return { ...slot, actual_spend_pence: match.actual_spend_pence, reconciled: true, vat_rate_applied: match.vat_rate_applied };
        });
        const reconciledCount = slots.filter(s => s.reconciled).length;
        newStatus = reconciledCount === slots.length ? 'reconciled' : 'partial';
        newMethod = 'manual_entry';
        financials = calculateFinancials(slots, row.quoted_price_pence);

      } else {
        return res.status(400).json({ error: 'action must be "quick" or "manual"' });
      }

      const { error: reconcileErr } = await sb.rpc('costing_reconcile_job', {
        p_id: jobId,
        p_user_id: userId,
        p_status: newStatus,
        p_method: newMethod,
        p_actuals: slots,
        p_financials: financials,
        p_updated_at: now,
      });
      if (reconcileErr) throw new Error(reconcileErr.message || 'Failed to save reconciliation');

      return res.status(200).json({
        id: row.id, userId: row.user_id, dish_name: row.dish_name, serves: row.serves,
        service_style: row.service_style, reconciliation_status: newStatus,
        reconciliation_method: newMethod, vat_registered: row.vat_registered,
        quoted_price_pence: row.quoted_price_pence, post_job_actuals: slots, financials,
        created_at: row.created_at,
        updated_at: now,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[veriqo-job]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
