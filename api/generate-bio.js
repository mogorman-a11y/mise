// api/generate-bio.js — Vercel serverless function
// Accepts POST { yearsExperience, training, cuisineSpecialism, signatureDishes,
//                targetClient, tone, businessName, chefName }
// Calls OpenAI gpt-4o to generate a UK private-chef bio.
// Returns { bio: string }

const TONES = ['Warm', 'Formal', 'Playful', 'Understated'];

function escapeForPrompt(value) {
  if (value == null) return '';
  return String(value).slice(0, 500).replace(/[`]/g, "'");
}

function buildUserPrompt(input) {
  const lines = [];
  if (input.chefName) lines.push(`Chef name: ${escapeForPrompt(input.chefName)}`);
  if (input.businessName) lines.push(`Business name: ${escapeForPrompt(input.businessName)}`);
  if (input.yearsExperience) lines.push(`Years of experience: ${escapeForPrompt(input.yearsExperience)}`);
  if (input.training) lines.push(`Training / kitchens: ${escapeForPrompt(input.training)}`);
  if (input.cuisineSpecialism) lines.push(`Cuisine specialism: ${escapeForPrompt(input.cuisineSpecialism)}`);
  if (input.signatureDishes) lines.push(`Signature dishes: ${escapeForPrompt(input.signatureDishes)}`);
  if (input.targetClient) lines.push(`Target client: ${escapeForPrompt(input.targetClient)}`);
  const tone = TONES.includes(input.tone) ? input.tone : 'Warm';
  lines.push(`Tone: ${tone}`);
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You write professional chef bios for the Carte private-chef app (UK market).

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

  const userPrompt = buildUserPrompt(req.body || {});

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 600,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[generate-bio] OpenAI error:', JSON.stringify(data));
      return res.status(502).json({ error: data.error?.message || 'OpenAI API error' });
    }

    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const jsonStr = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[generate-bio] JSON parse failed. Raw content:', raw);
      return res.status(502).json({ error: 'AI returned unexpected format — please try again' });
    }

    const bio = typeof parsed.bio === 'string' ? parsed.bio.trim() : '';
    if (!bio) return res.status(502).json({ error: 'No bio returned' });

    return res.status(200).json({ bio });

  } catch (err) {
    console.error('[generate-bio] Unhandled error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
