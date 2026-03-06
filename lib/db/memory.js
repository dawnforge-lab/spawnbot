import { v4 as uuid } from 'uuid';
import { eq, desc, sql } from 'drizzle-orm';
import { getDb, getSqlite } from './index.js';
import { memories } from './schema.js';

/**
 * Store a new memory.
 */
export async function storeMemory({ content, category, importance, source, metadata }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  db.insert(memories).values({
    id,
    content,
    category: category || 'general',
    importance: importance ?? 0.5,
    source: source || 'system',
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: now,
    lastAccessedAt: now,
  }).run();

  // Index in FTS5
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO memories_fts (rowid, content, category) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?, ?)'
  ).run(id, content, category || 'general');

  return { id, createdAt: now };
}

/**
 * Recall memories by full-text search (FTS5).
 * Returns top matches ranked by relevance + importance.
 */
export function recallMemory(query, { limit = 10, category } = {}) {
  const sqlite = getSqlite();

  let sql_query;
  let params;

  if (category) {
    sql_query = `
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
        AND m.category = ?
      ORDER BY (rank * -1) * m.importance DESC
      LIMIT ?
    `;
    params = [query, category, limit];
  } else {
    sql_query = `
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY (rank * -1) * m.importance DESC
      LIMIT ?
    `;
    params = [query, limit];
  }

  const results = sqlite.prepare(sql_query).all(...params);

  // Update last_accessed_at for returned memories
  const now = Date.now();
  const update = sqlite.prepare('UPDATE memories SET last_accessed_at = ? WHERE id = ?');
  for (const r of results) {
    update.run(now, r.id);
  }

  return results.map(r => ({
    id: r.id,
    content: r.content,
    category: r.category,
    importance: r.importance,
    source: r.source,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: r.created_at,
    lastAccessedAt: now,
  }));
}

/**
 * Search memories by category (no FTS, just filter).
 */
export function searchMemories({ category, source, limit = 20, minImportance = 0 }) {
  const db = getDb();
  const conditions = [];

  let query = db.select().from(memories);

  if (category) {
    query = query.where(eq(memories.category, category));
  }

  const results = query
    .orderBy(desc(memories.createdAt))
    .limit(limit)
    .all();

  return results
    .filter(r => r.importance >= minImportance)
    .filter(r => !source || r.source === source)
    .map(r => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
}

/**
 * Decay importance of old memories.
 * Called periodically (e.g., daily) to let less-accessed memories fade.
 */
export function decayMemories({ decayRate = 0.01, minImportance = 0.05 }) {
  const sqlite = getSqlite();
  const now = Date.now();
  const oneDayMs = 86_400_000;

  // Decay memories not accessed in the last 24h
  const result = sqlite.prepare(`
    UPDATE memories
    SET importance = MAX(?, importance - ?)
    WHERE last_accessed_at < ?
      AND importance > ?
  `).run(minImportance, decayRate, now - oneDayMs, minImportance);

  return { decayed: result.changes };
}

/**
 * Delete a specific memory by id.
 */
export function deleteMemory(id) {
  const sqlite = getSqlite();
  // Remove from FTS
  sqlite.prepare(
    'DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)'
  ).run(id);
  // Remove from main table
  sqlite.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return { deleted: true };
}
