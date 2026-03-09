import path from "path"
import { Log } from "@/util/log"
import { InputRouter } from "@/input/router"
import { InputQueue } from "@/input/queue"
import { TelegramListener } from "@/telegram/listener"
import { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"
import { IdleLoop } from "@/autonomy/idle"
import { startDecay, stopDecay } from "@/autonomy/decay"
import { isAutonomousSource } from "@/autonomy/filter"
import { Tunnel } from "@/tunnel"
import { deliverResponse } from "@/input/response"
import { flushFromCompaction } from "@/memory/flush"
import { SessionCompaction } from "@/session/compaction"
import { Bus } from "@/bus"
import { loadEnv, loadCrons, loadPollers, wirePollerState, saveSessionID, loadSessionID, clearSessionID } from "./config"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Skill } from "@/skill/skill"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"
import { loadSoul } from "@/soul"

const log = Log.create({ service: "daemon" })

export namespace Daemon {
  let sessionID: string | undefined
  let compactionCount = 0
  const COMPACTIONS_BEFORE_ROTATION = 5

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

    // Pre-flight validation
    await validate()

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
      const currentSessionID = sessionID!
      const input = InputRouter.formatInput(event)
      IdleLoop.touch()

      // For autonomous events, inject the autonomous-behavior skill into context
      let system: string | undefined
      if (isAutonomousSource(event.source)) {
        const skill = await Skill.get("autonomous-behavior").catch(() => undefined)
        if (skill) system = skill.content
      }

      // Build parts: text + optional file attachment for multimodal analysis
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }> = [
        { type: "text", text: input },
      ]

      // If the event has a downloaded file (photo, document, etc.), attach it
      const filePath = event.metadata?.filePath as string | undefined
      const mime = event.metadata?.mime as string | undefined
      if (filePath && mime) {
        parts.push({
          type: "file",
          mime,
          url: `file://${filePath}`,
          filename: (event.metadata?.fileName as string) ?? path.basename(filePath),
        })
      }

      const messageID = Identifier.ascending("message")
      const result = await SessionPrompt.prompt({
        sessionID: currentSessionID,
        messageID,
        system,
        parts,
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

      try {
        await TelegramListener.start({
          token: telegramToken,
          ownerChatId: ownerId,
          allowedUsers: ownerId ? [ownerId] : [],
          webhookUrl,
        })
        log.info("telegram started", {
          mode: TelegramListener.getMode(),
          ownerChatId: ownerId,
        })
      } catch (err) {
        log.error("telegram failed to start (continuing without it)", { error: err })
        console.error("Warning: Telegram failed to start —", err instanceof Error ? err.message : String(err))
      }
    } else {
      log.warn("TELEGRAM_BOT_TOKEN not set, skipping Telegram")
    }

    // Wire poller state persistence and load configured pollers
    wirePollerState()
    await loadPollers()

    // Start cron jobs
    const crons = loadCrons()
    if (crons.length > 0) {
      CronScheduler.start(crons)
    }

    // Flush compaction summaries to long-term memory + rotate session after N compactions
    Bus.subscribe(SessionCompaction.Event.Compacted, async (event) => {
      await flushFromCompaction(event.properties.sessionID).catch((err) => {
        log.error("memory flush failed", { error: err })
      })

      compactionCount++
      log.info("compaction occurred", { compactionCount, threshold: COMPACTIONS_BEFORE_ROTATION })

      if (compactionCount >= COMPACTIONS_BEFORE_ROTATION) {
        await rotateSession()
      }
    })

    // Start autonomy
    IdleLoop.start({
      baseInterval: process.env.IDLE_BASE_INTERVAL ? parseInt(process.env.IDLE_BASE_INTERVAL) : undefined,
      escalationThreshold: process.env.IDLE_ESCALATION ? parseInt(process.env.IDLE_ESCALATION) : undefined,
      warningThreshold: process.env.IDLE_WARNING ? parseInt(process.env.IDLE_WARNING) : undefined,
    })
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

  /** Validate critical configuration before starting subsystems */
  async function validate() {
    // SOUL.md is required in daemon mode
    loadSoul({ required: true })

    // At least one LLM provider must be configured (check both .env and auth.json)
    const envKeys = Object.keys(process.env).filter((k) => k.endsWith("_API_KEY"))
    if (envKeys.length > 0) {
      log.info("pre-flight validation passed", { providers: envKeys.length, source: "env" })
      return
    }

    // Check auth.json (credentials stored by /connect in TUI)
    const { Auth } = await import("@/auth")
    const authEntries = await Auth.all()
    if (Object.keys(authEntries).length > 0) {
      log.info("pre-flight validation passed", { providers: Object.keys(authEntries).length, source: "auth.json" })
      return
    }

    throw new Error(
      "No LLM provider configured. Use /connect in the TUI or add an API key to .env",
    )
  }

  /** Rotate to a fresh session after too many compactions */
  async function rotateSession() {
    const oldID = sessionID
    const autoApprove: Session.Info["permission"] = [{ permission: "*", pattern: "*", action: "allow" }]

    const session = await Session.create({
      title: "Daemon session",
      permission: autoApprove,
    })

    sessionID = session.id
    compactionCount = 0
    saveSessionID(session.id)
    log.info("session rotated", { oldSessionID: oldID, newSessionID: session.id })
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
