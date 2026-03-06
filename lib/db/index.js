import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import * as schema from './schema.js';
import { createLogger } from '../logger.js';

const log = createLogger('DB');

let _db = null;
let _sqlite = null;

/**
 * Initialize database: create SQLite file, run migrations, enable FTS5.
 */
export function initDatabase(dbPath) {
  if (_db) return _db;

  const resolvedPath = resolve(dbPath || 'data/spawnbot.sqlite');
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _sqlite = new Database(resolvedPath);

  // Performance pragmas
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');

  _db = drizzle(_sqlite, { schema });

  // Run Drizzle migrations if drizzle/ folder exists
  const migrationsPath = resolve(dirname(dbPath || 'data/spawnbot.sqlite'), '..', 'drizzle');
  if (existsSync(migrationsPath)) {
    try {
      migrate(_db, { migrationsFolder: migrationsPath });
    } catch (err) {
      // Migrations may not exist yet during initial development
      if (!err.message.includes('No migrations')) {
        log.error('Migration error', err);
      }
    }
  }

  // Create FTS5 virtual table for memory search (idempotent)
  _sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      category,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );
  `);

  // Ensure tables exist (fallback if no migrations yet)
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT,
      importance REAL DEFAULT 0.5,
      source TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      input_text TEXT,
      output_text TEXT,
      tools_used TEXT,
      turn_duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      template_id TEXT,
      category TEXT,
      description TEXT NOT NULL,
      intensity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      assigned_at INTEGER,
      deadline_at INTEGER,
      completed_at INTEGER,
      proof_type TEXT,
      proof_received INTEGER DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'GBP',
      source TEXT,
      description TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      source TEXT,
      summary TEXT,
      data TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  log.info(`Initialized: ${resolvedPath}`);
  return _db;
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb() {
  if (!_db) throw new Error('Database not initialized — call initDatabase() first');
  return _db;
}

/**
 * Get raw SQLite handle (for FTS5 queries).
 */
export function getSqlite() {
  if (!_sqlite) throw new Error('Database not initialized');
  return _sqlite;
}

/**
 * Close the database connection.
 */
export function closeDatabase() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
