/**
 * Autonomy response filter — detects silent acknowledgments and drops them.
 *
 * When the LLM responds to an autonomous event (heartbeat, cron, idle) with
 * just "HEARTBEAT_OK" or a short vacuous acknowledgment, we drop the response
 * instead of delivering it to the user. This teaches the LLM that silence
 * gets nothing — action and engagement get delivered.
 */

import { Log } from "@/util/log"

const log = Log.create({ service: "autonomy.filter" })

/** The token the LLM can use to signal "nothing to do" */
export const HEARTBEAT_OK = "HEARTBEAT_OK"

/** Max chars for a response to be considered a short acknowledgment */
const ACK_MAX_CHARS = 300

/** Strip the HEARTBEAT_OK token from a response, returning the remaining text */
export function stripHeartbeatToken(response: string): string {
  return response.replace(/HEARTBEAT_OK/g, "").trim()
}

/**
 * Check if an autonomous response should be dropped (not delivered to user).
 *
 * Returns true if the response is:
 * - Just HEARTBEAT_OK with no other content
 * - A short acknowledgment under ACK_MAX_CHARS after stripping the token
 * - Empty or whitespace-only
 */
export function shouldDropResponse(response: string, source: string): boolean {
  const stripped = stripHeartbeatToken(response)

  if (!stripped) {
    log.info("dropping empty autonomous response", { source })
    return true
  }

  // If the original contained HEARTBEAT_OK and the remaining text is short,
  // it's likely just a polite wrapper around "nothing to do"
  if (response.includes(HEARTBEAT_OK) && stripped.length < ACK_MAX_CHARS) {
    log.info("dropping short heartbeat acknowledgment", {
      source,
      length: stripped.length,
    })
    return true
  }

  return false
}

/** Sources that are considered autonomous (eligible for filtering) */
export function isAutonomousSource(source: string): boolean {
  return (
    source === "autonomy" ||
    source.startsWith("cron/") ||
    source.startsWith("poller/")
  )
}
