import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, getCurrentEvent, getUserEvents, setCurrentEvent, nextTicketNumber, newToken, USE_POSTGRES } from './db.js';
import { analyzeCarPhotos, aiEnabled } from './services/ai.js';
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
  createResetToken,
  verifyResetToken,
  resetPassword,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const app = express();
app.set('trust proxy', true);

// Redirect to custom domain if accessed via Cloud Run URL
app.use((req, res, next) => {
  const host = req.get('host');
  const customDomain = 'valet-ticket-system.ansssol.com';
  if (host && !host.includes(customDomain) && host.includes('run.app')) {
    return res.redirect(301, `https://${customDomain}${req.originalUrl}`);
  }
  next();
});

// Photos are base64-encoded in JSON, so allow a generous body size.
app.use(express.json({ limit: '25mb' }));
app.use(attachUser);

// ---------- Server-Sent Events for real-time updates ----------

// Track connected clients for broadcasting updates
const sseClients = new Set();

function broadcastUpdate(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  });
}

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

async function getTicket(id) {
  const stmt = db.prepare('SELECT * FROM tickets WHERE id = ?');
  return USE_POSTGRES ? await stmt.get(id) : stmt.get(id);
}

async function getTicketByToken(token) {
  const stmt = db.prepare('SELECT * FROM tickets WHERE public_token = ?');
  return USE_POSTGRES ? await stmt.get(token) : stmt.get(token);
}

const STATUS_LABEL = { parked: 'Parked', requested: 'Requested', ready: 'Ready', delivered: 'Delivered' };

// ---------- auth routes (public) ----------

app.get('/api/auth/status', async (req, res) => {
  const count = await userCount();
  res.json({
    authenticated: Boolean(req.user),
    user: req.user || null,
    hasUsers: count > 0,
    signupCodeRequired: Boolean(SIGNUP_CODE) && count > 0,
  });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password, displayName, code } = req.body || {};
    // First account bootstraps the system; later signups honor SIGNUP_CODE.
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

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });
  const token = await createSession(user.id);
  setSessionCookie(res, token, req);
  res.json({ user });
});

app.post('/api/auth/logout', async (req, res) => {
  await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/reset-request', async (req, res) => {
  try {
    const { username } = req.body || {};
    const result = await createResetToken(username);
    // In production, you would send this token via email instead of returning it
    // For now, we return it so the frontend can use it
    res.json({
      message: 'Reset token created',
      token: result.token,
      username: result.username
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/reset-verify', async (req, res) => {
  try {
    const { token } = req.body || {};
    const user = await verifyResetToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    res.json({ valid: true, username: user.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const user = await resetPassword(token, password);
    res.json({
      message: 'Password reset successfully',
      username: user.username
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- public owner-facing ticket routes (by unguessable token) ----------

async function publicTicketPayload(req, ticket) {
  const stmt = db.prepare('SELECT name FROM events WHERE id = ?');
  const event = USE_POSTGRES ? await stmt.get(ticket.event_id) : stmt.get(ticket.event_id);
  const url = shareUrl(req, ticket.public_token);
  return {
    ticket_number: ticket.ticket_number,
    make_model: ticket.make_model,
    color: ticket.color,
    plate: ticket.plate,
    phone: ticket.phone,
    notes: ticket.notes,
    front_photo: ticket.front_photo,
    status: ticket.status,
    status_label: STATUS_LABEL[ticket.status] || ticket.status,
    event_name: event?.name || 'Valet',
    share_url: url,
    qr_svg: await qrSvg(url),
  };
}

app.get('/api/t/:token', async (req, res) => {
  const ticket = await getTicketByToken(req.params.token);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(await publicTicketPayload(req, ticket));
});

// Owner taps "Request my car" on the scanned page.
app.post('/api/t/:token/request', async (req, res) => {
  try {
    const ticket = await getTicketByToken(req.params.token);
    if (!ticket) {
      console.log('❌ Request failed: Ticket not found for token:', req.params.token);
      return res.status(404).json({ error: 'Ticket not found' });
    }

    console.log(`🚗 Request my car: Ticket #${ticket.ticket_number}, current status: ${ticket.status}`);

    // Only allow transition from 'parked' to 'requested'
    if (ticket.status === 'parked') {
      const stmt = db.prepare("UPDATE tickets SET status = 'requested', updated_at = datetime('now') WHERE id = ?");
      if (USE_POSTGRES) {
        await stmt.run(ticket.id);
      } else {
        stmt.run(ticket.id);
      }
      console.log(`✅ Ticket #${ticket.ticket_number} updated to 'requested'`);

      // Broadcast update to operator dashboard
      const updatedTicket = await getTicket(ticket.id);
      broadcastUpdate('ticket_updated', { ticket: updatedTicket });
    } else {
      console.log(`⚠️  Ticket #${ticket.ticket_number} cannot be requested (status: ${ticket.status})`);
    }

    const payload = await publicTicketPayload(req, await getTicket(ticket.id));
    res.json(payload);
  } catch (err) {
    console.error('❌ Error in /api/t/:token/request:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ---------- auth gate for everything else under /api ----------

app.use('/api', (req, res, next) => {
  const open =
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/t/');
  if (open) return next();
  return requireAuth(req, res, next);
});

// ---------- config / status ----------

app.get('/api/config', async (req, res) => {
  const event = await getCurrentEvent(req.user.id);
  res.json({
    aiEnabled,
    user: req.user,
    event: event ? { id: event.id, name: event.name } : null,
  });
});

// ---------- SSE endpoint for real-time updates ----------

app.get('/api/updates', (req, res) => {
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Add this client to the set
  sseClients.add(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Remove client when connection closes
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ---------- events ----------

// Get all events for the current user
app.get('/api/events', async (req, res) => {
  const events = await getUserEvents(req.user.id);
  const currentEvent = await getCurrentEvent(req.user.id);
  res.json({ events, current_event_id: currentEvent?.id || null });
});

// Create a new event for the current user
app.post('/api/events', async (req, res) => {
  const name = (req.body?.name || '').trim() || 'Valet Event';
  const activeVal = USE_POSTGRES ? true : 1;

  const insertStmt = db.prepare('INSERT INTO events (user_id, name, active) VALUES (?, ?, ?)');
  const info = USE_POSTGRES
    ? await insertStmt.run(req.user.id, name, activeVal)
    : insertStmt.run(req.user.id, name, activeVal);

  const selectStmt = db.prepare('SELECT * FROM events WHERE id = ?');
  const event = USE_POSTGRES
    ? await selectStmt.get(info.lastInsertRowid)
    : selectStmt.get(info.lastInsertRowid);

  // Auto-select this event if user has no current event
  const currentEvent = await getCurrentEvent(req.user.id);
  if (!currentEvent) {
    await setCurrentEvent(req.user.id, event.id);
  }

  res.status(201).json(event);
});

// Select an event as the current working event
app.post('/api/events/:id/select', async (req, res) => {
  const eventId = parseInt(req.params.id);
  const stmt = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?');
  const event = USE_POSTGRES ? await stmt.get(eventId, req.user.id) : stmt.get(eventId, req.user.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  await setCurrentEvent(req.user.id, eventId);
  res.json({ event, message: 'Event selected' });
});

// Mark an event as completed
app.post('/api/events/:id/complete', async (req, res) => {
  const eventId = parseInt(req.params.id);
  const stmt = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?');
  const event = USE_POSTGRES ? await stmt.get(eventId, req.user.id) : stmt.get(eventId, req.user.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const completedVal = USE_POSTGRES ? true : 1;
  const updateStmt = db.prepare('UPDATE events SET completed = ? WHERE id = ?');
  if (USE_POSTGRES) {
    await updateStmt.run(completedVal, eventId);
  } else {
    updateStmt.run(completedVal, eventId);
  }

  // If this was the current event, clear it
  if (req.user.current_event_id === eventId) {
    await setCurrentEvent(req.user.id, null);
  }

  res.json({ message: 'Event marked as completed' });
});

// Reopen a completed event
app.post('/api/events/:id/reopen', async (req, res) => {
  const eventId = parseInt(req.params.id);
  const stmt = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?');
  const event = USE_POSTGRES ? await stmt.get(eventId, req.user.id) : stmt.get(eventId, req.user.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const completedVal = USE_POSTGRES ? false : 0;
  const updateStmt = db.prepare('UPDATE events SET completed = ? WHERE id = ?');
  if (USE_POSTGRES) {
    await updateStmt.run(completedVal, eventId);
  } else {
    updateStmt.run(completedVal, eventId);
  }

  res.json({ message: 'Event reopened' });
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

app.get('/api/tickets', async (req, res) => {
  const event = await getCurrentEvent(req.user.id);
  if (!event) {
    return res.json({ event: null, tickets: [] });
  }
  const stmt = db.prepare('SELECT * FROM tickets WHERE event_id = ? ORDER BY ticket_number DESC');
  const tickets = USE_POSTGRES ? await stmt.all(event.id) : stmt.all(event.id);
  res.json({ event: { id: event.id, name: event.name }, tickets });
});

app.post('/api/tickets', async (req, res) => {
  const event = await getCurrentEvent(req.user.id);
  if (!event) {
    return res.status(400).json({ error: 'No active event selected. Please create or select an event first.' });
  }
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'A valid phone number is required.' });

  const number = await nextTicketNumber(event.id);
  const info = db
    .prepare(
      `INSERT INTO tickets (event_id, ticket_number, phone, plate, make_model, color, notes, public_token, front_photo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      number,
      phone,
      (req.body?.plate || '').trim() || null,
      (req.body?.make_model || '').trim() || null,
      (req.body?.color || '').trim() || null,
      (req.body?.notes || '').trim() || null,
      newToken(),
      req.body?.front_photo || null  // Save front photo as base64
    );
  const newTicket = getTicket(info.lastInsertRowid);

  // Broadcast update to all connected clients
  broadcastUpdate('ticket_created', { ticket: newTicket });

  res.status(201).json(newTicket);
});

app.patch('/api/tickets/:id', async (req, res) => {
  const ticket = await getTicket(req.params.id);
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
  const updateStmt = db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`);
  if (USE_POSTGRES) {
    await updateStmt.run(...values);
  } else {
    updateStmt.run(...values);
  }
  const updatedTicket = await getTicket(ticket.id);

  // Broadcast update to all connected clients
  broadcastUpdate('ticket_updated', { ticket: updatedTicket });

  res.json(updatedTicket);
});

app.delete('/api/tickets/:id', async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  // Delete associated messages first to avoid foreign key constraint error
  const deleteMessages = db.prepare('DELETE FROM messages WHERE ticket_id = ?');
  if (USE_POSTGRES) {
    await deleteMessages.run(ticket.id);
  } else {
    deleteMessages.run(ticket.id);
  }

  const deleteTicket = db.prepare('DELETE FROM tickets WHERE id = ?');
  if (USE_POSTGRES) {
    await deleteTicket.run(ticket.id);
  } else {
    deleteTicket.run(ticket.id);
  }

  // Broadcast update to all connected clients
  broadcastUpdate('ticket_deleted', { id: ticket.id });

  res.json({ ok: true });
});

// ---------- frontend ----------

// Gate the operator dashboard behind login; public pages stay open.
app.get(['/', '/index.html'], (req, res) => {
  if (!req.user) return res.redirect('/login.html');
  res.sendFile(join(publicDir, 'index.html'));
});

app.use(express.static(publicDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Valet ticket system running on http://localhost:${PORT}`);
  console.log(`  AI vision : ${aiEnabled ? 'Gemini (live)' : 'mock (set GEMINI_API_KEY)'}`);
  const count = await userCount();
  console.log(`  Auth      : ${count} account(s)${SIGNUP_CODE ? ', signup code required' : ''}`);
});
