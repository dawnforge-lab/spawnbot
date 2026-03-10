import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import * as prompts from "./prompts"
import { hasHeartbeatTasks } from "./heartbeat"

const log = Log.create({ service: "autonomy.idle" })

export namespace IdleLoop {
  export interface Config {
    /** Base idle interval in ms (default: 30 min) */
    baseInterval?: number
    /** Escalation threshold in ms (default: 2h) */
    escalationThreshold?: number
    /** Warning threshold in ms (default: 6h) */
    warningThreshold?: number
    /** How often to check in ms (default: 1 min) */
    checkInterval?: number
  }

  let timer: ReturnType<typeof setInterval> | undefined
  let lastActivity = Date.now()
  let cfg: Required<Config>

  /** Call this whenever there's user/channel activity */
  export function touch() {
    lastActivity = Date.now()
  }

  export function start(opts?: Config) {
    if (timer) return
    lastActivity = Date.now()

    cfg = {
      baseInterval: opts?.baseInterval ?? 30 * 60 * 1000,
      escalationThreshold: opts?.escalationThreshold ?? 2 * 60 * 60 * 1000,
      warningThreshold: opts?.warningThreshold ?? 6 * 60 * 60 * 1000,
      checkInterval: opts?.checkInterval ?? 60 * 1000,
    }

    timer = setInterval(() => {
      const idle = Date.now() - lastActivity

      if (idle >= cfg.warningThreshold) {
        enqueueIdleEvent(prompts.idleWarning(), "normal")
        // Reset so we don't spam — next check after another base interval
        lastActivity = Date.now() - cfg.escalationThreshold
      } else if (idle >= cfg.escalationThreshold) {
        enqueueIdleEvent(prompts.idleEscalation(), "low")
      } else if (idle >= cfg.baseInterval) {
        // Heartbeat: check HEARTBEAT.md task board. Skip LLM call if no pending tasks.
        if (hasHeartbeatTasks()) {
          enqueueIdleEvent(prompts.heartbeat(), "low")
        } else {
          log.debug("heartbeat skipped — no pending tasks in HEARTBEAT.md")
        }
      }
    }, cfg.checkInterval)

    log.info("idle loop started", {
      baseInterval: cfg.baseInterval / 1000 + "s",
      escalation: cfg.escalationThreshold / 1000 + "s",
      warning: cfg.warningThreshold / 1000 + "s",
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
