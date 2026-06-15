// api/veriqo-reconcile.js
// POST { jobId, action, ...params }
//
// action = 'quick'   — { jobId, action: 'quick', totalActualSpendPence: number }
//   Distributes a single total spend proportionally across all slots.
//   Marks reconciliation_status = 'reconciled_total_only'.
//
// action = 'manual'  — { jobId, action: 'manual', actuals: [{ ingredient_name, actual_spend_pence, vat_rate_applied }] }
//   Updates named slots with real per-ingredient spend.
//   Marks status = 'reconciled' (all slots) or 'partial' (some slots).

const { Pool } = require('pg');

let _pool;
function getPool() {
  if (!_pool) _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
  return _pool;
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://getveriqo.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const userId = await verifyUser(token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session' });

  const { jobId, action } = req.body || {};
  if (!jobId || !action) return res.status(400).json({ error: 'jobId and action are required' });

  try {
    const db = getPool();

    const jobRes = await db.query(
      'SELECT * FROM costing.jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (!jobRes.rows.length) return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });

    const row = jobRes.rows[0];
    if (row.reconciliation_status === 'reconciled') {
      return res.status(409).json({ error: 'Job already fully reconciled', code: 'RECONCILIATION_ALREADY_COMPLETE' });
    }

    let slots = row.post_job_actuals;
    let newStatus, newMethod, financials;
    const now = new Date().toISOString();

    if (action === 'quick') {
      const { totalActualSpendPence } = req.body;
      if (typeof totalActualSpendPence !== 'number' || !Number.isInteger(totalActualSpendPence) || totalActualSpendPence < 0) {
        return res.status(400).json({ error: 'totalActualSpendPence must be a non-negative integer' });
      }

      const totalEstimated = slots.reduce((s, x) => s + x.estimated_portion_cost_pence, 0);

      slots = slots.map(slot => {
        const proportion = totalEstimated === 0
          ? 1 / slots.length
          : slot.estimated_portion_cost_pence / totalEstimated;
        return {
          ...slot,
          actual_spend_pence: Math.round(totalActualSpendPence * proportion),
          reconciled: true,
          vat_rate_applied: slot.vat_rate_applied ?? 0,
        };
      });

      // Correct rounding drift on the last slot
      const allocatedSum = slots.reduce((s, x) => s + x.actual_spend_pence, 0);
      const drift = totalActualSpendPence - allocatedSum;
      if (drift !== 0) slots[slots.length - 1].actual_spend_pence += drift;

      newStatus = 'reconciled_total_only';
      newMethod = 'quick_total';
      financials = calculateFinancials(slots, row.quoted_price_pence);

    } else if (action === 'manual') {
      const { actuals } = req.body;
      if (!Array.isArray(actuals) || !actuals.length) {
        return res.status(400).json({ error: 'actuals array is required' });
      }

      const actualsMap = {};
      for (const a of actuals) {
        if (typeof a.ingredient_name !== 'string') continue;
        if (!Number.isInteger(a.actual_spend_pence) || a.actual_spend_pence < 0) continue;
        if (![0, 20].includes(a.vat_rate_applied)) continue;
        actualsMap[a.ingredient_name.toLowerCase().trim()] = a;
      }

      slots = slots.map(slot => {
        const key = slot.ingredient_name.toLowerCase().trim();
        const match = actualsMap[key];
        if (!match) return slot;
        return {
          ...slot,
          actual_spend_pence: match.actual_spend_pence,
          reconciled: true,
          vat_rate_applied: match.vat_rate_applied,
        };
      });

      const totalSlots = slots.length;
      const reconciledCount = slots.filter(s => s.reconciled).length;
      newStatus = reconciledCount === totalSlots ? 'reconciled' : 'partial';
      newMethod = 'manual_entry';
      financials = calculateFinancials(slots, row.quoted_price_pence);

    } else {
      return res.status(400).json({ error: 'action must be "quick" or "manual"' });
    }

    await db.query(
      `UPDATE costing.jobs
       SET reconciliation_status = $1, reconciliation_method = $2,
           post_job_actuals = $3, financials = $4, updated_at = $5
       WHERE id = $6`,
      [newStatus, newMethod, JSON.stringify(slots), JSON.stringify(financials), now, jobId]
    );

    return res.status(200).json({
      id: row.id,
      userId: row.user_id,
      dish_name: row.dish_name,
      serves: row.serves,
      service_style: row.service_style,
      reconciliation_status: newStatus,
      reconciliation_method: newMethod,
      vat_registered: row.vat_registered,
      quoted_price_pence: row.quoted_price_pence,
      post_job_actuals: slots,
      financials,
      created_at: row.created_at.toISOString(),
      updated_at: now,
    });

  } catch (err) {
    console.error('[veriqo-reconcile]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
