import { Log } from "@/util/log"

const log = Log.create({ service: "input.queue" })

export namespace InputQueue {
  export type Priority = "critical" | "high" | "normal" | "low"

  const PRIORITY_ORDER: Priority[] = ["critical", "high", "normal", "low"]

  export interface InputEvent {
    id: string
    source: string // e.g. "telegram", "cron/daily-summary", "autonomy", "cli"
    sender?: string // e.g. user name
    content: string
    priority: Priority
    metadata?: Record<string, any>
    timestamp: number
  }

  const MAX_SIZE: Record<Priority, number> = {
    critical: 10,
    high: 50,
    normal: 100,
    low: 200,
  }

  const buckets: Record<Priority, InputEvent[]> = {
    critical: [],
    high: [],
    normal: [],
    low: [],
  }

  // Waiters blocked on dequeue
  let waiter: ((event: InputEvent) => void) | undefined

  /** Enqueue an event. Returns false if the bucket is full. */
  export function enqueue(event: InputEvent): boolean {
    const bucket = buckets[event.priority]
    if (bucket.length >= MAX_SIZE[event.priority]) {
      log.warn("queue full, dropping event", {
        priority: event.priority,
        source: event.source,
        size: bucket.length,
      })
      return false
    }

    bucket.push(event)
    log.info("enqueued", {
      id: event.id,
      priority: event.priority,
      source: event.source,
      queueSize: size(),
    })

    // Wake up any waiting dequeue
    if (waiter) {
      const resolve = waiter
      waiter = undefined
      const next = dequeueSync()
      if (next) resolve(next)
    }

    return true
  }

  /** Dequeue the highest priority event. Returns undefined if empty. */
  function dequeueSync(): InputEvent | undefined {
    for (const priority of PRIORITY_ORDER) {
      const bucket = buckets[priority]
      if (bucket.length > 0) {
        return bucket.shift()!
      }
    }
    return undefined
  }

  /** Blocking dequeue — waits until an event is available. */
  export function dequeue(signal?: AbortSignal): Promise<InputEvent> {
    const next = dequeueSync()
    if (next) return Promise.resolve(next)

    return new Promise<InputEvent>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }

      waiter = resolve

      signal?.addEventListener("abort", () => {
        if (waiter === resolve) {
          waiter = undefined
          reject(signal.reason)
        }
      }, { once: true })
    })
  }

  /** Total events across all priority levels. */
  export function size(): number {
    return PRIORITY_ORDER.reduce((sum, p) => sum + buckets[p].length, 0)
  }

  /** Sizes per priority level. */
  export function sizes(): Record<Priority, number> {
    return {
      critical: buckets.critical.length,
      high: buckets.high.length,
      normal: buckets.normal.length,
      low: buckets.low.length,
    }
  }

  /** Clear all events. */
  export function clear() {
    for (const priority of PRIORITY_ORDER) {
      buckets[priority].length = 0
    }
  }
}
