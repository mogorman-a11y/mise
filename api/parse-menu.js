// api/parse-menu.js — Vercel serverless function
// Accepts:
//   POST { image: base64, mimeType }                        → menu image parsing (gpt-4o vision)
//   POST { action: 'prep-tasks', dishName, dishCategory }   → AI prep task generation (gpt-4o-mini)
//   POST { action: 'bio', chefName, businessName, ... }     → chef bio generation (gpt-4o)
//
// All actions require a valid Supabase session (Authorization: Bearer <token>)
// — this endpoint calls paid OpenAI models on every request and had no auth
// check at all until 2026-07-21 (found via review), so anyone who knew the
// URL could run up the OpenAI bill with zero rate limiting on our side.
//
// The 'bio' action was previously api/generate-bio.js, a separate function
// the UI never actually called (it always posted here with action:'bio' —
// VQ-006). Merged in 2026-07-22 rather than fixing the UI to call the old
// route, both to close the dead/unauthenticated endpoint and because
// api/team.js already flagged this exact merge as the intended cleanup
// (Vercel has a function-count cap — see CLAUDE.md).

// Canonical allergen list — same file the browser modules use (js/core/allergens.js).
// Do not hardcode a second copy here; a spelling drift between this prompt's
// vocabulary and the client's is what broke allergen conflict detection.
const ALLERGENS = require('../js/core/allergens.js').ALLERGENS_14;

// Same pattern as api/veriqo-estimate.js's verifyUser() — verifies the
// caller's Supabase session directly rather than trusting a client-supplied
// user id.
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

// ── Bio generation (formerly api/generate-bio.js) ──────────────────────────────
const BIO_TONES = ['Warm', 'Formal', 'Playful', 'Understated'];

function escapeForPrompt(value) {
  if (value == null) return '';
  return String(value).slice(0, 500).replace(/[`]/g, "'");
}

function buildBioUserPrompt(input) {
  const lines = [];
  if (input.chefName) lines.push(`Chef name: ${escapeForPrompt(input.chefName)}`);
  if (input.businessName) lines.push(`Business name: ${escapeForPrompt(input.businessName)}`);
  if (input.yearsExperience) lines.push(`Years of experience: ${escapeForPrompt(input.yearsExperience)}`);
  if (input.training) lines.push(`Training / kitchens: ${escapeForPrompt(input.training)}`);
  if (input.cuisineSpecialism) lines.push(`Cuisine specialism: ${escapeForPrompt(input.cuisineSpecialism)}`);
  if (input.signatureDishes) lines.push(`Signature dishes: ${escapeForPrompt(input.signatureDishes)}`);
  if (input.targetClient) lines.push(`Target client: ${escapeForPrompt(input.targetClient)}`);
  const tone = BIO_TONES.includes(input.tone) ? input.tone : 'Warm';
  lines.push(`Tone: ${tone}`);
  return lines.join('\n');
}

const BIO_SYSTEM_PROMPT = `You write professional chef bios for the Carte private-chef app (UK market).

Output rules (strict):
- Return ONLY a valid JSON object: { "bio": "<the bio text>" } — no markdown, no preface.
- The bio is 110-160 words, written in third person, in 3 short paragraphs.
- Paragraph 1: who the chef is, training/experience.
- Paragraph 2: cuisine philosophy + signature dishes.
- Paragraph 3: what working with them is like for the client.
- No emojis. No bullet points. No headings inside the bio.
- Match the requested tone. If fields are missing, write naturally around the gaps — do not invent specific employers, awards, or restaurants the chef did not mention.
- British English spelling.`;

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

  // ── Bio generation ────────────────────────────────────────────────────────────
  if (action === 'bio') {
    const userPrompt = buildBioUserPrompt(body);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 600,
          temperature: 0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: BIO_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ]
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('[parse-menu/bio] OpenAI error:', JSON.stringify(data));
        return res.status(502).json({ error: data.error?.message || 'OpenAI API error' });
      }
      const raw = (data.choices?.[0]?.message?.content || '').trim();
      let parsed;
      try { parsed = JSON.parse(stripFences(raw)); } catch (e) {
        console.error('[parse-menu/bio] JSON parse failed. Raw:', raw);
        return res.status(502).json({ error: 'AI returned unexpected format — please try again' });
      }
      const bio = typeof parsed.bio === 'string' ? parsed.bio.trim() : '';
      if (!bio) return res.status(502).json({ error: 'No bio returned' });
      return res.status(200).json({ bio });
    } catch (err) {
      console.error('[parse-menu/bio] Unhandled error:', err);
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
