import { Log } from "@/util/log"
import { InputRouter } from "@/input/router"
import { InputQueue } from "@/input/queue"
import { TelegramListener } from "@/telegram/listener"
import { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"
import { IdleLoop } from "@/autonomy/idle"
import { startDecay, stopDecay } from "@/autonomy/decay"
import { deliverResponse } from "@/input/response"
import { loadEnv, loadCrons, wirePollerState } from "./config"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "daemon" })

export namespace Daemon {
  let sessionID: string | undefined

  /**
   * Start all daemon subsystems:
   * 1. Load .env for credentials
   * 2. Create a daemon session for the agent
   * 3. Wire input router → session prompt
   * 4. Start Telegram listener
   * 5. Start autonomy modules (cron, idle, decay)
   * 6. Start input router loop
   */
  export async function start() {
    // Load agent-specific .env
    loadEnv()

    // Create a persistent session for daemon processing
    // Auto-approve all permissions (daemon runs autonomously)
    const session = await Session.create({
      title: "Daemon session",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    sessionID = session.id
    log.info("daemon session created", { sessionID })

    // Wire input router to process events through the session
    InputRouter.setHandler(async (event) => {
      const input = InputRouter.formatInput(event)
      IdleLoop.touch()

      const messageID = Identifier.ascending("message")
      const result = await SessionPrompt.prompt({
        sessionID: sessionID!,
        messageID,
        parts: [{ type: "text", text: input }],
      })

      // Extract text from the assistant response
      return extractResponseText(result)
    })

    InputRouter.onResponse(deliverResponse)

    // Start Telegram if configured
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN
    if (telegramToken) {
      const ownerId = process.env.TELEGRAM_OWNER_ID
        ? parseInt(process.env.TELEGRAM_OWNER_ID, 10)
        : undefined

      TelegramListener.start({
        token: telegramToken,
        ownerChatId: ownerId,
        allowedUsers: ownerId ? [ownerId] : [],
      })
      log.info("telegram started", { ownerChatId: ownerId })
    } else {
      log.warn("TELEGRAM_BOT_TOKEN not set, skipping Telegram")
    }

    // Wire poller state persistence
    wirePollerState()

    // Start cron jobs
    const crons = loadCrons()
    if (crons.length > 0) {
      CronScheduler.start(crons)
    }

    // Start autonomy
    IdleLoop.start()
    startDecay()

    // Start the input router loop in background (it blocks until stopped)
    InputRouter.start().catch((err) => {
      log.error("input router crashed", { error: err })
    })

    log.info("daemon started")
  }

  /** Stop all daemon subsystems */
  export async function stop() {
    log.info("daemon stopping")

    InputRouter.stop()
    CronScheduler.stop()
    PollerManager.stop()
    IdleLoop.stop()
    stopDecay()
    await TelegramListener.stop()

    log.info("daemon stopped")
  }

  /** Get the current daemon session ID */
  export function getSessionID() {
    return sessionID
  }
}

/** Extract text content from a SessionPrompt result */
function extractResponseText(result: MessageV2.WithParts): string | undefined {
  const textParts = result.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .map((p) => p.text)
    .filter(Boolean)

  return textParts.length > 0 ? textParts.join("\n") : undefined
}
