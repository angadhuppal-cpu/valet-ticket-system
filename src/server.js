import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, getActiveEvent, nextTicketNumber } from './db.js';
import { analyzeCarPhotos, aiEnabled } from './services/ai.js';
import { sendSms, smsEnabled, ticketMessage } from './services/sms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Photos are base64-encoded in JSON, so allow a generous body size.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

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

function logMessage({ ticketId, direction, body, counterpart, delivered }) {
  db.prepare(
    `INSERT INTO messages (ticket_id, direction, body, counterpart, delivered)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId ?? null, direction, body, counterpart ?? null, delivered ? 1 : 0);
}

// ---------- config / status ----------

app.get('/api/config', (req, res) => {
  const event = getActiveEvent();
  res.json({
    aiEnabled,
    smsEnabled,
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
      `INSERT INTO tickets (event_id, ticket_number, phone, plate, make_model, color, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      number,
      phone,
      (req.body?.plate || '').trim() || null,
      (req.body?.make_model || '').trim() || null,
      (req.body?.color || '').trim() || null,
      (req.body?.notes || '').trim() || null
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

  const body = ticketMessage(ticket, event.name);
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
    const body = ticketMessage(ticket, event.name);
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

// ---------- static frontend ----------

app.use(express.static(join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Valet ticket system running on http://localhost:${PORT}`);
  console.log(`  AI vision : ${aiEnabled ? 'Anthropic (live)' : 'mock (set ANTHROPIC_API_KEY)'}`);
  console.log(`  SMS       : ${smsEnabled ? 'Twilio (live)' : 'mock (set TWILIO_* vars)'}`);
});
