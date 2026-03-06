import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "autonomy.idle" })

export namespace IdleLoop {
  let timer: ReturnType<typeof setInterval> | undefined
  let lastActivity = Date.now()

  // Escalation thresholds (in ms)
  const BASE_INTERVAL = 30 * 60 * 1000 // 30 min
  const ESCALATION_THRESHOLD = 2 * 60 * 60 * 1000 // 2h → check every 15 min
  const WARNING_THRESHOLD = 6 * 60 * 60 * 1000 // 6h → warning check

  const CHECK_INTERVAL = 60 * 1000 // check every minute if we should fire

  /** Call this whenever there's user/channel activity */
  export function touch() {
    lastActivity = Date.now()
  }

  export function start() {
    if (timer) return
    lastActivity = Date.now()

    timer = setInterval(() => {
      const idle = Date.now() - lastActivity

      if (idle >= WARNING_THRESHOLD) {
        enqueueIdleEvent(
          "You have been idle for over 6 hours. Check on your goals and tasks. Is there anything that needs attention?",
          "normal",
        )
        // Reset so we don't spam — next check after another base interval
        lastActivity = Date.now() - ESCALATION_THRESHOLD
      } else if (idle >= ESCALATION_THRESHOLD) {
        enqueueIdleEvent(
          "You have been idle for a while. Review your current goals and see if there's anything you should work on.",
          "low",
        )
      } else if (idle >= BASE_INTERVAL) {
        enqueueIdleEvent(
          "Periodic check-in. Review your goals and recent activity. Is there anything you should be doing?",
          "low",
        )
      }
    }, CHECK_INTERVAL)

    log.info("idle loop started", {
      baseInterval: BASE_INTERVAL / 1000 + "s",
      escalation: ESCALATION_THRESHOLD / 1000 + "s",
      warning: WARNING_THRESHOLD / 1000 + "s",
    })
  }

  export function stop() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
      log.info("idle loop stopped")
    }
  }

  export function getIdleTime(): number {
    return Date.now() - lastActivity
  }

  export function isRunning(): boolean {
    return timer !== undefined
  }

  function enqueueIdleEvent(prompt: string, priority: InputQueue.Priority) {
    InputQueue.enqueue({
      id: ulid(),
      source: "autonomy",
      content: prompt,
      priority,
      timestamp: Date.now(),
    })
    log.info("idle event enqueued", { priority, idleMs: Date.now() - lastActivity })
  }
}
