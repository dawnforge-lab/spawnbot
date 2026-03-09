import path from "path"
import { Log } from "@/util/log"
import { TelegramListener } from "@/telegram/listener"
import { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"
import { IdleLoop } from "@/autonomy/idle"
import { startDecay, stopDecay } from "@/autonomy/decay"
import { isAutonomousSource, shouldDropResponse, stripHeartbeatToken } from "@/autonomy/filter"
import { InputQueue } from "@/input/queue"
import { Tunnel } from "@/tunnel"
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

  /**
   * Serialization lock for LLM calls. Only one prompt runs at a time.
   * User messages get priority — autonomy events yield when a user message is waiting.
   */
  let lock = Promise.resolve()
  let userWaiting = false

  /**
   * Process a user message through the LLM session (priority).
   * Sets userWaiting flag so autonomy events yield.
   */
  export function processUserMessage(
    input: string,
    opts?: { file?: { path: string; mime: string; name?: string } },
  ): Promise<string | undefined> {
    userWaiting = true
    const result = lock.then(async () => {
      userWaiting = false
      return runPrompt(input, opts)
    })
    lock = result.then(() => {}, () => {})
    return result
  }

  /**
   * Process an autonomy message through the LLM session (lower priority).
   * Returns undefined if a user message is waiting (caller should re-enqueue).
   */
  export function processAutonomyMessage(
    input: string,
    opts?: { system?: string },
  ): Promise<string | undefined> {
    if (userWaiting) return Promise.resolve(undefined)
    const result = lock.then(async () => {
      return runPrompt(input, opts)
    })
    lock = result.then(() => {}, () => {})
    return result
  }

  /** Shared LLM call logic */
  async function runPrompt(
    input: string,
    opts?: {
      system?: string
      file?: { path: string; mime: string; name?: string }
    },
  ): Promise<string | undefined> {
    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; mime: string; url: string; filename?: string }
    > = [{ type: "text", text: input }]

    if (opts?.file) {
      parts.push({
        type: "file",
        mime: opts.file.mime,
        url: `file://${opts.file.path}`,
        filename: opts.file.name ?? path.basename(opts.file.path),
      })
    }

    const messageID = Identifier.ascending("message")
    const llmResult = await SessionPrompt.prompt({
      sessionID: sessionID!,
      messageID,
      system: opts?.system,
      parts,
    })

    return extractResponseText(llmResult)
  }

  /**
   * Start all daemon subsystems.
   * @param serverPort — the Hono server port (used for webhook/ngrok tunnel)
   */
  export async function start(serverPort?: number) {
    loadEnv()
    await validate()

    // Resume or create daemon session
    const autoApprove: Session.Info["permission"] = [{ permission: "*", pattern: "*", action: "allow" }]
    const previousID = loadSessionID()

    if (previousID) {
      const existing = await Session.get(previousID).catch(() => undefined)
      if (existing) {
        sessionID = existing.id
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

    // Wire Telegram message handler — grammY calls this directly, user gets priority
    TelegramListener.onMessage(async (event) => {
      IdleLoop.touch()

      const input = `[telegram from ${event.sender}] ${event.content}`
      return processUserMessage(input, {
        file: event.file,
      })
    })

    // Start Telegram
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN
    if (telegramToken) {
      const ownerId = process.env.TELEGRAM_OWNER_ID
        ? parseInt(process.env.TELEGRAM_OWNER_ID, 10)
        : undefined
      const ngrokToken = process.env.NGROK_AUTHTOKEN

      const telegramConfig: TelegramListener.Config = {
        token: telegramToken,
        ownerChatId: ownerId,
        allowedUsers: ownerId ? [ownerId] : [],
      }

      if (ngrokToken) {
        if (!serverPort) throw new Error("serverPort required for webhook mode (ngrok tunnels to Hono server)")
        // Webhook mode: Telegram → ngrok → Hono /telegram route → grammY
        await TelegramListener.start({ ...telegramConfig, deferStart: true })
        const publicUrl = await Tunnel.start({
          authtoken: ngrokToken,
          port: serverPort,
          domain: process.env.NGROK_DOMAIN,
        })
        await TelegramListener.switchToWebhook(publicUrl)
        log.info("telegram started", { mode: "webhook", ownerChatId: ownerId, url: publicUrl })
      } else {
        // Polling mode
        await TelegramListener.start(telegramConfig)
        log.info("telegram started", { mode: "polling", ownerChatId: ownerId })
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

    // Flush compaction summaries to long-term memory + rotate session
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

    // Start autonomy — cron/idle/poller events go through processMessage
    IdleLoop.start({
      baseInterval: process.env.IDLE_BASE_INTERVAL ? parseInt(process.env.IDLE_BASE_INTERVAL) : undefined,
      escalationThreshold: process.env.IDLE_ESCALATION ? parseInt(process.env.IDLE_ESCALATION) : undefined,
      warningThreshold: process.env.IDLE_WARNING ? parseInt(process.env.IDLE_WARNING) : undefined,
    })
    startDecay()

    // Drain autonomy events from InputQueue (cron, idle, poller still enqueue there)
    startAutonomyConsumer()

    log.info("daemon started", {
      telegram: !!telegramToken,
      crons: crons.length,
    })
  }

  let autonomyRunning = false

  /** Consume events from InputQueue (used by cron/idle/poller). */
  async function startAutonomyConsumer() {
    autonomyRunning = true

    while (autonomyRunning) {
      try {
        const event = await InputQueue.dequeue()
        if (!autonomyRunning) break

        // Yield to user messages — re-enqueue and wait
        if (userWaiting) {
          InputQueue.enqueue(event)
          log.info("autonomy event deferred for user message", { id: event.id, source: event.source })
          await new Promise((r) => setTimeout(r, 500))
          continue
        }

        log.info("processing autonomy event", { id: event.id, source: event.source })

        // Load autonomous-behavior skill for system prompt
        let system: string | undefined
        if (isAutonomousSource(event.source)) {
          const skill = await Skill.get("autonomous-behavior").catch(() => undefined)
          if (skill) system = skill.content
        }

        const response = await processAutonomyMessage(event.content, { system })

        // Deliver response to Telegram owner (filter heartbeat/ack responses)
        if (response && isAutonomousSource(event.source)) {
          if (!shouldDropResponse(response, event.source)) {
            const cleaned = stripHeartbeatToken(response)
            if (cleaned) {
              await TelegramListener.send(undefined, cleaned)
              log.info("autonomy response delivered", { source: event.source, length: cleaned.length })
            }
          }
        }
      } catch (err: any) {
        if (!autonomyRunning) break
        log.error("autonomy consumer error", { error: err })
      }
    }
  }

  /** Stop all daemon subsystems */
  export async function stop() {
    log.info("daemon stopping")

    autonomyRunning = false
    CronScheduler.stop()
    PollerManager.stop()
    IdleLoop.stop()
    stopDecay()
    await TelegramListener.stop()
    await Tunnel.stop()

    log.info("daemon stopped")
  }

  export function getSessionID() { return sessionID }

  export function resetSession() {
    clearSessionID()
    sessionID = undefined
  }

  /** Validate critical configuration */
  async function validate() {
    loadSoul({ required: true })

    const envKeys = Object.keys(process.env).filter((k) => k.endsWith("_API_KEY"))
    if (envKeys.length > 0) {
      log.info("pre-flight validation passed", { providers: envKeys.length, source: "env" })
      return
    }

    const { Auth } = await import("@/auth")
    const authEntries = await Auth.all()
    if (Object.keys(authEntries).length > 0) {
      log.info("pre-flight validation passed", { providers: Object.keys(authEntries).length, source: "auth.json" })
      return
    }

    throw new Error("No LLM provider configured. Use /connect in the TUI or add an API key to .env")
  }

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
