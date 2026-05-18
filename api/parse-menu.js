// api/parse-menu.js — Vercel serverless function
// Accepts POST { image: base64string, mimeType: string }
// Calls OpenAI gpt-4o vision to extract menu dishes, categories & UK 14 allergens
// Returns { menuName: string, dishes: [{ name, category, allergens[] }] }

const ALLERGENS = [
  'Celery','Cereals with gluten','Crustaceans','Eggs','Fish',
  'Lupin','Milk','Molluscs','Mustard','Nuts','Peanuts','Sesame','Soya','Sulphites'
];

const CATEGORIES = [
  'Canapé','Starter','Fish course','Main','Side','Sauce',
  'Pre-dessert','Dessert','Cheese','Petit four','Bread','Other'
];

const SYSTEM_PROMPT = `You are a menu analysis assistant for a UK private chef app. Analyse the provided menu image and extract every dish you can read.

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image (base64) is required' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

  const imageType = mimeType || 'image/jpeg';
  const dataUrl = `data:${imageType};base64,${image}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SYSTEM_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[parse-menu] OpenAI error:', JSON.stringify(data));
      return res.status(502).json({ error: data.error?.message || 'OpenAI API error' });
    }

    const raw = (data.choices?.[0]?.message?.content || '').trim();

    // Strip markdown code fences if the model wraps in ```json ... ```
    const jsonStr = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[parse-menu] JSON parse failed. Raw content:', raw);
      return res.status(502).json({ error: 'AI returned unexpected format — please try again' });
    }

    if (!Array.isArray(parsed.dishes)) {
      return res.status(502).json({ error: 'No dishes array in AI response' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[parse-menu] Unhandled error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
