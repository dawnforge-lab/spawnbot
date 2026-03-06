import { Memory } from "./index"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "memory.flush" })

/**
 * Extract key information from a compaction summary and store as memories.
 * Called after session compaction to persist important context that would
 * otherwise be lost when old messages are pruned.
 */
export async function flushFromCompaction(sessionID: string) {
  const messages = await Session.messages({ sessionID, limit: 5 })

  // Find the most recent summary message
  const summary = messages.find(
    (m) => m.info.role === "assistant" && (m.info as any).summary === true,
  )
  if (!summary) {
    log.warn("no summary message found for flush", { sessionID })
    return
  }

  const text = summary.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")

  if (!text.trim()) return

  // Extract sections from the structured summary template
  const sections = parseSummarySections(text)
  let stored = 0

  // Store discoveries as factual memories (highest value — learned knowledge)
  if (sections.discoveries) {
    await Memory.store({
      content: sections.discoveries,
      category: "factual",
      importance: 0.9,
      source: `compaction:${sessionID}`,
    })
    stored++
  }

  // Store accomplished work as task memories
  if (sections.accomplished) {
    await Memory.store({
      content: sections.accomplished,
      category: "task",
      importance: 0.7,
      source: `compaction:${sessionID}`,
    })
    stored++
  }

  // Store goals as task memories
  if (sections.goal) {
    await Memory.store({
      content: sections.goal,
      category: "task",
      importance: 0.8,
      source: `compaction:${sessionID}`,
    })
    stored++
  }

  // Store instructions as preference memories
  if (sections.instructions) {
    await Memory.store({
      content: sections.instructions,
      category: "preference",
      importance: 0.85,
      source: `compaction:${sessionID}`,
    })
    stored++
  }

  if (stored > 0) {
    log.info("flushed compaction to memory", { sessionID, stored })
  }
}

/**
 * Parse the structured compaction summary into sections.
 * The compaction prompt uses ## headings: Goal, Instructions, Discoveries, Accomplished, Relevant files.
 */
function parseSummarySections(text: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = text.split("\n")
  let currentKey: string | undefined

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)/)
    if (heading) {
      currentKey = heading[1].trim().toLowerCase().replace(/\s+\/\s+/g, "_").replace(/\s+/g, "_")
      sections[currentKey] = ""
      continue
    }
    if (currentKey) {
      sections[currentKey] += line + "\n"
    }
  }

  // Trim all sections
  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].trim()
    if (!sections[key]) delete sections[key]
  }

  return sections
}
