// api/ai-scan.js — Vercel serverless function
// Accepts POST { type: 'label'|'receipt', image: base64string, mimeType: string }
// Routes to the appropriate OpenAI gpt-4o vision prompt based on type
//
// type='label'   → food safety compliance mode
//   Returns: { ingredientName: string, allergens: [] }
//
// type='receipt' → procurement auditor mode
//   Returns: { vendor: string, items: [{ itemName, unit, pricePerUnit }] }

// Canonical allergen list — same file the browser modules use (js/core/allergens.js).
// Do not hardcode a second copy here; a spelling drift between this prompt's
// vocabulary and the client's is what broke allergen conflict detection.
const { ALLERGENS_14: ALLERGENS, normalizeAllergen } = require('../js/core/allergens.js');

const PROMPTS = {
  label: `You are a strict food safety compliance officer working in a UK professional kitchen. You will be shown a photo of a food packaging label, product spec sheet, or ingredient declaration.

Your job is to:
1. Identify the primary ingredient or product name shown on the label.
2. Identify every one of the 14 UK major allergens that are DECLARED on the label — either in the ingredients list, the "Contains:" statement, or the "May contain:" advisory. Do not infer or guess — only report allergens that are explicitly declared.

Return ONLY a valid JSON object — no markdown, no explanation, nothing else:
{
  "ingredientName": "string (the product or ingredient name exactly as it appears on the label)",
  "allergens": ["array using only these exact strings: ${ALLERGENS.join(', ')}"]
}

If no allergens are declared, return an empty array. Never add allergens that are not explicitly stated on the label.`,

  receipt: `You are an expert hospitality procurement auditor working in a UK professional kitchen. You will be shown a photo of a supplier receipt, delivery note, or invoice.

Your job is to extract every line item that represents a product purchase.

Return ONLY a valid JSON object — no markdown, no explanation, nothing else:
{
  "vendor": "string (the supplier or shop name as shown on the receipt, or 'Unknown Supplier' if not visible)",
  "items": [
    {
      "itemName": "string (the product name, as descriptive as possible)",
      "unit": "string (the pack size or unit — e.g. '1kg', '6x400g', '1 case', '1 each' — use the description on the receipt)",
      "pricePerUnit": number (the price per unit as a decimal number — e.g. 12.50)
    }
  ]
}

Rules:
- Only include individual product line items. Exclude subtotals, VAT, delivery charges, and grand totals.
- If a line item has a quantity > 1, divide the line total by the quantity to get pricePerUnit.
- pricePerUnit must be a plain number (no £ symbol). If you cannot determine a price, use 0.
- If the receipt has no readable line items, return an empty items array.`
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image (base64) is required' });
  if (!PROMPTS[type]) return res.status(400).json({ error: 'type must be "label" or "receipt"' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${image}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: type === 'receipt' ? 1500 : 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPTS[type] },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[ai-scan] OpenAI error:', JSON.stringify(data));
      return res.status(502).json({ error: data.error?.message || 'OpenAI API error' });
    }

    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[ai-scan] JSON parse failed:', raw);
      return res.status(502).json({ error: 'AI returned unexpected format — please try again' });
    }

    if (type === 'label') {
      if (typeof parsed.ingredientName !== 'string') {
        return res.status(502).json({ error: 'No ingredientName in AI response' });
      }
      if (!Array.isArray(parsed.allergens)) parsed.allergens = [];
      // Never trust model output verbatim — normalize spelling before the
      // exact-match filter so near-miss wording from the model isn't dropped.
      parsed.allergens = parsed.allergens.map(normalizeAllergen).filter(a => ALLERGENS.includes(a));
    }

    if (type === 'receipt') {
      if (!Array.isArray(parsed.items)) parsed.items = [];
      parsed.items = parsed.items.map(item => ({
        itemName: String(item.itemName || '').trim(),
        unit: String(item.unit || '').trim(),
        pricePerUnit: parseFloat(item.pricePerUnit) || 0
      })).filter(item => item.itemName);
      if (!parsed.vendor) parsed.vendor = 'Unknown Supplier';
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[ai-scan] Unhandled error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
