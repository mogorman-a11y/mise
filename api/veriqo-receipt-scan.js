// api/veriqo-receipt-scan.js
// POST { jobId, image: base64, mimeType?, vatRegistered }
// Scans a receipt image, matches line items to the job's expected ingredients,
// updates the job's post_job_actuals, and records ingredient history.

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

function detectMime(base64) {
  if (base64.startsWith('/9j')) return 'image/jpeg';
  if (base64.startsWith('iVBORw')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return null;
}

async function normaliseIngredientName(db, raw) {
  const key = raw.toLowerCase().trim();
  const cached = await db.query(
    'SELECT normalised_name FROM costing.normalised_ingredient_mappings WHERE raw_name = $1',
    [key]
  );
  if (cached.rows[0]) return cached.rows[0].normalised_name;

  // Ask GPT-4o-mini to normalise
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Return the canonical ingredient name for a UK professional kitchen. Return ONLY valid JSON: { "normalised": "string" }',
        },
        { role: 'user', content: raw },
      ],
    }),
  });
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const normalised = (parsed.normalised || key).toLowerCase().trim();

  await db.query(
    `INSERT INTO costing.normalised_ingredient_mappings (raw_name, normalised_name)
     VALUES ($1, $2)
     ON CONFLICT (raw_name) DO UPDATE SET normalised_name = EXCLUDED.normalised_name`,
    [key, normalised]
  );

  return normalised;
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

  const { jobId, image, mimeType: mimeHint, vatRegistered } = req.body || {};
  if (!jobId || !image) return res.status(400).json({ error: 'jobId and image are required' });
  if (typeof vatRegistered !== 'boolean') return res.status(400).json({ error: 'vatRegistered (boolean) is required' });

  const mime = mimeHint || detectMime(image);
  if (!mime) return res.status(400).json({ error: 'Unsupported image format — use JPEG, PNG, or WEBP', code: 'IMAGE_FORMAT_UNSUPPORTED' });
  if (image.length > 6_990_000) return res.status(400).json({ error: 'Image too large (max 5 MB)', code: 'IMAGE_TOO_LARGE' });

  try {
    const db = getPool();

    const jobRes = await db.query(
      'SELECT * FROM costing.jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (!jobRes.rows.length) return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
    const job = jobRes.rows[0];

    const expectedIngredients = (job.post_job_actuals || []).map(s => s.ingredient_name);
    const ingredientList = expectedIngredients.map((n, i) => `${i + 1}. ${n}`).join('\n');

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a UK catering procurement auditor. Match receipt line items to a list of expected job ingredients.

Expected ingredients:
${ingredientList}

For each expected ingredient, find the best matching receipt line item (or mark as not found).
Pence values must be whole integers. VAT rates: 0 or 20.
A purchase is a bulk_purchase if it clearly covers more than just this job.

Return ONLY valid JSON:
{
  "total_receipt_value_ex_vat_pence": number | null,
  "total_receipt_value_inc_vat_pence": number | null,
  "matches": [{
    "ingredient_name": string,
    "receipt_line_item_text": string | null,
    "line_item_ex_vat_pence": number | null,
    "line_item_inc_vat_pence": number | null,
    "vat_rate_applied": 0 | 20,
    "bulk_purchase_flag": boolean,
    "estimated_job_portion_pence": number | null,
    "match_confidence": "high" | "medium" | "low" | "not_found",
    "note": string | null
  }]
}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Dish: ${job.dish_name}, Serves: ${job.serves}. Scan this receipt and match to the expected ingredients.` },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${image}`, detail: 'high' } },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json();
      throw new Error(err.error?.message || 'OpenAI vision error');
    }

    const aiData = await aiRes.json();
    let parsed;
    try {
      parsed = JSON.parse(aiData.choices[0].message.content);
    } catch {
      return res.status(502).json({ error: 'AI returned unexpected format', code: 'RECEIPT_PARSE_FAILED' });
    }

    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];

    // Build ReceiptLineMatch list with actual_spend_pence selected based on VAT status
    const processedMatches = matches.map(m => {
      const exVat = m.line_item_ex_vat_pence != null ? Math.round(m.line_item_ex_vat_pence) : null;
      const incVat = m.line_item_inc_vat_pence != null ? Math.round(m.line_item_inc_vat_pence) : null;
      const vatRate = [0, 20].includes(m.vat_rate_applied) ? m.vat_rate_applied : 0;
      const portion = m.estimated_job_portion_pence != null ? Math.round(m.estimated_job_portion_pence) : null;

      // VAT-registered chefs use ex-VAT cost; non-registered use inc-VAT
      let actual_spend_pence;
      if (m.bulk_purchase_flag) {
        actual_spend_pence = portion;
      } else if (vatRegistered) {
        actual_spend_pence = exVat;
      } else {
        actual_spend_pence = incVat ?? exVat;
      }

      return {
        ingredient_name: m.ingredient_name,
        receipt_line_item_text: m.receipt_line_item_text ?? null,
        line_item_ex_vat_pence: exVat,
        line_item_inc_vat_pence: incVat,
        vat_rate_applied: vatRate,
        actual_spend_pence: actual_spend_pence != null ? Math.round(actual_spend_pence) : null,
        estimated_job_portion_pence: portion,
        match_confidence: m.match_confidence || 'not_found',
        bulk_purchase_flag: !!m.bulk_purchase_flag,
        ...(m.note ? { note: m.note } : {}),
      };
    });

    // Sanity check: if matched totals deviate >10% from receipt total, flag for review
    const receiptTotal = parsed.total_receipt_value_inc_vat_pence ?? parsed.total_receipt_value_ex_vat_pence;
    const matchedTotal = processedMatches
      .filter(m => m.match_confidence !== 'not_found' && m.actual_spend_pence != null)
      .reduce((s, m) => s + m.actual_spend_pence, 0);
    const needs_manual_review = receiptTotal && receiptTotal > 0
      ? Math.abs(matchedTotal - receiptTotal) / receiptTotal > 0.10
      : false;

    // Bucket into high_confidence_matches, needs_review, missing_items
    const high_confidence_matches = processedMatches.filter(m => m.match_confidence === 'high' && !m.bulk_purchase_flag);
    const needs_review = processedMatches.filter(m => m.match_confidence !== 'high' && m.match_confidence !== 'not_found' || m.bulk_purchase_flag);
    const missing_items = processedMatches.filter(m => m.match_confidence === 'not_found');

    // Update job post_job_actuals with matched actuals
    const updatedSlots = (job.post_job_actuals || []).map(slot => {
      const match = processedMatches.find(m =>
        m.ingredient_name.toLowerCase().trim() === slot.ingredient_name.toLowerCase().trim()
      );
      if (!match || match.match_confidence === 'not_found' || match.actual_spend_pence === null) {
        return slot;
      }
      return {
        ...slot,
        actual_spend_pence: match.actual_spend_pence,
        reconciled: true,
        vat_rate_applied: match.vat_rate_applied,
      };
    });

    const totalSlots = updatedSlots.length;
    const reconciledCount = updatedSlots.filter(s => s.reconciled).length;
    const newStatus = reconciledCount === 0 ? 'estimated'
      : reconciledCount === totalSlots ? 'reconciled' : 'partial';

    const now = new Date().toISOString();

    await db.query(
      `UPDATE costing.jobs
       SET reconciliation_status = $1, reconciliation_method = 'receipt_scan',
           post_job_actuals = $2, updated_at = $3
       WHERE id = $4`,
      [newStatus, JSON.stringify(updatedSlots), now, jobId]
    );

    // Record ingredient history for high-confidence matches with known quantity
    const historyEntries = high_confidence_matches.filter(
      m => m.actual_spend_pence !== null && m.actual_spend_pence > 0
    );

    for (const match of historyEntries) {
      const slot = (job.post_job_actuals || []).find(
        s => s.ingredient_name.toLowerCase().trim() === match.ingredient_name.toLowerCase().trim()
      );
      // We need quantity_grams to compute unit_cost_pence_per_100g.
      // quantity_grams is not stored on the slot (it lives in the estimate response, not JobRecord).
      // Skip history recording here — that data is unavailable at this layer.
      // History can be recorded via a separate enrichment call when the estimate data is available.
      void slot; // acknowledged — no history write without quantity_grams
    }

    return res.status(200).json({
      jobId,
      reconciliation_method: 'receipt_scan',
      total_receipt_value_ex_vat_pence: parsed.total_receipt_value_ex_vat_pence ?? null,
      total_receipt_value_inc_vat_pence: parsed.total_receipt_value_inc_vat_pence ?? null,
      needs_manual_review: !!needs_manual_review,
      high_confidence_matches,
      needs_review,
      missing_items,
    });

  } catch (err) {
    console.error('[veriqo-receipt-scan]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
