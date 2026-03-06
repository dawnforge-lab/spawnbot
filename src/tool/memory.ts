import z from "zod"
import { Tool } from "./tool"
import { Memory } from "../memory"

export const MemoryStoreTool = Tool.define("memory_store", {
  description: `Store a memory for long-term recall. Use this to remember important information about the user, project, preferences, decisions, or anything that should persist across sessions.

Categories: general, factual, preference, emotional, task, relationship, interaction
Importance: 0.0 (trivial) to 1.0 (critical). Default 0.5. Memories decay over time — higher importance lasts longer.`,
  parameters: z.object({
    content: z.string().describe("The memory content to store"),
    category: z
      .string()
      .default("general")
      .describe("Category: general, factual, preference, emotional, task, relationship, interaction"),
    importance: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Importance from 0.0 (trivial) to 1.0 (critical)"),
  }),
  async execute(params) {
    const memory = Memory.store({
      content: params.content,
      category: params.category,
      importance: params.importance,
    })
    return {
      title: `Stored memory [${memory.category}]`,
      metadata: { memoryId: memory.id },
      output: `Memory stored (id: ${memory.id}, category: ${memory.category}, importance: ${memory.importance})`,
    }
  },
})

export const MemoryRecallTool = Tool.define("memory_recall", {
  description: `Search long-term memories using full-text search. Returns memories ranked by relevance and importance. Use this to recall information from previous sessions.`,
  parameters: z.object({
    query: z.string().describe("Search query (supports full-text search)"),
    category: z.string().optional().describe("Filter by category"),
    limit: z.coerce.number().default(10).describe("Maximum number of results"),
  }),
  async execute(params) {
    const memories = Memory.recall({
      query: params.query,
      limit: params.limit,
      category: params.category,
    })

    if (memories.length === 0) {
      return {
        title: "No memories found",
        metadata: { count: 0 },
        output: `No memories found matching "${params.query}"`,
      }
    }

    const lines = memories.map(
      (m) =>
        `[${m.id}] (${m.category}, importance: ${m.importance.toFixed(2)}) ${m.content}`,
    )

    return {
      title: `${memories.length} memories found`,
      metadata: { count: memories.length },
      output: lines.join("\n\n"),
    }
  },
})

export const MemoryBrowseTool = Tool.define("memory_browse", {
  description: `Browse stored memories, optionally filtered by category. Returns memories sorted by importance.`,
  parameters: z.object({
    category: z.string().optional().describe("Filter by category"),
    limit: z.coerce.number().default(20).describe("Maximum number of results"),
  }),
  async execute(params) {
    const memories = Memory.browse(params.category, params.limit)

    if (memories.length === 0) {
      return {
        title: "No memories",
        metadata: { count: 0 },
        output: params.category
          ? `No memories in category "${params.category}"`
          : "No memories stored yet",
      }
    }

    const lines = memories.map(
      (m) =>
        `[${m.id}] (${m.category}, importance: ${m.importance.toFixed(2)}, accessed: ${m.accessCount}x) ${m.content}`,
    )

    return {
      title: `${memories.length} memories`,
      metadata: { count: memories.length },
      output: lines.join("\n\n"),
    }
  },
})

export const MemoryDeleteTool = Tool.define("memory_delete", {
  description: `Delete a memory by its ID. Use this to remove outdated or incorrect memories.`,
  parameters: z.object({
    id: z.string().describe("The memory ID to delete"),
  }),
  async execute(params) {
    const deleted = Memory.remove(params.id)
    return {
      title: deleted ? "Memory deleted" : "Memory not found",
      metadata: { deleted },
      output: deleted
        ? `Memory ${params.id} deleted`
        : `Memory ${params.id} not found`,
    }
  },
})
