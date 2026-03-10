import { Database, eq, desc, sql, like } from "@/storage/db"
import { MemoryTable } from "./memory.sql"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import { Embedding } from "./embedding"

const log = Log.create({ service: "memory" })

/** Sanitize input for FTS5 MATCH queries by quoting each word. */
function sanitizeFTS(input: string): string {
  const terms = input
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term.replace(/"/g, '""')}"`)
  return terms.join(" ") || '""'
}

export namespace Memory {
  const FTS_TABLE = "memory_fts"

  /** Categories for organizing memories */
  export type Category =
    | "general"
    | "factual"
    | "preference"
    | "emotional"
    | "task"
    | "relationship"
    | "interaction"
    | string

  export interface StoreInput {
    content: string
    category?: Category
    importance?: number
    source?: string
  }

  export interface RecallInput {
    query: string
    limit?: number
    category?: string
  }

  export interface Memory {
    id: string
    content: string
    category: string
    importance: number
    source: string | null
    accessCount: number
    timeCreated: number
    timeUpdated: number
    timeAccessed: number | null
  }

  /** Store a new memory with optional embedding */
  export async function store(input: StoreInput): Promise<Memory> {
    const id = ulid()
    const now = Date.now()
    const importance = Math.max(0, Math.min(1, input.importance ?? 0.5))

    // Generate embedding (non-blocking, returns undefined if no API key)
    const vector = await Embedding.embed(input.content)

    return Database.use((db) => {
      const raw = (db as any).$client as import("bun:sqlite").Database

      raw.run(
        `INSERT INTO memory (id, content, category, importance, source, time_created, time_updated, access_count, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.content, input.category ?? "general", importance, input.source ?? null, now, now, 0, vector ? Embedding.toBlob(vector) : null],
      )

      // Insert into FTS index
      raw.run(
        `INSERT INTO ${FTS_TABLE}(id, content, category) VALUES (?, ?, ?)`,
        [id, input.content, input.category ?? "general"],
      )

      log.info("stored memory", { id, category: input.category, importance, hasEmbedding: !!vector })

      return {
        id,
        content: input.content,
        category: input.category ?? "general",
        importance,
        source: input.source ?? null,
        accessCount: 0,
        timeCreated: now,
        timeUpdated: now,
        timeAccessed: null,
      }
    })
  }

  /** Recall memories using hybrid search: FTS5 keyword matching + vector cosine similarity.
   *  Results are merged and deduplicated, scored by combined rank. */
  export async function recall(input: RecallInput): Promise<Memory[]> {
    const limit = input.limit ?? 10

    // Run FTS5 and embedding queries in parallel
    const queryVector = await Embedding.embed(input.query)

    return Database.use((db) => {
      const raw = (db as any).$client as import("bun:sqlite").Database

      // ── FTS5 keyword search ──
      let ftsRows: any[] = []
      try {
        let ftsQuery: string
        let ftsParams: any[]

        if (input.category) {
          ftsQuery = `
            SELECT m.*, fts.rank
            FROM ${FTS_TABLE} fts
            JOIN memory m ON m.id = fts.id
            WHERE ${FTS_TABLE} MATCH ?
              AND m.category = ?
            ORDER BY (fts.rank * m.importance) ASC
            LIMIT ?
          `
          ftsParams = [sanitizeFTS(input.query), input.category, limit * 2]
        } else {
          ftsQuery = `
            SELECT m.*, fts.rank
            FROM ${FTS_TABLE} fts
            JOIN memory m ON m.id = fts.id
            WHERE ${FTS_TABLE} MATCH ?
            ORDER BY (fts.rank * m.importance) ASC
            LIMIT ?
          `
          ftsParams = [sanitizeFTS(input.query), limit * 2]
        }

        ftsRows = raw.prepare(ftsQuery).all(...ftsParams) as any[]
      } catch {
        // FTS5 MATCH can fail on malformed queries — fall through to vector search
      }

      // ── Vector similarity search ──
      let vectorRows: Array<any & { _similarity: number }> = []
      if (queryVector) {
        let vecQuery: string
        let vecParams: any[]

        if (input.category) {
          vecQuery = `SELECT * FROM memory WHERE embedding IS NOT NULL AND category = ? LIMIT 200`
          vecParams = [input.category]
        } else {
          vecQuery = `SELECT * FROM memory WHERE embedding IS NOT NULL LIMIT 200`
          vecParams = []
        }

        const candidates = raw.prepare(vecQuery).all(...vecParams) as any[]
        for (const row of candidates) {
          if (!row.embedding) continue
          const vec = Embedding.fromBlob(row.embedding)
          const similarity = Embedding.cosineSimilarity(queryVector, vec)
          if (similarity > 0.3) {
            vectorRows.push({ ...row, _similarity: similarity })
          }
        }

        // Sort by similarity * importance descending
        vectorRows.sort((a, b) => (b._similarity * b.importance) - (a._similarity * a.importance))
        vectorRows = vectorRows.slice(0, limit * 2)
      }

      // ── Merge and deduplicate ──
      const seen = new Set<string>()
      const scored: Array<{ row: any; score: number }> = []

      // FTS5 rank is negative (more negative = more relevant), normalize to 0-1
      const maxFtsRank = ftsRows.length > 0 ? Math.abs(ftsRows[0].rank) : 1
      for (const row of ftsRows) {
        const ftsScore = (Math.abs(row.rank) / maxFtsRank) * row.importance
        seen.add(row.id)
        scored.push({ row, score: ftsScore })
      }

      for (const row of vectorRows) {
        if (seen.has(row.id)) {
          // Boost existing FTS result with vector similarity
          const existing = scored.find((s) => s.row.id === row.id)
          if (existing) {
            existing.score = existing.score * 0.5 + row._similarity * row.importance * 0.5
          }
        } else {
          seen.add(row.id)
          scored.push({ row, score: row._similarity * row.importance })
        }
      }

      // Sort by combined score descending, take top N
      scored.sort((a, b) => b.score - a.score)
      const results = scored.slice(0, limit)

      // Update access tracking
      const now = Date.now()
      for (const { row } of results) {
        db.update(MemoryTable)
          .set({
            time_accessed: now,
            access_count: (row.access_count ?? 0) + 1,
          })
          .where(eq(MemoryTable.id, row.id))
          .run()
      }

      return results.map(({ row }) => toMemory(row))
    })
  }

  /** Browse memories by category */
  export function browse(category?: string, limit?: number): Memory[] {
    return Database.use((db) => {
      let query = db.select().from(MemoryTable)

      if (category) {
        return query
          .where(eq(MemoryTable.category, category))
          .orderBy(desc(MemoryTable.importance))
          .limit(limit ?? 20)
          .all()
          .map(toMemory)
      }

      return query
        .orderBy(desc(MemoryTable.importance))
        .limit(limit ?? 20)
        .all()
        .map(toMemory)
    })
  }

  /** Delete a memory by ID */
  export function remove(id: string): boolean {
    return Database.use((db) => {
      const raw = (db as any).$client as import("bun:sqlite").Database
      raw.run(`DELETE FROM ${FTS_TABLE} WHERE id = ?`, [id])
      const result = raw.run(`DELETE FROM memory WHERE id = ?`, [id])
      log.info("deleted memory", { id })
      return result.changes > 0
    })
  }

  /** Apply importance decay to all memories. Importance floors at minImportance — memories are never deleted by decay. */
  export function decay(factor: number = 0.995, minImportance: number = 0.05): number {
    return Database.use((db) => {
      const raw = (db as any).$client as import("bun:sqlite").Database
      const result = raw.run(
        `UPDATE memory SET importance = max(importance * ?, ?) WHERE importance > ?`,
        [factor, minImportance, minImportance],
      )
      return result.changes
    })
  }

  /** Get memory count and stats */
  export function stats(): { total: number; byCategory: Record<string, number>; avgImportance: number } {
    return Database.use((db) => {
      const agg = db
        .select({
          count: sql<number>`count(*)`,
          avgImportance: sql<number>`coalesce(avg(importance), 0)`,
        })
        .from(MemoryTable)
        .get()

      const total = agg?.count ?? 0
      const avgImportance = Math.round((agg?.avgImportance ?? 0) * 1000) / 1000

      const categories = db
        .select({
          category: MemoryTable.category,
          count: sql<number>`count(*)`,
        })
        .from(MemoryTable)
        .groupBy(MemoryTable.category)
        .all()

      const byCategory: Record<string, number> = {}
      for (const row of categories) {
        byCategory[row.category] = row.count
      }

      return { total, byCategory, avgImportance }
    })
  }

  function toMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      category: row.category,
      importance: row.importance,
      source: row.source,
      accessCount: row.access_count ?? row.accessCount ?? 0,
      timeCreated: row.time_created ?? row.timeCreated,
      timeUpdated: row.time_updated ?? row.timeUpdated,
      timeAccessed: row.time_accessed ?? row.timeAccessed ?? null,
    }
  }
}
