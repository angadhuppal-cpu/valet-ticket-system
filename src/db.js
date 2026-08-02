// SQLite persistence layer using Node's built-in sqlite module.
// Keeps the app dependency-light and free of native build steps.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/valet.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      INTEGER NOT NULL REFERENCES events(id),
    ticket_number INTEGER NOT NULL,
    phone         TEXT NOT NULL,
    plate         TEXT,
    make_model    TEXT,
    color         TEXT,
    notes         TEXT,
    status        TEXT NOT NULL DEFAULT 'parked',
    notified      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(event_id, ticket_number)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER REFERENCES tickets(id),
    direction   TEXT NOT NULL,          -- 'out' or 'in'
    body        TEXT NOT NULL,
    counterpart TEXT,                   -- the owner's phone number
    delivered   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Ensure there is always an active event to attach tickets to.
export function getActiveEvent() {
  let ev = db.prepare('SELECT * FROM events WHERE active = 1 ORDER BY id DESC LIMIT 1').get();
  if (!ev) {
    const info = db
      .prepare("INSERT INTO events (name, active) VALUES (?, 1)")
      .run('Valet Event');
    ev = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  }
  return ev;
}

export function nextTicketNumber(eventId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(ticket_number), 0) AS max FROM tickets WHERE event_id = ?')
    .get(eventId);
  return row.max + 1;
}
