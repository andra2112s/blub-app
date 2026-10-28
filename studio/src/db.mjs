import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, defaultSettings } from './config.mjs';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    picture TEXT NOT NULL DEFAULT '',
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    banned INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topup_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    price INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    qris TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    claimed_at INTEGER,
    decided_at INTEGER,
    decided_by TEXT
  );
  CREATE INDEX IF NOT EXISTS orders_status ON orders(status, amount);
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package TEXT NOT NULL,
    idea TEXT NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0,
    plan TEXT,
    assets TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, created);
  CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'main'").get();
  const saved = row ? JSON.parse(row.value) : {};
  return { ...defaultSettings, ...saved };
}

export function saveSettings(value) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('main', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(value));
}

/* Mutasi kredit + catatan ledger; panggil di dalam tx(). Throw kalau saldo tidak cukup. */
export function applyCredits(userId, delta, reason, ref = '') {
  const res = db.prepare('UPDATE users SET credits = credits + ? WHERE id = ? AND credits + ? >= 0').run(delta, userId, delta);
  if (!res.changes) throw Object.assign(new Error('Kredit tidak cukup'), { status: 402 });
  db.prepare('INSERT INTO ledger (user_id, delta, reason, ref, created) VALUES (?, ?, ?, ?, ?)').run(userId, delta, reason, ref, Date.now());
  return db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
}

export const addCredits = (userId, delta, reason, ref) => tx(() => applyCredits(userId, delta, reason, ref));
