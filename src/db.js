// Dual database support: SQLite for local development, PostgreSQL for production (GCP Cloud SQL).
// Automatically switches based on DATABASE_URL environment variable.
import { randomBytes } from 'node:crypto';

const USE_POSTGRES = Boolean(process.env.DATABASE_URL);

let db;

if (USE_POSTGRES) {
  // PostgreSQL setup for production
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  // Create tables for PostgreSQL
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id            SERIAL PRIMARY KEY,
      event_id      INTEGER NOT NULL REFERENCES events(id),
      ticket_number INTEGER NOT NULL,
      phone         TEXT NOT NULL,
      plate         TEXT,
      make_model    TEXT,
      color         TEXT,
      notes         TEXT,
      status        TEXT NOT NULL DEFAULT 'parked',
      notified      BOOLEAN NOT NULL DEFAULT FALSE,
      public_token  TEXT,
      front_photo   TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, ticket_number)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          SERIAL PRIMARY KEY,
      ticket_id   INTEGER REFERENCES tickets(id),
      direction   TEXT NOT NULL,
      body        TEXT NOT NULL,
      counterpart TEXT,
      delivered   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Wrap PostgreSQL pool with a SQLite-like API
  db = {
    prepare: (sql) => {
      // Convert SQLite placeholders (?) to PostgreSQL placeholders ($1, $2, etc.)
      let index = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++index}`);

      return {
        get: async (...params) => {
          const result = await pool.query(pgSql, params);
          return result.rows[0] || null;
        },
        all: async (...params) => {
          const result = await pool.query(pgSql, params);
          return result.rows;
        },
        run: async (...params) => {
          const result = await pool.query(pgSql + ' RETURNING *', params);
          return {
            lastInsertRowid: result.rows[0]?.id || null,
            changes: result.rowCount,
          };
        },
      };
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
  };
} else {
  // SQLite setup for local development
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  const DB_PATH = process.env.DB_PATH || './data/valet.db';
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const sqlite = new DatabaseSync(DB_PATH);

  sqlite.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

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
      public_token  TEXT,
      front_photo   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, ticket_number)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER REFERENCES tickets(id),
      direction   TEXT NOT NULL,
      body        TEXT NOT NULL,
      counterpart TEXT,
      delivered   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Lightweight migrations for databases created before a column existed
  function ensureColumn(table, column, definition) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  ensureColumn('tickets', 'public_token', 'TEXT');
  ensureColumn('tickets', 'front_photo', 'TEXT');

  // Backfill share tokens for any legacy tickets missing one
  for (const row of sqlite.prepare('SELECT id FROM tickets WHERE public_token IS NULL').all()) {
    sqlite.prepare('UPDATE tickets SET public_token = ? WHERE id = ?').run(newToken(), row.id);
  }

  db = sqlite;
}

export { db, USE_POSTGRES };

export function newToken(bytes = 18) {
  return randomBytes(bytes).toString('base64url');
}

// Ensure there is always an active event to attach tickets to.
export async function getActiveEvent() {
  const getter = db.prepare('SELECT * FROM events WHERE active = ? ORDER BY id DESC LIMIT 1');
  let ev = USE_POSTGRES
    ? await getter.get(true)
    : getter.get(USE_POSTGRES ? true : 1);

  if (!ev) {
    const inserter = db.prepare('INSERT INTO events (name, active) VALUES (?, ?)');
    const info = USE_POSTGRES
      ? await inserter.run('Valet Event', true)
      : inserter.run('Valet Event', 1);

    const fetchNew = db.prepare('SELECT * FROM events WHERE id = ?');
    ev = USE_POSTGRES
      ? await fetchNew.get(info.lastInsertRowid)
      : fetchNew.get(info.lastInsertRowid);
  }

  return ev;
}

export async function nextTicketNumber(eventId) {
  const getter = db.prepare('SELECT COALESCE(MAX(ticket_number), 0) AS max FROM tickets WHERE event_id = ?');
  const row = USE_POSTGRES ? await getter.get(eventId) : getter.get(eventId);
  return row.max + 1;
}

// Initialize: backfill tokens for PostgreSQL on startup
if (USE_POSTGRES) {
  const getter = db.prepare('SELECT id FROM tickets WHERE public_token IS NULL');
  const rows = await getter.all();
  for (const row of rows) {
    const updater = db.prepare('UPDATE tickets SET public_token = ? WHERE id = ?');
    await updater.run(newToken(), row.id);
  }
}
