// Builds the owner-facing share URL for a ticket and renders a QR code (SVG).
import QRCode from 'qrcode';

// Determine the public base URL: explicit override wins, otherwise derive it
// from the incoming request (works behind proxies via X-Forwarded-* headers).
export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export function shareUrl(req, token) {
  return `${baseUrl(req)}/ticket.html?t=${encodeURIComponent(token)}`;
}

export async function qrSvg(text) {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    color: { dark: '#0b1220', light: '#ffffff' },
  });
}
