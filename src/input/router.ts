import { InputQueue } from "./queue"
import { Log } from "@/util/log"

const log = Log.create({ service: "input.router" })

export namespace InputRouter {
  export type Handler = (event: InputQueue.InputEvent) => Promise<string | undefined>
  export type ResponseCallback = (event: InputQueue.InputEvent, response: string) => Promise<void>

  let handler: Handler | undefined
  let responseCallback: ResponseCallback | undefined
  let running = false
  let abortController: AbortController | undefined

  /** Set the handler that processes input events (typically calls session.prompt()) */
  export function setHandler(fn: Handler) {
    handler = fn
  }

  /** Set the callback for routing responses back to the source */
  export function onResponse(fn: ResponseCallback) {
    responseCallback = fn
  }

  /** Format an event with source attribution */
  export function formatInput(event: InputQueue.InputEvent): string {
    const parts: string[] = []

    if (event.source === "telegram" && event.sender) {
      parts.push(`[telegram from ${event.sender}]`)
    } else if (event.source.startsWith("cron/")) {
      parts.push(`[${event.source}]`)
    } else if (event.source === "autonomy") {
      parts.push("[autonomy]")
    } else if (event.source !== "cli") {
      parts.push(`[${event.source}]`)
    }

    parts.push(event.content)
    return parts.join(" ")
  }

  /** Start the dequeue loop. Processes one event at a time. */
  export async function start() {
    if (running) return
    running = true
    abortController = new AbortController()

    log.info("input router started")

    while (running) {
      try {
        const event = await InputQueue.dequeue(abortController.signal)
        log.info("processing event", {
          id: event.id,
          source: event.source,
          priority: event.priority,
        })

        if (!handler) {
          log.warn("no handler set, dropping event", { id: event.id })
          continue
        }

        const input = formatInput(event)
        const response = await handler(event)

        if (response && responseCallback) {
          await responseCallback(event, response).catch((err) => {
            log.error("response delivery failed", {
              id: event.id,
              source: event.source,
              error: err,
            })
          })
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || !running) break
        log.error("event processing error", { error: err })
      }
    }

    log.info("input router stopped")
  }

  /** Stop the dequeue loop. */
  export function stop() {
    running = false
    abortController?.abort()
    abortController = undefined
  }

  export function isRunning() {
    return running
  }
}
