import { Memory } from "@/memory"
import { Log } from "@/util/log"

const log = Log.create({ service: "autonomy.decay" })

let timer: ReturnType<typeof setInterval> | undefined

const DECAY_INTERVAL = 60 * 60 * 1000 // 1 hour

/** Start periodic memory importance decay */
export function startDecay(intervalMs: number = DECAY_INTERVAL) {
  if (timer) return

  timer = setInterval(() => {
    const deleted = Memory.decay()
    if (deleted > 0) {
      log.info("memory decay pass", { deleted })
    }
  }, intervalMs)

  log.info("memory decay started", { intervalMs })
}

/** Stop periodic decay */
export function stopDecay() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
    log.info("memory decay stopped")
  }
}
