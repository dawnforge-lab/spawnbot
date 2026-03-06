import { TelegramListener } from "@/telegram/listener"
import { InputQueue } from "./queue"
import { Log } from "@/util/log"

const log = Log.create({ service: "input.response" })

/**
 * Route a response back to its originating source.
 * Called by the InputRouter after the handler produces output.
 */
export async function deliverResponse(
  event: InputQueue.InputEvent,
  response: string,
): Promise<void> {
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

    default:
      log.info("response for unrouted source", {
        source: event.source,
        length: response.length,
      })
  }
}
