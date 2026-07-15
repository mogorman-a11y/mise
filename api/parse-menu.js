// api/parse-menu.js — Vercel serverless function
// Accepts:
//   POST { image: base64, mimeType }                        → menu image parsing (gpt-4o vision)
//   POST { action: 'prep-tasks', dishName, dishCategory }   → AI prep task generation (gpt-4o-mini)

// Canonical allergen list — same file the browser modules use (js/core/allergens.js).
// Do not hardcode a second copy here; a spelling drift between this prompt's
// vocabulary and the client's is what broke allergen conflict detection.
const ALLERGENS = require('../js/core/allergens.js').ALLERGENS_14;

const CATEGORIES = [
  'Canapé','Starter','Fish course','Main','Side','Sauce',
  'Pre-dessert','Dessert','Cheese','Petit four','Bread','Other'
];

const MENU_SYSTEM_PROMPT = `You are a menu analysis assistant for a UK private chef app. Analyse the provided menu image and extract every dish you can read.

Return ONLY a valid JSON object — no markdown, no explanation, nothing else:
{
  "menuName": "string (the menu heading visible in the image, or a sensible name if not visible)",
  "dishes": [
    {
      "name": "string (exact dish name as written on the menu)",
      "category": "string (one of: ${CATEGORIES.join(', ')})",
      "allergens": ["array of UK major allergens from this exact list: ${ALLERGENS.join(', ')}"]
    }
  ]
}

Allergen guidance: infer allergens from typical ingredients for each dish. Only include allergens you are reasonably confident are present as intentional ingredients. Use the exact strings from the allergen list above — no variations.`;

function stripFences(str) {
  return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const action = body.action || 'menu';

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

  // ── Prep task generation ──────────────────────────────────────────────────────
  if (action === 'prep-tasks') {
    const { dishName, dishCategory } = body;
    if (!dishName) return res.status(400).json({ error: 'dishName is required' });

    const prompt = `You are a professional kitchen prep planning assistant for a UK private chef.

Generate realistic kitchen prep tasks for: "${dishName}"${dishCategory ? ` (${dishCategory})` : ''}.

Return ONLY a valid JSON object:
{
  "tasks": [
    { "description": "string — a specific, actionable kitchen task", "section": "prep_ahead" }
  ]
}

Generate 4–7 tasks. "section" must be one of:
- "prep_ahead" — done hours or days before service (stocks, sauces, portioning, brines, mise en place)
- "finishing" — done in the final 15–30 minutes (final sear, plating, heating, garnishes, seasoning)

Be specific to this dish. Return only the JSON, no extra text.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('[parse-menu/prep-tasks] OpenAI error:', JSON.stringify(data));
        return res.status(502).json({ error: data.error?.message || 'OpenAI API error' });
      }
      const raw = (data.choices?.[0]?.message?.content || '').trim();
      let parsed;
      try { parsed = JSON.parse(stripFences(raw)); } catch (e) {
        console.error('[parse-menu/prep-tasks] JSON parse failed. Raw:', raw);
        return res.status(502).json({ error: 'AI returned unexpected format — please try again' });
      }
      if (!Array.isArray(parsed.tasks)) {
        return res.status(502).json({ error: 'No tasks array in AI response' });
      }
      return res.status(200).json(parsed);
    } catch (err) {
      console.error('[parse-menu/prep-tasks] Unhandled error:', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  // ── Menu image parsing ────────────────────────────────────────────────────────
  const { image, mimeType } = body;
  if (!image) return res.status(400).json({ error: 'image (base64) is required' });

  const imageType = mimeType || 'image/jpeg';
  const dataUrl = `data:${imageType};base64,${image}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: MENU_SYSTEM_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[parse-menu] OpenAI error:', JSON.stringify(data));
      return res.status(502).json({ error: data.error?.message || 'OpenAI API error' });
    }

    const raw = (data.choices?.[0]?.message?.content || '').trim();
    let parsed;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch (e) {
      console.error('[parse-menu] JSON parse failed. Raw content:', raw);
      return res.status(502).json({ error: 'AI returned unexpected format — please try again' });
    }

    if (!Array.isArray(parsed.dishes)) {
      return res.status(502).json({ error: 'No dishes array in AI response' });
    }

    // Never trust model output verbatim — normalize allergen spelling so it
    // matches the canonical vocabulary even if the model drifts from the
    // prompt's requested exact strings.
    const normalizeAllergen = require('../js/core/allergens.js').normalizeAllergen;
    parsed.dishes.forEach(function (d) {
      if (Array.isArray(d.allergens)) d.allergens = d.allergens.map(normalizeAllergen);
    });

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[parse-menu] Unhandled error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
