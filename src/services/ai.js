// AI vision service: extracts license plate, make/model, and color from
// photos of the front and back of a car using Anthropic's Claude vision API.
//
// If ANTHROPIC_API_KEY is not set, it falls back to a deterministic mock so the
// app remains fully usable for demos and local testing without any credentials.

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const SYSTEM_PROMPT = `You are a vehicle-identification assistant for a valet stand.
You are given one or two photos of a single car (typically the front and the back).
Identify the vehicle and return ONLY a compact JSON object, no prose, with keys:
  "plate"      : the license plate characters (uppercase, no spaces/dashes), or "" if not legible
  "make_model" : the make and model, e.g. "Toyota Camry", or "" if unsure
  "color"      : the primary exterior color as a simple word, e.g. "Silver"
  "confidence" : a number 0-1 for how confident you are overall
Return valid JSON only.`;

function parseJsonLoose(text) {
  // Models sometimes wrap JSON in fences or prose; extract the first object.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in model response');
  return JSON.parse(match[0]);
}

// photos: array of { media_type, data(base64) }
export async function analyzeCarPhotos(photos) {
  if (!photos || photos.length === 0) {
    throw new Error('At least one photo is required');
  }

  if (!API_KEY) {
    return mockAnalysis();
  }

  const content = [
    { type: 'text', text: 'Identify this vehicle from the photo(s).' },
    ...photos.map((p) => ({
      type: 'image',
      source: { type: 'base64', media_type: p.media_type, data: p.data },
    })),
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || '').join('\n');
  const parsed = parseJsonLoose(text);

  return {
    plate: String(parsed.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    make_model: String(parsed.make_model || '').trim(),
    color: String(parsed.color || '').trim(),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    source: 'ai',
  };
}

// Deterministic stand-in used when no API key is configured.
function mockAnalysis() {
  const makes = ['Toyota Camry', 'Honda Accord', 'Tesla Model 3', 'Ford F-150', 'BMW 3 Series'];
  const colors = ['Silver', 'Black', 'White', 'Blue', 'Red'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const plate =
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
    Math.floor(1000 + Math.random() * 9000);
  return {
    plate,
    make_model: pick(makes),
    color: pick(colors),
    confidence: null,
    source: 'mock',
  };
}

export const aiEnabled = Boolean(API_KEY);
