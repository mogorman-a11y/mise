// api/veriqo-estimate.js
// POST { dish, serves, serviceStyle, vatRegistered }
//   Creates a new cost estimate job for the authenticated chef.
//   Two-stage AI: (1) extract ingredient names, (2) estimate costs with chef price history.
//
// POST { action: 'scan', jobId, image: base64, mimeType?, vatRegistered }
//   Receipt scan: matches receipt line items to job ingredients and updates actuals.

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

async function openAI(messages, model = 'gpt-4o-mini') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'OpenAI error');
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

function calculateFinancials(slots, quotedPricePence) {
  const reconciled = slots.filter(s => s.reconciled && s.actual_spend_pence !== null);
  const totalEstimated = reconciled.reduce((s, x) => s + (x.estimated_portion_cost_pence || 0), 0);
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

function detectMime(base64) {
  if (base64.startsWith('/9j')) return 'image/jpeg';
  if (base64.startsWith('iVBORw')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return null;
}

async function getRecentPrices(sb, userId, names) {
  const { data, error } = await sb.rpc('costing_get_ingredient_prices', {
    p_user_id: userId,
    p_names: names,
  });
  if (error) throw new Error(error.message || 'Failed to fetch ingredient prices');
  const prices = {};
  const arr = Array.isArray(data) ? data : [];
  for (const row of arr) {
    prices[row.name] = row.wprice !== null && row.wprice !== undefined ? Math.round(Number(row.wprice)) : null;
  }
  for (const name of names) {
    if (!(name in prices)) prices[name] = null;
  }
  return prices;
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

  const body = req.body || {};
  const sb = getSB();

  // ── Receipt scan branch ───────────────────────────────────────────────────
  if (body.action === 'scan') {
    const { jobId, image, mimeType: mimeHint, vatRegistered } = body;
    if (!jobId || !image) return res.status(400).json({ error: 'jobId and image are required' });
    if (typeof vatRegistered !== 'boolean') return res.status(400).json({ error: 'vatRegistered (boolean) is required' });

    const mime = mimeHint || detectMime(image);
    if (!mime) return res.status(400).json({ error: 'Unsupported image format — use JPEG, PNG, or WEBP' });
    if (image.length > 6_990_000) return res.status(400).json({ error: 'Image too large (max 5 MB)' });

    try {
      const { data: job, error: jobErr } = await sb.rpc('costing_get_job', {
        p_id: jobId,
        p_user_id: userId,
      });
      if (jobErr) throw new Error(jobErr.message || 'Database error');
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const expectedIngredients = (job.post_job_actuals || []).map(s => s.ingredient_name);
      const ingredientList = expectedIngredients.map((n, i) => `${i + 1}. ${n}`).join('\n');

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are a UK catering procurement auditor. Match receipt line items to a list of expected job ingredients.\n\nExpected ingredients:\n${ingredientList}\n\nReturn ONLY valid JSON:\n{\n  "total_receipt_value_ex_vat_pence": number | null,\n  "total_receipt_value_inc_vat_pence": number | null,\n  "matches": [{"ingredient_name": string, "receipt_line_item_text": string | null, "line_item_ex_vat_pence": number | null, "line_item_inc_vat_pence": number | null, "vat_rate_applied": 0 | 20, "bulk_purchase_flag": boolean, "estimated_job_portion_pence": number | null, "match_confidence": "high" | "medium" | "low" | "not_found", "note": string | null}]\n}`,
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
      if (!aiRes.ok) { const e = await aiRes.json(); throw new Error(e.error?.message || 'OpenAI vision error'); }

      const aiData = await aiRes.json();
      let parsed;
      try { parsed = JSON.parse(aiData.choices[0].message.content); } catch { return res.status(502).json({ error: 'AI returned unexpected format' }); }

      const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
      const processedMatches = matches.map(m => {
        const exVat = m.line_item_ex_vat_pence != null ? Math.round(m.line_item_ex_vat_pence) : null;
        const incVat = m.line_item_inc_vat_pence != null ? Math.round(m.line_item_inc_vat_pence) : null;
        const vatRate = [0, 20].includes(m.vat_rate_applied) ? m.vat_rate_applied : 0;
        const portion = m.estimated_job_portion_pence != null ? Math.round(m.estimated_job_portion_pence) : null;
        let actual_spend_pence = m.bulk_purchase_flag ? portion : (vatRegistered ? exVat : (incVat ?? exVat));
        return {
          ingredient_name: m.ingredient_name, receipt_line_item_text: m.receipt_line_item_text ?? null,
          line_item_ex_vat_pence: exVat, line_item_inc_vat_pence: incVat, vat_rate_applied: vatRate,
          actual_spend_pence: actual_spend_pence != null ? Math.round(actual_spend_pence) : null,
          estimated_job_portion_pence: portion, match_confidence: m.match_confidence || 'not_found',
          bulk_purchase_flag: !!m.bulk_purchase_flag, ...(m.note ? { note: m.note } : {}),
        };
      });

      const receiptTotal = parsed.total_receipt_value_inc_vat_pence ?? parsed.total_receipt_value_ex_vat_pence;
      const matchedTotal = processedMatches.filter(m => m.match_confidence !== 'not_found' && m.actual_spend_pence != null).reduce((s, m) => s + m.actual_spend_pence, 0);
      const needs_manual_review = receiptTotal && receiptTotal > 0 ? Math.abs(matchedTotal - receiptTotal) / receiptTotal > 0.10 : false;

      const high_confidence_matches = processedMatches.filter(m => m.match_confidence === 'high' && !m.bulk_purchase_flag);
      const needs_review = processedMatches.filter(m => (m.match_confidence !== 'high' && m.match_confidence !== 'not_found') || m.bulk_purchase_flag);
      const missing_items = processedMatches.filter(m => m.match_confidence === 'not_found');

      const updatedSlots = (job.post_job_actuals || []).map(slot => {
        const match = processedMatches.find(m => m.ingredient_name.toLowerCase().trim() === slot.ingredient_name.toLowerCase().trim());
        if (!match || match.match_confidence === 'not_found' || match.actual_spend_pence === null) return slot;
        return { ...slot, actual_spend_pence: match.actual_spend_pence, reconciled: true, vat_rate_applied: match.vat_rate_applied };
      });

      const reconciledCount = updatedSlots.filter(s => s.reconciled).length;
      const newStatus = reconciledCount === 0 ? 'estimated' : reconciledCount === updatedSlots.length ? 'reconciled' : 'partial';
      const now = new Date().toISOString();

      const financials = calculateFinancials(updatedSlots, job.quoted_price_pence ?? null);
      const { error: scanErr } = await sb.rpc('costing_reconcile_job', {
        p_id: jobId,
        p_user_id: userId,
        p_status: newStatus,
        p_method: 'receipt_scan',
        p_actuals: updatedSlots,
        p_financials: financials,
        p_updated_at: now,
      });
      if (scanErr) throw new Error(scanErr.message || 'Failed to save scan results');

      return res.status(200).json({
        jobId, reconciliation_method: 'receipt_scan',
        total_receipt_value_ex_vat_pence: parsed.total_receipt_value_ex_vat_pence ?? null,
        total_receipt_value_inc_vat_pence: parsed.total_receipt_value_inc_vat_pence ?? null,
        needs_manual_review: !!needs_manual_review, high_confidence_matches, needs_review, missing_items,
      });

    } catch (err) {
      console.error('[veriqo-receipt-scan]', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  // ── Multi-course estimate branch ─────────────────────────────────────────
  if (body.action === 'multi-course') {
    const { courses, serves, serviceStyle, vatRegistered } = body;
    if (!courses || !Array.isArray(courses) || !courses.length) return res.status(400).json({ error: 'courses array is required' });
    if (!serviceStyle) return res.status(400).json({ error: 'serviceStyle is required' });
    if (!Number.isInteger(Number(serves)) || Number(serves) < 1 || Number(serves) > 1000) return res.status(400).json({ error: 'serves must be a whole number between 1 and 1000' });
    if (typeof vatRegistered !== 'boolean') return res.status(400).json({ error: 'vatRegistered (boolean) is required' });

    try {
      const menuText = courses.map(c => `${c.name}: ${(c.dishes || []).join(', ')}`).join('\n');

      // Stage 1: extract ingredient names per course
      const stage1 = await openAI([
        { role: 'system', content: 'You are a professional UK chef. For a multi-course catering menu, list the 4–8 key as-purchased ingredients per course. Return ONLY valid JSON: { "courses": [{ "name": string, "ingredients": ["string"] }] }' },
        { role: 'user', content: `Menu (${serves} covers, ${serviceStyle} service):\n${menuText}` },
      ]);

      const courseIngredients = Array.isArray(stage1.courses) ? stage1.courses : [];
      const allIngredientNames = courseIngredients.flatMap(c => c.ingredients || []);
      if (!allIngredientNames.length) return res.status(502).json({ error: 'AI could not identify ingredients — please try again' });

      const historicalPrices = await getRecentPrices(sb, userId, allIngredientNames);
      const priceContext = allIngredientNames.map(n =>
        `- ${n}: ${historicalPrices[n] !== null ? historicalPrices[n] + 'p/100g (your history)' : 'no history — use market estimate'}`
      ).join('\n');

      // Stage 2: cost with price context, returning per-course breakdown
      const stage2 = await openAI([
        {
          role: 'system',
          content: `You are an expert UK catering cost estimator. Estimate food ingredient costs for a multi-course menu, ${serves} covers, ${serviceStyle} service.
All pence values are whole integers. quantity_per_portion_grams = total grams for ALL ${serves} covers combined.
estimated_portion_cost_pence = Math.round(quantity_per_portion_grams * estimated_unit_cost_pence / 100).
Return ONLY valid JSON:
{
  "menu_name": string,
  "courses": [{"name": string, "ingredients": [{"ingredient_name": string, "quantity_per_portion_grams": number, "estimated_unit_cost_pence": number, "estimated_portion_cost_pence": number, "cost_source": "history"|"estimate"}]}]
}`,
        },
        { role: 'user', content: `Menu:\n${menuText}\n\nIngredient price history:\n${priceContext}` },
      ]);

      const post_job_actuals = [];
      for (const course of (stage2.courses || [])) {
        for (const ing of (course.ingredients || [])) {
          post_job_actuals.push({
            ingredient_name: String(ing.ingredient_name || '').trim(),
            course: course.name,
            estimated_portion_cost_pence: Math.round(Number(ing.estimated_portion_cost_pence) || 0),
            cost_source: ing.cost_source === 'history' ? 'chef_history' : 'ai_estimate',
            actual_spend_pence: null, reconciled: false, vat_rate_applied: null,
          });
        }
      }

      const menuName = stage2.menu_name || courses.map(c => c.name).join(' · ');
      const now = new Date().toISOString();
      const jobId = crypto.randomUUID();
      const { error: insertErr } = await sb.rpc('costing_insert_job', {
        p_id: jobId, p_user_id: userId, p_dish_name: menuName,
        p_serves: Number(serves), p_service_style: serviceStyle,
        p_vat_registered: vatRegistered, p_post_job_actuals: post_job_actuals, p_ts: now,
      });
      if (insertErr) throw new Error(insertErr.message || 'Failed to save estimate');

      return res.status(200).json({
        id: jobId, userId, dish_name: menuName, serves: Number(serves), service_style: serviceStyle,
        reconciliation_status: 'estimated', reconciliation_method: null, vat_registered: vatRegistered,
        quoted_price_pence: null, post_job_actuals, created_at: now, updated_at: now,
      });
    } catch (err) {
      console.error('[veriqo-multi-course]', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  // ── Menu image scan + estimate branch ────────────────────────────────────
  if (body.action === 'menu-image') {
    const { image, mimeType: mimeHint, serves, serviceStyle, vatRegistered } = body;
    if (!image || !serviceStyle) return res.status(400).json({ error: 'image and serviceStyle are required' });
    if (!Number.isInteger(Number(serves)) || Number(serves) < 1 || Number(serves) > 1000) return res.status(400).json({ error: 'serves must be a whole number between 1 and 1000' });
    if (typeof vatRegistered !== 'boolean') return res.status(400).json({ error: 'vatRegistered (boolean) is required' });
    const mime = mimeHint || detectMime(image);
    if (!mime) return res.status(400).json({ error: 'Unsupported image format — use JPEG, PNG, or WEBP' });
    if (image.length > 6_990_000) return res.status(400).json({ error: 'Image too large (max 5 MB)' });

    try {
      // Step 1: extract menu structure from image via GPT-4o vision
      const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Read this menu image and extract the courses and dish names. Return ONLY valid JSON: { "menu_name": string, "courses": [{ "name": string, "dishes": ["string"] }] }' },
            { role: 'user', content: [
              { type: 'text', text: 'Extract the courses and dishes from this menu.' },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${image}`, detail: 'high' } },
            ]},
          ],
        }),
      });
      if (!visionRes.ok) { const e = await visionRes.json(); throw new Error(e.error?.message || 'Vision API error'); }
      const visionData = await visionRes.json();
      let extracted;
      try { extracted = JSON.parse(visionData.choices[0].message.content); } catch { throw new Error('Could not read menu structure from image'); }

      const extractedCourses = Array.isArray(extracted.courses) ? extracted.courses : [];
      const menuName = extracted.menu_name || 'Uploaded Menu';
      if (!extractedCourses.length) throw new Error('No courses found in menu image — try a clearer photo');

      // Step 2: get ingredient names per course
      const menuText = extractedCourses.map(c => `${c.name}: ${(c.dishes || []).join(', ')}`).join('\n');
      const stage1 = await openAI([
        { role: 'system', content: 'You are a professional UK chef. List 4–8 key as-purchased ingredients per course for this catering menu. Return ONLY valid JSON: { "courses": [{ "name": string, "ingredients": ["string"] }] }' },
        { role: 'user', content: `Menu (${serves} covers, ${serviceStyle} service):\n${menuText}` },
      ]);
      const courseIngredients = Array.isArray(stage1.courses) ? stage1.courses : [];
      const allIngredientNames = courseIngredients.flatMap(c => c.ingredients || []);
      if (!allIngredientNames.length) throw new Error('AI could not identify ingredients — please try again');

      const historicalPrices = await getRecentPrices(sb, userId, allIngredientNames);
      const priceContext = allIngredientNames.map(n =>
        `- ${n}: ${historicalPrices[n] !== null ? historicalPrices[n] + 'p/100g (your history)' : 'no history — use market estimate'}`
      ).join('\n');

      // Step 3: cost estimate with price context
      const stage2 = await openAI([
        {
          role: 'system',
          content: `You are an expert UK catering cost estimator. Estimate food ingredient costs for this menu, ${serves} covers, ${serviceStyle} service.
All pence values are whole integers. quantity_per_portion_grams = total grams for ALL ${serves} covers combined.
estimated_portion_cost_pence = Math.round(quantity_per_portion_grams * estimated_unit_cost_pence / 100).
Return ONLY valid JSON:
{
  "courses": [{"name": string, "ingredients": [{"ingredient_name": string, "quantity_per_portion_grams": number, "estimated_unit_cost_pence": number, "estimated_portion_cost_pence": number, "cost_source": "history"|"estimate"}]}]
}`,
        },
        { role: 'user', content: `Menu:\n${menuText}\n\nIngredient price history:\n${priceContext}` },
      ]);

      const post_job_actuals = [];
      for (const course of (stage2.courses || [])) {
        for (const ing of (course.ingredients || [])) {
          post_job_actuals.push({
            ingredient_name: String(ing.ingredient_name || '').trim(),
            course: course.name,
            estimated_portion_cost_pence: Math.round(Number(ing.estimated_portion_cost_pence) || 0),
            cost_source: ing.cost_source === 'history' ? 'chef_history' : 'ai_estimate',
            actual_spend_pence: null, reconciled: false, vat_rate_applied: null,
          });
        }
      }

      const now = new Date().toISOString();
      const jobId = crypto.randomUUID();
      const { error: insertErr } = await sb.rpc('costing_insert_job', {
        p_id: jobId, p_user_id: userId, p_dish_name: menuName,
        p_serves: Number(serves), p_service_style: serviceStyle,
        p_vat_registered: vatRegistered, p_post_job_actuals: post_job_actuals, p_ts: now,
      });
      if (insertErr) throw new Error(insertErr.message || 'Failed to save estimate');

      return res.status(200).json({
        id: jobId, userId, dish_name: menuName, serves: Number(serves), service_style: serviceStyle,
        reconciliation_status: 'estimated', reconciliation_method: null, vat_registered: vatRegistered,
        quoted_price_pence: null, post_job_actuals,
        extracted_menu: extractedCourses,
        created_at: now, updated_at: now,
      });
    } catch (err) {
      console.error('[veriqo-menu-image]', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  // ── New estimate branch ───────────────────────────────────────────────────
  const { dish, serves, serviceStyle, vatRegistered } = body;
  if (!dish || !serviceStyle) {
    return res.status(400).json({ error: 'dish and serviceStyle are required' });
  }
  if (!Number.isInteger(Number(serves)) || Number(serves) < 1 || Number(serves) > 1000) {
    return res.status(400).json({ error: 'serves must be a whole number between 1 and 1000' });
  }
  if (typeof vatRegistered !== 'boolean') {
    return res.status(400).json({ error: 'vatRegistered (boolean) is required' });
  }

  try {
    // Stage 1: cheap call to extract ingredient names only
    const stage1 = await openAI([
      {
        role: 'system',
        content: 'You are a professional UK chef. List 8–14 key as-purchased ingredients for a dish. Return ONLY valid JSON: { "ingredients": ["string", ...] }',
      },
      { role: 'user', content: `Dish: ${dish}, Serves: ${serves}, Style: ${serviceStyle}` },
    ]);

    const ingredientNames = Array.isArray(stage1.ingredients) ? stage1.ingredients.slice(0, 20) : [];
    if (!ingredientNames.length) {
      return res.status(502).json({ error: 'AI could not identify ingredients — please try again' });
    }

    const historicalPrices = await getRecentPrices(sb, userId, ingredientNames);

    const priceContext = ingredientNames
      .map(n => `- ${n}: ${historicalPrices[n] !== null ? historicalPrices[n] + 'p/100g (your history)' : 'no history — use market estimate'}`)
      .join('\n');

    // Stage 2: full estimate with price context
    const stage2 = await openAI([
      {
        role: 'system',
        content: `You are an expert UK catering cost estimator. Use the provided historical prices where available; otherwise use realistic UK wholesale rates.

UK VAT: most raw ingredients 0%, processed/confectionery/crisps/soft drinks 20%.
All pence values must be whole integers — no decimals.
quantity_per_portion_grams = total grams for ALL ${serves} covers combined.
estimated_unit_cost_pence = pence per 100g.
estimated_portion_cost_pence = Math.round(quantity_per_portion_grams * estimated_unit_cost_pence / 100).

Return ONLY valid JSON:
{
  "dish_name": string,
  "serves": ${serves},
  "service_style": "${serviceStyle}",
  "confidence_score": number,
  "missing_reference_price_count": number,
  "ingredients_breakdown": [{
    "ingredient_name": string,
    "quantity_per_portion_grams": number,
    "estimated_unit_cost_pence": number,
    "estimated_portion_cost_pence": number,
    "cost_source": "history" | "estimate",
    "allergens": [],
    "note": string | null
  }]
}`,
      },
      {
        role: 'user',
        content: `Dish: ${dish}\nServes: ${serves}\nService style: ${serviceStyle}\n\nIngredient price history:\n${priceContext}`,
      },
    ]);

    const breakdown = Array.isArray(stage2.ingredients_breakdown) ? stage2.ingredients_breakdown : [];

    const post_job_actuals = breakdown.map(ing => ({
      ingredient_name: String(ing.ingredient_name || '').trim(),
      estimated_portion_cost_pence: Math.round(Number(ing.estimated_portion_cost_pence) || 0),
      cost_source: ing.cost_source === 'history' ? 'chef_history' : 'ai_estimate',
      actual_spend_pence: null,
      reconciled: false,
      vat_rate_applied: null,
    }));

    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();

    const { error: insertErr } = await sb.rpc('costing_insert_job', {
      p_id: jobId,
      p_user_id: userId,
      p_dish_name: dish,
      p_serves: Number(serves),
      p_service_style: serviceStyle,
      p_vat_registered: vatRegistered,
      p_post_job_actuals: post_job_actuals,
      p_ts: now,
    });
    if (insertErr) throw new Error(insertErr.message || 'Failed to save estimate');

    return res.status(200).json({
      id: jobId,
      userId,
      dish_name: dish,
      serves: Number(serves),
      service_style: serviceStyle,
      reconciliation_status: 'estimated',
      reconciliation_method: null,
      vat_registered: vatRegistered,
      quoted_price_pence: null,
      post_job_actuals,
      created_at: now,
      updated_at: now,
    });

  } catch (err) {
    console.error('[veriqo-estimate]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
