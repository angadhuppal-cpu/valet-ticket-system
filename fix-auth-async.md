# PostgreSQL Async Fix

## Problem
The auth functions in `src/auth.js` are synchronous, but when using PostgreSQL (DATABASE_URL is set), all database operations return Promises. This causes `userCount()` to return `undefined`, breaking signup.

## Required Changes

### 1. Update `src/db.js`
Export the `USE_POSTGRES` flag:

```javascript
// Line 5 - already exists
const USE_POSTGRES = Boolean(process.env.DATABASE_URL);

// Add after line 182 (after export { db };)
export { db, USE_POSTGRES };
```

### 2. Update `src/auth.js`
Import USE_POSTGRES and make functions async:

```javascript
// Line 4 - update import
import { db, newToken, USE_POSTGRES } from './db.js';

// Line 27-37 - make createUser async
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
  const stmt3 = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?');
  return USE_POSTGRES ? await stmt3.get(info.lastInsertRowid) : stmt3.get(info.lastInsertRowid);
}

// Line 39-44 - make authenticate async
export async function authenticate(username, password) {
  const uname = String(username || '').trim().toLowerCase();
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const user = USE_POSTGRES ? await stmt.get(uname) : stmt.get(uname);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, display_name: user.display_name };
}

// Line 46-48 - make userCount async
export async function userCount() {
  const stmt = db.prepare('SELECT COUNT(*) AS n FROM users');
  const result = USE_POSTGRES ? await stmt.get() : stmt.get();
  return result.n;
}

// Line 51-59 - make createSession async
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

// Line 62-64 - make destroySession async
export async function destroySession(token) {
  if (!token) return;
  const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
  if (USE_POSTGRES) {
    await stmt.run(token);
  } else {
    stmt.run(token);
  }
}

// Line 66-81 - make sessionUser async
async function sessionUser(token) {
  if (!token) return null;
  const stmt = db.prepare(
    `SELECT u.id, u.username, u.display_name, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  );
  const row = USE_POSTGRES ? await stmt.get(token) : stmt.get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name };
}

// Line 114-119 - make attachUser async
export async function attachUser(req, _res, next) {
  const cookies = parseCookies(req);
  req.sessionToken = cookies[COOKIE] || null;
  req.user = await sessionUser(req.sessionToken);
  next();
}
```

### 3. Update `src/server.js`
Make routes async where they call auth functions:

```javascript
// Line 79-86 - make async
app.get('/api/auth/status', async (req, res) => {
  const count = await userCount();
  res.json({
    authenticated: Boolean(req.user),
    user: req.user || null,
    hasUsers: count > 0,
    signupCodeRequired: Boolean(SIGNUP_CODE) && count > 0,
  });
});

// Line 88-102 - make async
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password, displayName, code } = req.body || {};
    const count = await userCount();
    if (SIGNUP_CODE && count > 0 && code !== SIGNUP_CODE) {
      return res.status(403).json({ error: 'Invalid or missing signup code.' });
    }
    const user = await createUser({ username, password, displayName });
    const token = await createSession(user.id);
    setSessionCookie(res, token, req);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Line 104-111 - make async
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });
  const token = await createSession(user.id);
  setSessionCookie(res, token, req);
  res.json({ user });
});

// Line 113-117 - make async
app.post('/api/auth/logout', async (req, res) => {
  await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});
```

## Deploy Instructions

After making these changes locally:

```bash
# Test locally first
npm start

# Deploy to Cloud Run
gcloud run deploy valet-ticket-system --source . --region=us-central1
```
