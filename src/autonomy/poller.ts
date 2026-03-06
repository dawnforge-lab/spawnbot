import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "autonomy.poller" })

export namespace PollerManager {
  /** Contract for a poller module */
  export interface Poller {
    name: string
    defaultInterval: number // seconds
    poll(lastState: Record<string, any>): Promise<PollResult>
  }

  export interface PollResult {
    events: PollEvent[]
    newState: Record<string, any>
  }

  export interface PollEvent {
    content: string
    priority?: InputQueue.Priority
    sender?: string
    metadata?: Record<string, any>
  }

  interface RunningPoller {
    poller: Poller
    interval: number
    timer: ReturnType<typeof setInterval>
    state: Record<string, any>
  }

  const pollers: Map<string, RunningPoller> = new Map()

  // State persistence callbacks
  let loadState: (name: string) => Promise<Record<string, any>>
  let saveState: (name: string, state: Record<string, any>) => Promise<void>

  /** Set state persistence functions (typically backed by SQLite) */
  export function setStatePersistence(
    load: typeof loadState,
    save: typeof saveState,
  ) {
    loadState = load
    saveState = save
  }

  /** Register and start a poller */
  export async function register(poller: Poller, intervalOverride?: number) {
    if (pollers.has(poller.name)) {
      await unregister(poller.name)
    }

    const interval = intervalOverride ?? poller.defaultInterval
    const state = loadState ? await loadState(poller.name) : {}

    const timer = setInterval(async () => {
      await runPoller(poller.name)
    }, interval * 1000)

    pollers.set(poller.name, { poller, interval, timer, state })

    log.info("poller registered", { name: poller.name, interval })

    // Run immediately on register
    await runPoller(poller.name)
  }

  /** Unregister and stop a poller */
  export async function unregister(name: string) {
    const running = pollers.get(name)
    if (running) {
      clearInterval(running.timer)
      pollers.delete(name)
      log.info("poller unregistered", { name })
    }
  }

  /** Stop all pollers */
  export function stop() {
    for (const [name, running] of pollers) {
      clearInterval(running.timer)
    }
    pollers.clear()
    log.info("all pollers stopped")
  }

  /** List running pollers */
  export function list(): { name: string; interval: number }[] {
    return [...pollers.entries()].map(([name, p]) => ({
      name,
      interval: p.interval,
    }))
  }

  async function runPoller(name: string) {
    const running = pollers.get(name)
    if (!running) return

    try {
      const result = await running.poller.poll(running.state)

      // Enqueue events
      for (const event of result.events) {
        InputQueue.enqueue({
          id: ulid(),
          source: `poller/${name}`,
          sender: event.sender,
          content: event.content,
          priority: event.priority ?? "normal",
          metadata: event.metadata,
          timestamp: Date.now(),
        })
      }

      // Update state
      running.state = result.newState
      if (saveState) {
        await saveState(name, result.newState)
      }

      if (result.events.length > 0) {
        log.info("poller produced events", {
          name,
          count: result.events.length,
        })
      }
    } catch (err) {
      log.error("poller failed", { name, error: err })
    }
  }
}
