import { Database, eq, desc, sql, like } from "@/storage/db"
import { MemoryTable } from "./memory.sql"
import { Log } from "@/util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "memory" })

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

  /** Store a new memory */
  export function store(input: StoreInput): Memory {
    const id = ulid()
    const now = Date.now()
    const importance = Math.max(0, Math.min(1, input.importance ?? 0.5))

    return Database.use((db) => {
      db.insert(MemoryTable).values({
        id,
        content: input.content,
        category: input.category ?? "general",
        importance,
        source: input.source ?? null,
        time_created: now,
        time_updated: now,
        access_count: 0,
      }).run()

      // Insert into FTS index
      const raw = (db as any).$client as import("bun:sqlite").Database
      raw.run(
        `INSERT INTO ${FTS_TABLE}(id, content, category) VALUES (?, ?, ?)`,
        [id, input.content, input.category ?? "general"],
      )

      log.info("stored memory", { id, category: input.category, importance })

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

  /** Recall memories by FTS5 full-text search, ranked by relevance * importance */
  export function recall(input: RecallInput): Memory[] {
    const limit = input.limit ?? 10

    return Database.use((db) => {
      const raw = (db as any).$client as import("bun:sqlite").Database

      let query: string
      let params: any[]

      if (input.category) {
        query = `
          SELECT m.*, fts.rank
          FROM ${FTS_TABLE} fts
          JOIN memory m ON m.id = fts.id
          WHERE ${FTS_TABLE} MATCH ?
            AND m.category = ?
          ORDER BY (fts.rank * m.importance) ASC
          LIMIT ?
        `
        params = [input.query, input.category, limit]
      } else {
        query = `
          SELECT m.*, fts.rank
          FROM ${FTS_TABLE} fts
          JOIN memory m ON m.id = fts.id
          WHERE ${FTS_TABLE} MATCH ?
          ORDER BY (fts.rank * m.importance) ASC
          LIMIT ?
        `
        params = [input.query, limit]
      }

      const rows = raw.prepare(query).all(...params) as any[]

      // Update access tracking
      const now = Date.now()
      for (const row of rows) {
        db.update(MemoryTable)
          .set({
            time_accessed: now,
            access_count: (row.access_count ?? 0) + 1,
          })
          .where(eq(MemoryTable.id, row.id))
          .run()
      }

      return rows.map(toMemory)
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
      const result = db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()

      // Remove from FTS index
      const raw = (db as any).$client as import("bun:sqlite").Database
      raw.run(`DELETE FROM ${FTS_TABLE} WHERE id = ?`, [id])

      log.info("deleted memory", { id })
      return result.changes > 0
    })
  }

  /** Apply importance decay to all memories. Importance floors at minImportance — memories are never deleted by decay. */
  export function decay(factor: number = 0.995, minImportance: number = 0.05) {
    return Database.use((db) => {
      db.update(MemoryTable)
        .set({
          importance: sql`max(importance * ${factor}, ${minImportance})`,
        })
        .run()
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
