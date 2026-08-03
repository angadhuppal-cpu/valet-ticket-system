// Quick live test for the Gemini vehicle-recognition path.
//
// Usage:
//   GEMINI_API_KEY=your_key node scripts/test-gemini.mjs <front.jpg> [back.jpg]
//
// It reads the image file(s), base64-encodes them, and runs the SAME
// analyzeCarPhotos() the app uses — so a green result here means the app's
// AI path works with your key. Supports .jpg/.jpeg/.png/.webp/.heic/.heif.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { analyzeCarPhotos, aiEnabled } from '../src/services/ai.js';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: GEMINI_API_KEY=... node scripts/test-gemini.mjs <front.jpg> [back.jpg]');
  process.exit(1);
}

if (!aiEnabled) {
  console.warn('⚠  GEMINI_API_KEY is not set — analyzeCarPhotos() will return MOCK data, not a real Gemini result.\n');
}

const photos = files.map((f) => {
  const media_type = MIME[extname(f).toLowerCase()];
  if (!media_type) throw new Error(`Unsupported image type: ${f} (use jpg/png/webp/heic)`);
  return { media_type, data: readFileSync(f).toString('base64') };
});

console.log(`Analyzing ${photos.length} photo(s) with ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}…\n`);

try {
  const result = await analyzeCarPhotos(photos);
  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nsource: ${result.source === 'ai' ? '✅ live Gemini' : '⚠ mock (no key)'}`);
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exit(1);
}
