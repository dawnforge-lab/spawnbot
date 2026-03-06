import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import * as prompts from "./prompts"

const log = Log.create({ service: "autonomy.idle" })

export namespace IdleLoop {
  let timer: ReturnType<typeof setInterval> | undefined
  let lastActivity = Date.now()

  // Escalation thresholds (in ms)
  const BASE_INTERVAL = 30 * 60 * 1000 // 30 min
  const ESCALATION_THRESHOLD = 2 * 60 * 60 * 1000 // 2h
  const WARNING_THRESHOLD = 6 * 60 * 60 * 1000 // 6h

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
        enqueueIdleEvent(prompts.idleWarning(), "normal")
        // Reset so we don't spam — next check after another base interval
        lastActivity = Date.now() - ESCALATION_THRESHOLD
      } else if (idle >= ESCALATION_THRESHOLD) {
        enqueueIdleEvent(prompts.idleEscalation(), "low")
      } else if (idle >= BASE_INTERVAL) {
        enqueueIdleEvent(prompts.idleBase(), "low")
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
