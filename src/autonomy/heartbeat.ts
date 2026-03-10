/**
 * Heartbeat task detection — reads HEARTBEAT.md and determines
 * if there are pending tasks worth waking the agent for.
 *
 * HEARTBEAT.md is the agent's living task board:
 * - [ ] pending task (agent should work on this)
 * - [~] ongoing/recurring task (agent should check in)
 * - [x] completed task (skipped)
 *
 * Any non-empty content counts as "has tasks" — the checkbox
 * format is a convention, not enforced. Free-form text works too.
 */

import fs from "fs"
import path from "path"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "autonomy.heartbeat" })

/**
 * Check if HEARTBEAT.md has pending tasks worth acting on.
 * Returns false if the file doesn't exist or has no actionable content.
 */
export function hasHeartbeatTasks(): boolean {
  const filePath = heartbeatPath()
  if (!filePath) return false

  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return !isEffectivelyEmpty(content)
  } catch {
    return false
  }
}

/**
 * Get the path to HEARTBEAT.md in the workspace, or undefined if not found.
 */
export function heartbeatPath(): string | undefined {
  try {
    const candidate = path.join(Instance.directory, "HEARTBEAT.md")
    if (fs.existsSync(candidate)) return candidate
  } catch {
    // Instance context not available
  }
  return undefined
}

/**
 * Check if HEARTBEAT.md content is effectively empty — no actionable tasks.
 * Strips headers, completed items, blank lines, and whitespace.
 */
function isEffectivelyEmpty(content: string): boolean {
  const lines = content.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines
    if (!trimmed) continue
    // Skip markdown headers
    if (trimmed.startsWith("#")) continue
    // Skip completed tasks
    if (trimmed.startsWith("- [x]") || trimmed.startsWith("* [x]")) continue
    // Skip horizontal rules / separators
    if (/^[-*_]{3,}$/.test(trimmed)) continue
    // Anything else = actionable content
    return false
  }
  return true
}
