import { sqliteTable, text, integer, real, index, blob } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    content: text().notNull(),
    category: text().notNull().default("general"),
    importance: real().notNull().default(0.5),
    source: text(), // where this memory came from (session, telegram, etc.)
    ...Timestamps,
    time_accessed: integer(), // last time this memory was recalled
    access_count: integer().notNull().default(0),
    embedding: blob({ mode: "buffer" }), // Float32Array vector for semantic search
  },
  (table) => [
    index("memory_category_idx").on(table.category),
    index("memory_importance_idx").on(table.importance),
  ],
)
