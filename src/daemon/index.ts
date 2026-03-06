import { Log } from "@/util/log"
import { InputRouter } from "@/input/router"
import { InputQueue } from "@/input/queue"
import { TelegramListener } from "@/telegram/listener"
import { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"
import { IdleLoop } from "@/autonomy/idle"
import { startDecay, stopDecay } from "@/autonomy/decay"
import { Tunnel } from "@/tunnel"
import { deliverResponse } from "@/input/response"
import { loadEnv, loadCrons, wirePollerState, saveSessionID, loadSessionID, clearSessionID } from "./config"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "daemon" })

export namespace Daemon {
  let sessionID: string | undefined

  export interface StartOptions {
    /** Local server port (needed for ngrok forwarding) */
    serverPort: number
  }

  /**
   * Start all daemon subsystems:
   * 1. Load .env for credentials
   * 2. Start ngrok tunnel if configured
   * 3. Create a daemon session for the agent
   * 4. Wire input router → session prompt
   * 5. Start Telegram (webhook or polling)
   * 6. Start autonomy modules (cron, idle, decay)
   * 7. Start input router loop
   */
  export async function start(opts: StartOptions) {
    // Load agent-specific .env
    loadEnv()

    // Start ngrok tunnel if authtoken is available
    let webhookUrl: string | undefined
    const ngrokToken = process.env.NGROK_AUTHTOKEN
    const ngrokDomain = process.env.NGROK_DOMAIN

    if (ngrokToken) {
      webhookUrl = await Tunnel.start({
        authtoken: ngrokToken,
        port: opts.serverPort,
        domain: ngrokDomain,
      })
      log.info("ngrok tunnel established", { url: webhookUrl })
    }

    // Resume existing daemon session or create a new one
    const autoApprove: Session.Info["permission"] = [{ permission: "*", pattern: "*", action: "allow" }]
    const previousID = loadSessionID()

    if (previousID) {
      const existing = await Session.get(previousID).catch(() => undefined)
      if (existing) {
        sessionID = existing.id
        // Ensure permissions are set for resumed session
        await Session.setPermission({ sessionID: existing.id, permission: autoApprove })
        log.info("resumed daemon session", { sessionID })
      }
    }

    if (!sessionID) {
      const session = await Session.create({
        title: "Daemon session",
        permission: autoApprove,
      })
      sessionID = session.id
      saveSessionID(session.id)
      log.info("created new daemon session", { sessionID })
    }

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
        webhookUrl,
      })
      log.info("telegram started", {
        mode: TelegramListener.getMode(),
        ownerChatId: ownerId,
      })
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

    log.info("daemon started", {
      telegram: !!telegramToken,
      ngrok: !!webhookUrl,
      crons: crons.length,
    })
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
    await Tunnel.stop()

    log.info("daemon stopped")
  }

  /** Get the current daemon session ID */
  export function getSessionID() {
    return sessionID
  }

  /** Reset the daemon session — next start will create a fresh one */
  export function resetSession() {
    clearSessionID()
    sessionID = undefined
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
