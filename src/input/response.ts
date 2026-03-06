import { TelegramListener } from "@/telegram/listener"
import { InputQueue } from "./queue"
import { Log } from "@/util/log"
import { isAutonomousSource, shouldDropResponse, stripHeartbeatToken } from "@/autonomy/filter"

const log = Log.create({ service: "input.response" })

/**
 * Route a response back to its originating source.
 * Called by the InputRouter after the handler produces output.
 *
 * For autonomous sources (cron, idle, poller), applies the HEARTBEAT_OK
 * filter — short acknowledgments are dropped silently.
 */
export async function deliverResponse(
  event: InputQueue.InputEvent,
  response: string,
): Promise<void> {
  // Filter autonomous responses — drop silent acknowledgments
  if (isAutonomousSource(event.source)) {
    if (shouldDropResponse(response, event.source)) return
    // Strip the HEARTBEAT_OK token but keep the rest
    response = stripHeartbeatToken(response)
    if (!response) return
  }

  switch (event.source) {
    case "telegram": {
      const chatId = event.metadata?.chatId as number | undefined
      await TelegramListener.send(chatId, response)
      log.info("response delivered to telegram", {
        chatId,
        length: response.length,
      })
      break
    }

    case "cli":
      // CLI responses are handled directly by the session/TUI
      break

    default: {
      // Autonomous sources (cron, poller, autonomy) deliver to Telegram owner
      if (isAutonomousSource(event.source)) {
        await TelegramListener.send(undefined, response)
        log.info("autonomous response delivered to telegram", {
          source: event.source,
          length: response.length,
        })
      } else {
        log.info("response for unrouted source", {
          source: event.source,
          length: response.length,
        })
      }
    }
  }
}
