import { Memory } from "./index"
import { Log } from "@/util/log"

const log = Log.create({ service: "memory.context" })

const DEFAULT_TOKEN_BUDGET = 2000
// Rough estimate: 1 token ≈ 4 chars
const CHARS_PER_TOKEN = 4

/**
 * Context Director: retrieve relevant memories for the current turn
 * and format them as a system prompt section.
 *
 * Called before each turn with the user's input.
 * Returns undefined if no relevant memories found.
 */
export function buildMemoryContext(
  userInput: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): string | undefined {
  if (!userInput.trim()) return undefined

  const charBudget = tokenBudget * CHARS_PER_TOKEN
  const memories = Memory.recall({ query: userInput, limit: 20 })

  if (memories.length === 0) return undefined

  const lines: string[] = ["<memories>"]
  let totalChars = "<memories>\n</memories>".length

  for (const memory of memories) {
    const line = `[${memory.category}] ${memory.content}`
    if (totalChars + line.length + 1 > charBudget) break
    lines.push(line)
    totalChars += line.length + 1
  }

  if (lines.length === 1) return undefined // only the opening tag

  lines.push("</memories>")

  log.info("injected memory context", {
    count: lines.length - 2,
    chars: totalChars,
  })

  return lines.join("\n")
}
