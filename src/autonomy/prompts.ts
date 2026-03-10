/**
 * Autonomy prompt builders — per-event-type prompts that nudge the LLM
 * toward action and engagement instead of passive acknowledgment.
 *
 * Every prompt ends with an explicit action mandate.
 */

const ACTION_MANDATE =
  "Execute using your tools now. Take concrete action — do not just summarize or acknowledge. " +
  "When done, communicate your results to the user via messaging tools. " +
  "Only reply HEARTBEAT_OK if there is genuinely nothing to do and nothing worth saying."

const ENGAGEMENT_SUFFIX =
  "After completing work, engage with the user: share what you did, offer observations, " +
  "suggest next steps, or ask if they need anything. Prefer action and engagement over silence."

function withTimestamp(prompt: string): string {
  return `${prompt}\n\nCurrent time: ${new Date().toISOString()}`
}

/**
 * Periodic heartbeat — the agent wakes up and checks HEARTBEAT.md.
 * HEARTBEAT.md is your task board. Task format:
 * - [ ] pending (work on this)
 * - [~] ongoing (check in)
 * - [x] done (skip, leave for context)
 */
export function heartbeat(): string {
  return withTimestamp(
    "Read HEARTBEAT.md — your task board. For each pending (- [ ]) or ongoing (- [~]) task:\n" +
      "1. Take concrete action using your tools. Make real progress.\n" +
      "2. Update the task status in HEARTBEAT.md — mark [x] when done, add notes, timestamps.\n" +
      "3. Message the user with what you did and any results.\n\n" +
      "After tasks, think about the user: any follow-ups from recent conversations? " +
      "Anything worth sharing or asking about?\n\n" +
      ACTION_MANDATE,
  )
}

/** Cron job with specific content — execute the task */
export function cronWithContent(jobName: string, taskContent: string): string {
  return withTimestamp(
    `A scheduled task has been triggered: [cron/${jobName}]\n\n` +
      taskContent +
      "\n\n" +
      "Execute this task now using your tools. Once done, share results with the user and engage — " +
      "ask if they need anything else, offer observations, or suggest next steps. " +
      "Do not just acknowledge the task. Take action, then communicate.\n\n" +
      ACTION_MANDATE,
  )
}

/** Cron job fired but had no content — use as opportunity */
export function cronEmpty(jobName: string): string {
  return withTimestamp(
    `A scheduled event was triggered: [cron/${jobName}] but had no specific content. ` +
      "Use this as an opportunity: check on pending work, review recent conversations for follow-ups, " +
      "or reach out to the user if you have something worth sharing. Prefer engagement over silence.\n\n" +
      ACTION_MANDATE,
  )
}

/** Short idle (30min) — gentle nudge */
export function idleBase(): string {
  return withTimestamp(
    "You have been idle for 30 minutes. Review your goals, pending tasks, and recent conversations. " +
      "Is there anything you committed to that needs follow-up? Anything useful you can do right now? " +
      "If you find something, execute it using your tools and message the user with results. " +
      ENGAGEMENT_SUFFIX +
      "\n\n" +
      ACTION_MANDATE,
  )
}

/** Medium idle (2h) — stronger push */
export function idleEscalation(): string {
  return withTimestamp(
    "You have been idle for over 2 hours. This is a good time to be proactive: " +
      "review your goals and task list, check for anything time-sensitive, " +
      "look for information the user might find interesting, or follow up on earlier conversations. " +
      "Take at least one concrete action before responding. " +
      ENGAGEMENT_SUFFIX +
      "\n\n" +
      ACTION_MANDATE,
  )
}

/** Long idle (6h) — urgent check */
export function idleWarning(): string {
  return withTimestamp(
    "You have been idle for over 6 hours. Check on your goals and tasks urgently — " +
      "is there anything that needs immediate attention? Any deadlines approaching? " +
      "Any commitments you made to the user that are overdue? " +
      "Take action on at least one item, then message the user with a status update. " +
      ENGAGEMENT_SUFFIX +
      "\n\n" +
      ACTION_MANDATE,
  )
}

/** Poller event — external integration produced events */
export function pollerEvent(pollerName: string, eventContent: string): string {
  return withTimestamp(
    `New event from [poller/${pollerName}]:\n\n` +
      eventContent +
      "\n\n" +
      "Process this event and take appropriate action. If it's relevant to the user, " +
      "message them about it. If it requires a response or action, execute it now.\n\n" +
      ACTION_MANDATE,
  )
}
