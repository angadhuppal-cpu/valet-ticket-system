// Authentication: password hashing (scrypt) and cookie-based sessions.
// No external dependencies — everything comes from node:crypto.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, newToken, USE_POSTGRES } from './db.js';

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
export async function createUser({ username, password, displayName }) {
  const uname = String(username || '').trim().toLowerCase();
  if (uname.length < 3) throw new Error('Username must be at least 3 characters.');
  if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');
  const stmt1 = db.prepare('SELECT id FROM users WHERE username = ?');
  const exists = USE_POSTGRES ? await stmt1.get(uname) : stmt1.get(uname);
  if (exists) throw new Error('That username is already taken.');
  const stmt2 = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)');
  const info = USE_POSTGRES
    ? await stmt2.run(uname, (displayName || uname).trim(), hashPassword(password))
    : stmt2.run(uname, (displayName || uname).trim(), hashPassword(password));
  const stmt3 = db.prepare('SELECT id, username, display_name, current_event_id FROM users WHERE id = ?');
  return USE_POSTGRES ? await stmt3.get(info.lastInsertRowid) : stmt3.get(info.lastInsertRowid);
}

export async function authenticate(username, password) {
  const uname = String(username || '').trim().toLowerCase();
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const user = USE_POSTGRES ? await stmt.get(uname) : stmt.get(uname);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, display_name: user.display_name, current_event_id: user.current_event_id };
}

export async function userCount() {
  const stmt = db.prepare('SELECT COUNT(*) AS n FROM users');
  const result = USE_POSTGRES ? await stmt.get() : stmt.get();
  return result.n;
}

// ---------- sessions ----------
export async function createSession(userId) {
  const token = newToken(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  const stmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
  if (USE_POSTGRES) {
    await stmt.run(token, userId, expires);
  } else {
    stmt.run(token, userId, expires);
  }
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
  if (USE_POSTGRES) {
    await stmt.run(token);
  } else {
    stmt.run(token);
  }
}

async function sessionUser(token) {
  if (!token) return null;
  const stmt = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.current_event_id, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  );
  const row = USE_POSTGRES ? await stmt.get(token) : stmt.get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name, current_event_id: row.current_event_id };
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
export async function attachUser(req, _res, next) {
  const cookies = parseCookies(req);
  req.sessionToken = cookies[COOKIE] || null;
  req.user = await sessionUser(req.sessionToken);
  next();
}

// Guard: require an authenticated user for the wrapped route.
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ---------- password reset ----------
const RESET_TOKEN_HOURS = 1; // Reset tokens expire in 1 hour

export async function createResetToken(username) {
  const uname = String(username || '').trim().toLowerCase();
  const stmt1 = db.prepare('SELECT id FROM users WHERE username = ?');
  const user = USE_POSTGRES ? await stmt1.get(uname) : stmt1.get(uname);
  if (!user) throw new Error('User not found');

  const token = newToken(24);
  const expires = new Date(Date.now() + RESET_TOKEN_HOURS * 36e5).toISOString();

  // Delete any existing reset tokens for this user
  const deleteStmt = db.prepare('DELETE FROM reset_tokens WHERE user_id = ?');
  if (USE_POSTGRES) {
    await deleteStmt.run(user.id);
  } else {
    deleteStmt.run(user.id);
  }

  // Create new reset token
  const insertStmt = db.prepare('INSERT INTO reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)');
  if (USE_POSTGRES) {
    await insertStmt.run(token, user.id, expires);
  } else {
    insertStmt.run(token, user.id, expires);
  }

  return { token, username: user.username || uname };
}

export async function verifyResetToken(token) {
  if (!token) return null;
  const stmt = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.current_event_id, r.expires_at
     FROM reset_tokens r JOIN users u ON u.id = r.user_id
     WHERE r.token = ?`
  );
  const row = USE_POSTGRES ? await stmt.get(token) : stmt.get(token);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    // Token expired, clean it up
    const deleteStmt = db.prepare('DELETE FROM reset_tokens WHERE token = ?');
    if (USE_POSTGRES) {
      await deleteStmt.run(token);
    } else {
      deleteStmt.run(token);
    }
    return null;
  }

  return { id: row.id, username: row.username, display_name: row.display_name, current_event_id: row.current_event_id };
}

export async function resetPassword(token, newPassword) {
  const user = await verifyResetToken(token);
  if (!user) throw new Error('Invalid or expired reset token');

  if (String(newPassword || '').length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  // Update password
  const updateStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  if (USE_POSTGRES) {
    await updateStmt.run(hashPassword(newPassword), user.id);
  } else {
    updateStmt.run(hashPassword(newPassword), user.id);
  }

  // Delete the used reset token
  const deleteStmt = db.prepare('DELETE FROM reset_tokens WHERE token = ?');
  if (USE_POSTGRES) {
    await deleteStmt.run(token);
  } else {
    deleteStmt.run(token);
  }

  return user;
}
