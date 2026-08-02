import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, getActiveEvent, nextTicketNumber, newToken } from './db.js';
import { analyzeCarPhotos, aiEnabled } from './services/ai.js';
import { sendSms, smsEnabled, ticketMessage } from './services/sms.js';
import { shareUrl, qrSvg } from './services/share.js';
import {
  attachUser,
  requireAuth,
  createUser,
  authenticate,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  userCount,
  SIGNUP_CODE,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const app = express();
app.set('trust proxy', true);

// Photos are base64-encoded in JSON, so allow a generous body size.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(attachUser);

// ---------- helpers ----------

function normalizePhone(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits; // assume US if 10 digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits ? '+' + digits : '';
}

function getTicket(id) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

function getTicketByToken(token) {
  return db.prepare('SELECT * FROM tickets WHERE public_token = ?').get(token);
}

function logMessage({ ticketId, direction, body, counterpart, delivered }) {
  db.prepare(
    `INSERT INTO messages (ticket_id, direction, body, counterpart, delivered)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId ?? null, direction, body, counterpart ?? null, delivered ? 1 : 0);
}

const STATUS_LABEL = { parked: 'Parked', requested: 'Requested', ready: 'Ready', delivered: 'Delivered' };

// ---------- auth routes (public) ----------

app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: Boolean(req.user),
    user: req.user || null,
    hasUsers: userCount() > 0,
    signupCodeRequired: Boolean(SIGNUP_CODE) && userCount() > 0,
  });
});

app.post('/api/auth/signup', (req, res) => {
  try {
    const { username, password, displayName, code } = req.body || {};
    // First account bootstraps the system; later signups honor SIGNUP_CODE.
    if (SIGNUP_CODE && userCount() > 0 && code !== SIGNUP_CODE) {
      return res.status(403).json({ error: 'Invalid or missing signup code.' });
    }
    const user = createUser({ username, password, displayName });
    const token = createSession(user.id);
    setSessionCookie(res, token, req);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });
  const token = createSession(user.id);
  setSessionCookie(res, token, req);
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- public owner-facing ticket routes (by unguessable token) ----------

async function publicTicketPayload(req, ticket) {
  const event = db.prepare('SELECT name FROM events WHERE id = ?').get(ticket.event_id);
  const url = shareUrl(req, ticket.public_token);
  return {
    ticket_number: ticket.ticket_number,
    make_model: ticket.make_model,
    color: ticket.color,
    plate: ticket.plate,
    status: ticket.status,
    status_label: STATUS_LABEL[ticket.status] || ticket.status,
    event_name: event?.name || 'Valet',
    share_url: url,
    qr_svg: await qrSvg(url),
  };
}

app.get('/api/t/:token', async (req, res) => {
  const ticket = getTicketByToken(req.params.token);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(await publicTicketPayload(req, ticket));
});

// Owner taps "Request my car" on the scanned page.
app.post('/api/t/:token/request', async (req, res) => {
  const ticket = getTicketByToken(req.params.token);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status !== 'delivered') {
    db.prepare("UPDATE tickets SET status = 'requested', updated_at = datetime('now') WHERE id = ?").run(
      ticket.id
    );
    logMessage({
      ticketId: ticket.id,
      direction: 'in',
      body: `Requested pickup via QR page (ticket #${ticket.ticket_number})`,
      counterpart: ticket.phone,
      delivered: true,
    });
  }
  res.json(await publicTicketPayload(req, getTicket(ticket.id)));
});

// ---------- auth gate for everything else under /api ----------

app.use('/api', (req, res, next) => {
  const open =
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/t/') ||
    req.path === '/sms/inbound'; // Twilio webhook must stay public
  if (open) return next();
  return requireAuth(req, res, next);
});

// ---------- config / status ----------

app.get('/api/config', (req, res) => {
  const event = getActiveEvent();
  res.json({
    aiEnabled,
    smsEnabled,
    user: req.user,
    event: { id: event.id, name: event.name },
  });
});

// ---------- events ----------

app.post('/api/events', (req, res) => {
  const name = (req.body?.name || '').trim() || 'Valet Event';
  db.prepare('UPDATE events SET active = 0 WHERE active = 1').run();
  const info = db.prepare('INSERT INTO events (name, active) VALUES (?, 1)').run(name);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(event);
});

// ---------- AI photo analysis ----------

app.post('/api/analyze', async (req, res) => {
  try {
    const photos = req.body?.photos;
    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'Provide at least one photo.' });
    }
    const result = await analyzeCarPhotos(photos);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Analysis failed' });
  }
});

// ---------- tickets ----------

app.get('/api/tickets', (req, res) => {
  const event = getActiveEvent();
  const tickets = db
    .prepare('SELECT * FROM tickets WHERE event_id = ? ORDER BY ticket_number DESC')
    .all(event.id);
  res.json({ event: { id: event.id, name: event.name }, tickets });
});

app.post('/api/tickets', (req, res) => {
  const event = getActiveEvent();
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'A valid phone number is required.' });

  const number = nextTicketNumber(event.id);
  const info = db
    .prepare(
      `INSERT INTO tickets (event_id, ticket_number, phone, plate, make_model, color, notes, public_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      number,
      phone,
      (req.body?.plate || '').trim() || null,
      (req.body?.make_model || '').trim() || null,
      (req.body?.color || '').trim() || null,
      (req.body?.notes || '').trim() || null,
      newToken()
    );
  res.status(201).json(getTicket(info.lastInsertRowid));
});

app.patch('/api/tickets/:id', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const fields = ['plate', 'make_model', 'color', 'notes', 'status'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (f in (req.body || {})) {
      updates.push(`${f} = ?`);
      values.push(f === 'status' ? String(req.body[f]) : (req.body[f] || '').trim() || null);
    }
  }
  if (req.body?.phone) {
    updates.push('phone = ?');
    values.push(normalizePhone(req.body.phone));
  }
  if (updates.length === 0) return res.json(ticket);

  updates.push("updated_at = datetime('now')");
  values.push(ticket.id);
  db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(getTicket(ticket.id));
});

app.delete('/api/tickets/:id', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('DELETE FROM tickets WHERE id = ?').run(ticket.id);
  res.json({ ok: true });
});

// Send (or resend) the confirmation SMS for a single ticket.
app.post('/api/tickets/:id/notify', async (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const event = getActiveEvent();

  const body = ticketMessage(ticket, event.name, shareUrl(req, ticket.public_token));
  const result = await sendSms(ticket.phone, body);
  logMessage({
    ticketId: ticket.id,
    direction: 'out',
    body,
    counterpart: ticket.phone,
    delivered: result.delivered,
  });
  db.prepare("UPDATE tickets SET notified = 1, updated_at = datetime('now') WHERE id = ?").run(
    ticket.id
  );

  res.json({ ticket: getTicket(ticket.id), sms: result, preview: body });
});

// Broadcast confirmations to every ticket that hasn't been notified yet
// (or all of them when ?all=1).
app.post('/api/tickets/notify-all', async (req, res) => {
  const event = getActiveEvent();
  const all = req.query.all === '1' || req.body?.all === true;
  const tickets = db
    .prepare(
      `SELECT * FROM tickets WHERE event_id = ? ${all ? '' : 'AND notified = 0'} ORDER BY ticket_number ASC`
    )
    .all(event.id);

  const results = [];
  for (const ticket of tickets) {
    const body = ticketMessage(ticket, event.name, shareUrl(req, ticket.public_token));
    const result = await sendSms(ticket.phone, body);
    logMessage({
      ticketId: ticket.id,
      direction: 'out',
      body,
      counterpart: ticket.phone,
      delivered: result.delivered,
    });
    db.prepare("UPDATE tickets SET notified = 1, updated_at = datetime('now') WHERE id = ?").run(
      ticket.id
    );
    results.push({ id: ticket.id, ticket_number: ticket.ticket_number, sms: result });
  }
  res.json({ sent: results.length, results });
});

// ---------- messages / conversation ----------

app.get('/api/messages', (req, res) => {
  const event = getActiveEvent();
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m
       LEFT JOIN tickets t ON t.id = m.ticket_id
       WHERE t.event_id = ? OR m.ticket_id IS NULL
       ORDER BY m.created_at DESC, m.id DESC LIMIT 200`
    )
    .all(event.id);
  res.json(rows);
});

// Shared handler for an inbound owner reply (real webhook or simulated).
function handleInbound(fromRaw, bodyRaw) {
  const from = normalizePhone(fromRaw);
  const body = String(bodyRaw || '').trim();
  const event = getActiveEvent();

  // Match the reply to a ticket: prefer an explicit ticket number in the text,
  // otherwise fall back to the most recent ticket from that phone number.
  const numMatch = body.match(/\d+/);
  let ticket = null;
  if (numMatch) {
    ticket = db
      .prepare('SELECT * FROM tickets WHERE event_id = ? AND ticket_number = ?')
      .get(event.id, Number(numMatch[0]));
  }
  if (!ticket && from) {
    ticket = db
      .prepare(
        'SELECT * FROM tickets WHERE event_id = ? AND phone = ? ORDER BY id DESC LIMIT 1'
      )
      .get(event.id, from);
  }

  logMessage({
    ticketId: ticket?.id ?? null,
    direction: 'in',
    body,
    counterpart: from,
    delivered: true,
  });

  let reply = null;
  if (ticket) {
    db.prepare(
      "UPDATE tickets SET status = 'requested', updated_at = datetime('now') WHERE id = ?"
    ).run(ticket.id);
    reply = `Got it! We're bringing up ticket #${ticket.ticket_number} now. It will be ready shortly.`;
  } else {
    reply = `Thanks! We couldn't match your ticket automatically — please reply with your ticket number.`;
  }
  return { ticket, reply, from };
}

// Twilio inbound webhook. Configure your Twilio number's messaging webhook to
// POST here. Responds with TwiML so the owner gets an automatic acknowledgement.
app.post('/api/sms/inbound', async (req, res) => {
  const { ticket, reply } = handleInbound(req.body?.From, req.body?.Body);
  if (ticket) {
    logMessage({ ticketId: ticket.id, direction: 'out', body: reply, counterpart: ticket.phone, delivered: true });
  }
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
});

// Simulated inbound reply, used by the dashboard when SMS is in mock mode so the
// early-pickup flow can be demonstrated end to end.
app.post('/api/sms/simulate-inbound', async (req, res) => {
  const { ticket, reply, from } = handleInbound(req.body?.from, req.body?.body);
  if (ticket) {
    const out = await sendSms(ticket.phone, reply);
    logMessage({ ticketId: ticket.id, direction: 'out', body: reply, counterpart: ticket.phone, delivered: out.delivered });
  }
  res.json({ matchedTicket: ticket ? getTicket(ticket.id) : null, reply, from });
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );
}

// ---------- frontend ----------

// Gate the operator dashboard behind login; public pages stay open.
app.get(['/', '/index.html'], (req, res) => {
  if (!req.user) return res.redirect('/login.html');
  res.sendFile(join(publicDir, 'index.html'));
});

app.use(express.static(publicDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Valet ticket system running on http://localhost:${PORT}`);
  console.log(`  AI vision : ${aiEnabled ? 'Anthropic (live)' : 'mock (set ANTHROPIC_API_KEY)'}`);
  console.log(`  SMS       : ${smsEnabled ? 'Twilio (live)' : 'mock (set TWILIO_* vars)'}`);
  console.log(`  Auth      : ${userCount()} account(s)${SIGNUP_CODE ? ', signup code required' : ''}`);
});
