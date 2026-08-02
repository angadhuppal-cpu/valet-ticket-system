// Authentication: password hashing (scrypt) and cookie-based sessions.
// No external dependencies — everything comes from node:crypto.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, newToken } from './db.js';

const SESSION_DAYS = 30;
const COOKIE = 'sid';
// If set, self-signup requires this code (recommended for public deploys).
export const SIGNUP_CODE = process.env.SIGNUP_CODE || '';

// ---------- passwords ----------
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- users ----------
export function createUser({ username, password, displayName }) {
  const uname = String(username || '').trim().toLowerCase();
  if (uname.length < 3) throw new Error('Username must be at least 3 characters.');
  if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) throw new Error('That username is already taken.');
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
    .run(uname, (displayName || uname).trim(), hashPassword(password));
  return db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function authenticate(username, password) {
  const uname = String(username || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, display_name: user.display_name };
}

export function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

// ---------- sessions ----------
export function createSession(userId) {
  const token = newToken(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expires
  );
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function sessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name };
}

// ---------- cookies ----------
export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
  const attrs = [
    `${COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Attach req.user (or null) from the session cookie.
export function attachUser(req, _res, next) {
  const cookies = parseCookies(req);
  req.sessionToken = cookies[COOKIE] || null;
  req.user = sessionUser(req.sessionToken);
  next();
}

// Guard: require an authenticated user for the wrapped route.
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
