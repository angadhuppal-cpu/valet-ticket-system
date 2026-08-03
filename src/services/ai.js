// AI vision service: extracts license plate, make/model, and color from
// photos of the front and back of a car using Google's Gemini Flash model.
//
// Uses the Gemini API (generativelanguage.googleapis.com) with an API key.
// If GEMINI_API_KEY is not set, it falls back to a deterministic mock so the
// app remains fully usable for demos and local testing without any credentials.
//
// GCP-native note: the same model is available on Vertex AI
// (…-aiplatform.googleapis.com/…:generateContent) using service-account/ADC
// auth instead of an API key — swap BASE_URL + the auth header for production.

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

const SYSTEM_PROMPT = `You are a vehicle-identification assistant for a valet stand.
You are given one or two photos of a single car (typically the front and the back).
Identify the vehicle and return ONLY a compact JSON object with keys:
  "plate"      : the license plate characters (uppercase, no spaces/dashes), or "" if not legible
  "make_model" : the make and model, e.g. "Toyota Camry", or "" if unsure
  "color"      : the primary exterior color as a simple word, e.g. "Silver"
  "confidence" : a number 0-1 for how confident you are overall`;

// Structured-output schema so Gemini returns exactly the shape we need.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    plate: { type: 'string' },
    make_model: { type: 'string' },
    color: { type: 'string' },
    confidence: { type: 'number' },
  },
};

function parseJsonLoose(text) {
  // With responseMimeType application/json the text is clean JSON, but stay
  // defensive in case a model wraps it in prose or fences.
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

  const parts = [
    { text: 'Identify this vehicle from the photo(s).' },
    ...photos.map((p) => ({
      inline_data: { mime_type: p.media_type, data: p.data },
    })),
  ];

  const res = await fetch(`${BASE_URL}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) {
    const reason = data.promptFeedback?.blockReason || 'no candidates returned';
    throw new Error(`Gemini returned no result (${reason})`);
  }
  const text = (candidate.content?.parts || []).map((p) => p.text || '').join('\n');
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
