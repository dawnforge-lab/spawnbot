import { Bot, type Context } from "grammy"
import { Log } from "@/util/log"
import fs from "fs"
import path from "path"
import { Global } from "@/global"
import { Transcribe } from "./transcribe"

const log = Log.create({ service: "telegram.listener" })

/** Max age for inbox files before cleanup (1 hour) */
const INBOX_TTL_MS = 60 * 60 * 1000
/** How often to run inbox cleanup (10 minutes) */
const INBOX_CLEANUP_INTERVAL_MS = 10 * 60 * 1000

export namespace TelegramListener {
  let bot: Bot | undefined
  let allowedUsers: Set<number> = new Set()
  let ownerChatId: number | undefined
  let mode: "polling" | "webhook" = "polling"
  let cleanupTimer: ReturnType<typeof setInterval> | undefined

  /**
   * Message handler set by the daemon. grammY handlers call this directly.
   * Returns the text response to send back to the user.
   */
  let messageHandler: MessageHandler | undefined

  export interface MessageEvent {
    sender: string
    content: string
    chatId: number
    messageId: number
    /** Optional file attachment (photo, document, etc.) */
    file?: { path: string; mime: string; name?: string }
  }

  export type MessageHandler = (event: MessageEvent) => Promise<string | undefined>

  export interface Config {
    token: string
    allowedUsers?: number[]
    ownerChatId?: number
    /**
     * Defer starting (no polling, no webhook).
     * Call switchToWebhook() after ngrok tunnel is ready.
     */
    deferStart?: boolean
  }

  /** Set the handler that processes incoming messages and returns a response. */
  export function onMessage(handler: MessageHandler) {
    messageHandler = handler
  }

  export async function start(config: Config) {
    if (bot) {
      log.warn("telegram listener already running")
      return
    }

    bot = new Bot(config.token)
    allowedUsers = new Set(config.allowedUsers ?? [])
    ownerChatId = config.ownerChatId

    registerHandlers()
    startInboxCleanup()

    bot.catch((err) => {
      log.error("telegram bot error", { error: err })
    })

    if (config.deferStart) {
      log.info("telegram bot created (deferred start)", { allowedUsers: [...allowedUsers] })
      return
    }

    mode = "polling"
    await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((err) => {
      log.warn("failed to clear stale webhook before polling", { error: err })
    })
    bot.start({
      onStart: () => {
        log.info("telegram long polling started", { allowedUsers: [...allowedUsers] })
      },
    })
  }

  /** Register webhook URL with Telegram and switch to webhook mode. */
  export async function switchToWebhook(publicUrl: string) {
    if (!bot) throw new Error("bot not initialized")

    // bot.init() is required for handleUpdate() — polling mode calls it implicitly via bot.start()
    await bot.init()

    const secret = bot.token.split(":")[1]
    const fullUrl = `${publicUrl}/telegram`
    await bot.api.setWebhook(fullUrl, { secret_token: secret })
    mode = "webhook"

    log.info("webhook mode activated", { url: fullUrl })
  }

  // ── Message handlers ──────────────────────────────────────────────

  /**
   * Process a message through the handler and send the response back.
   * Fire-and-forget: returns immediately so the webhook can respond 200.
   * Typing indicators + LLM processing + response delivery happen async.
   */
  function handleMessage(_ctx: Context, event: MessageEvent) {
    if (!messageHandler) {
      log.warn("no message handler set, ignoring message")
      return
    }

    // Fire-and-forget — don't block the webhook response
    void (async () => {
      // Show typing indicator, repeat every 4s (Telegram clears after ~5s)
      const sendTyping = () => {
        bot?.api.sendChatAction(event.chatId, "typing").catch((err) => {
          log.warn("typing indicator failed", { chatId: event.chatId, error: err?.message ?? err })
        })
      }
      sendTyping()
      const typingInterval = setInterval(sendTyping, 4000)

      try {
        const response = await messageHandler(event)

        if (response) {
          await send(event.chatId, response)
          log.info("response delivered", {
            chatId: event.chatId,
            length: response.length,
          })
        }
      } catch (err) {
        log.error("message processing failed", { error: err })
        const errMsg = err instanceof Error ? err.message : String(err)
        await send(event.chatId, `Error: ${errMsg}`).catch(() => {})
      } finally {
        clearInterval(typingInterval)
      }
    })()
  }

  function registerHandlers() {
    if (!bot) return

    bot.on("message:text", async (ctx) => {
      if (!isAllowed(ctx)) {
        log.warn("unauthorized message", { userId: ctx.from?.id, username: ctx.from?.username })
        return
      }

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content: ctx.message.text,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
      })
    })

    bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx)) return

      const photos = ctx.message.photo
      const largest = photos[photos.length - 1]
      // Start typing before download so user sees feedback immediately
      void bot?.api.sendChatAction(ctx.chat.id, "typing").catch(() => {})
      const filePath = await downloadFile(largest.file_id, `photo_${largest.file_id}.jpg`)
      const caption = ctx.message.caption ?? ""

      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[Photo attached]`
        : caption || "[photo received but download failed]"

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        file: filePath ? { path: filePath, mime: "image/jpeg" } : undefined,
      })
    })

    bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx)) return

      const doc = ctx.message.document
      const filename = doc.file_name ?? "document"
      void bot?.api.sendChatAction(ctx.chat.id, "typing").catch(() => {})
      const filePath = await downloadFile(doc.file_id, filename)
      const caption = ctx.message.caption ?? ""

      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[File "${filename}" attached]`
        : `${caption ? caption + "\n\n" : ""}[Document "${filename}" received but download failed]`

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        file: filePath ? { path: filePath, mime: doc.mime_type ?? "application/octet-stream", name: filename } : undefined,
      })
    })

    bot.on("message:voice", async (ctx) => {
      if (!isAllowed(ctx)) return

      const voice = ctx.message.voice
      void bot?.api.sendChatAction(ctx.chat.id, "typing").catch(() => {})
      const filePath = await downloadFile(voice.file_id, `voice_${voice.file_id}.ogg`)

      let transcript: string | undefined
      if (filePath) {
        transcript = await Transcribe.audio(filePath)
      }

      let content: string
      if (transcript) {
        content = `[Voice message (${voice.duration}s) transcribed]:\n\n${transcript}`
      } else if (filePath) {
        content = `[Voice message (${voice.duration}s) — transcription unavailable]`
      } else {
        content = "[Voice message received but download failed]"
      }

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        file: filePath ? { path: filePath, mime: voice.mime_type ?? "audio/ogg" } : undefined,
      })
    })

    bot.on("message:video", async (ctx) => {
      if (!isAllowed(ctx)) return

      const video = ctx.message.video
      const filename = video.file_name ?? `video_${video.file_id}.mp4`
      const caption = ctx.message.caption ?? ""

      // Telegram Bot API limits file downloads to 20MB
      const TOO_LARGE = video.file_size && video.file_size > 20 * 1024 * 1024
      let filePath: string | undefined
      if (TOO_LARGE) {
        log.warn("video too large for Bot API download", { fileSize: video.file_size, limit: "20MB" })
      } else {
        void bot?.api.sendChatAction(ctx.chat.id, "typing").catch(() => {})
        filePath = await downloadFile(video.file_id, filename)
      }

      // Always pass through to handleMessage so the LLM sees the user's caption
      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[Video "${filename}" (${video.duration}s) attached]`
        : TOO_LARGE
          ? `${caption ? caption + "\n\n" : ""}[Video "${filename}" not downloaded — exceeds Telegram's 20MB limit]`
          : `${caption ? caption + "\n\n" : ""}[Video "${filename}" received but download failed]`

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        file: filePath ? { path: filePath, mime: video.mime_type ?? "video/mp4", name: filename } : undefined,
      })
    })

    bot.on("message:sticker", async (ctx) => {
      if (!isAllowed(ctx)) return

      const sticker = ctx.message.sticker
      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content: `[Sticker: ${sticker.emoji ?? ""}${sticker.set_name ? ` from "${sticker.set_name}"` : ""}]`,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
      })
    })

    bot.on("message:animation", async (ctx) => {
      if (!isAllowed(ctx)) return

      const anim = ctx.message.animation
      const filename = anim.file_name ?? `animation_${anim.file_id}.mp4`
      const caption = ctx.message.caption ?? ""

      let filePath: string | undefined
      if (anim.file_size && anim.file_size > 20 * 1024 * 1024) {
        log.warn("animation too large for Bot API download", { fileSize: anim.file_size })
      } else {
        void bot?.api.sendChatAction(ctx.chat.id, "typing").catch(() => {})
        filePath = await downloadFile(anim.file_id, filename)
      }

      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[Animation "${filename}" (${anim.duration}s) attached]`
        : `${caption ? caption + "\n\n" : ""}[Animation received but download failed]`

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        file: filePath ? { path: filePath, mime: anim.mime_type ?? "video/mp4", name: filename } : undefined,
      })
    })

    bot.on("message:video_note", async (ctx) => {
      if (!isAllowed(ctx)) return

      const note = ctx.message.video_note
      let filePath: string | undefined
      if (note.file_size && note.file_size > 20 * 1024 * 1024) {
        log.warn("video note too large for Bot API download", { fileSize: note.file_size })
      } else {
        void bot?.api.sendChatAction(ctx.chat.id, "typing").catch(() => {})
        filePath = await downloadFile(note.file_id, `video_note_${note.file_id}.mp4`)
      }

      const content = filePath
        ? `[Video note (${note.duration}s) attached]`
        : "[Video note received but download failed]"

      await handleMessage(ctx, {
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        file: filePath ? { path: filePath, mime: "video/mp4" } : undefined,
      })
    })

    // Catch-all for unhandled message types
    bot.on("message", async (ctx) => {
      if (!isAllowed(ctx)) return
      const types = Object.keys(ctx.message).filter((k) =>
        !["message_id", "from", "chat", "date", "entities"].includes(k)
      )
      log.warn("unhandled message type", { types, chatId: ctx.chat.id })
    })
  }

  // ── Outbound ──────────────────────────────────────────────────────

  export async function stop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer)
      cleanupTimer = undefined
    }
    if (bot) {
      if (mode === "webhook") {
        await bot.api.deleteWebhook().catch((err) => {
          log.warn("failed to delete webhook", { error: err })
        })
      } else {
        await bot.stop()
      }
      bot = undefined
      log.info("telegram listener stopped")
    }
  }

  /** Send a message to a specific chat or the owner */
  export async function send(chatId: number | undefined, text: string): Promise<number | undefined> {
    if (!bot) {
      log.error("cannot send: bot not running")
      return undefined
    }

    const target = chatId ?? ownerChatId
    if (!target) {
      log.error("cannot send: no chat ID")
      return undefined
    }

    const MAX_LENGTH = 4096
    const chunks = splitMessage(text, MAX_LENGTH)

    let lastMessageId: number | undefined
    for (const chunk of chunks) {
      const sent = await retryTelegram(async () => {
        return bot!.api.sendMessage(target, chunk, {
          parse_mode: "Markdown",
        }).catch(async () => {
          return bot!.api.sendMessage(target, chunk)
        })
      })
      lastMessageId = sent.message_id
    }

    return lastMessageId
  }

  /** Send a photo to a chat */
  export async function sendPhoto(
    chatId: number | undefined,
    photo: string,
    caption?: string,
  ): Promise<number | undefined> {
    if (!bot) return undefined
    const target = chatId ?? ownerChatId
    if (!target) return undefined

    const sent = await retryTelegram(async () => {
      return bot!.api.sendPhoto(target, photo, { caption, parse_mode: "Markdown" })
    })
    return sent.message_id
  }

  /** React to a message */
  export async function react(chatId: number, messageId: number, emoji: string): Promise<void> {
    if (!bot) return
    await bot.api.setMessageReaction(chatId, messageId, [
      { type: "emoji", emoji: emoji as any },
    ]).catch((err) => {
      log.warn("failed to set reaction", { error: err })
    })
  }

  export function getBot() { return bot }
  export function getOwnerChatId() { return ownerChatId }
  export function getMode() { return mode }

  // ── Internal helpers ──────────────────────────────────────────────

  function isAllowed(ctx: Context): boolean {
    if (allowedUsers.size === 0) return true
    return ctx.from ? allowedUsers.has(ctx.from.id) : false
  }

  async function downloadFile(fileId: string, filename: string): Promise<string | undefined> {
    if (!bot) return undefined
    try {
      log.info("downloading telegram file", { fileId, filename })

      // Race against a 30s timeout to prevent hanging
      const result = await Promise.race([
        downloadFileInner(fileId, filename),
        new Promise<undefined>((_, reject) =>
          setTimeout(() => reject(new Error("download timed out after 30s")), 30_000)
        ),
      ])
      return result
    } catch (err) {
      log.error("failed to download telegram file", { fileId, error: err })
      return undefined
    }
  }

  async function downloadFileInner(fileId: string, filename: string): Promise<string | undefined> {
    // Use direct fetch instead of bot.api.getFile() — grammY's API client hangs in webhook mode
    // Retry getFile too — transient network errors here were causing silent failures
    const getFileData = await retryTelegram(async () => {
      const res = await fetch(`https://api.telegram.org/bot${bot!.token}/getFile?file_id=${encodeURIComponent(fileId)}`)
      if (!res.ok) throw Object.assign(new Error(`getFile HTTP ${res.status}`), { status: res.status })
      return res.json() as Promise<{ ok: boolean; result?: { file_path?: string } }>
    })
    if (!getFileData.ok || !getFileData.result?.file_path) return undefined

    const url = `https://api.telegram.org/file/bot${bot!.token}/${getFileData.result.file_path}`
    const res = await retryTelegram(async () => {
      const r = await fetch(url)
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
      return r
    })

    const inboxDir = path.join(Global.Path.data, "inbox")
    fs.mkdirSync(inboxDir, { recursive: true })

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const destPath = path.join(inboxDir, `${Date.now()}-${safeName}`)

    // Stream to disk via Bun.write (uses sendfile/splice internally, avoids Node Buffer copy)
    await Bun.write(destPath, res)

    const stat = fs.statSync(destPath)
    log.info("downloaded telegram file", { fileId, path: destPath, size: stat.size })
    return destPath
  }

  async function retryTelegram<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        lastError = err
        const status = err?.error_code ?? err?.status
        if (status === 429 || status >= 500 || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT") {
          // Exponential backoff with 20% jitter to avoid thundering herd
          const base = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          const jitter = base * 0.2 * Math.random()
          const delay = Math.round(base + jitter)
          log.warn("telegram API retry", { attempt, delay, error: err?.message })
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw lastError
  }

  /** Start periodic inbox cleanup. Runs immediately then every INBOX_CLEANUP_INTERVAL_MS. */
  function startInboxCleanup() {
    cleanInbox()
    cleanupTimer = setInterval(cleanInbox, INBOX_CLEANUP_INTERVAL_MS)
  }

  /** Delete inbox files older than INBOX_TTL_MS */
  function cleanInbox() {
    const inboxDir = path.join(Global.Path.data, "inbox")
    if (!fs.existsSync(inboxDir)) return

    const now = Date.now()
    let cleaned = 0
    try {
      for (const entry of fs.readdirSync(inboxDir)) {
        const filePath = path.join(inboxDir, entry)
        // Use the timestamp prefix in filename if available, fall back to mtime
        const timestampMatch = entry.match(/^(\d+)-/)
        let fileAge: number
        if (timestampMatch) {
          fileAge = now - parseInt(timestampMatch[1], 10)
        } else {
          try { fileAge = now - fs.statSync(filePath).mtimeMs } catch { continue }
        }

        if (fileAge > INBOX_TTL_MS) {
          try {
            fs.unlinkSync(filePath)
            cleaned++
          } catch (err) {
            log.warn("failed to clean inbox file", { file: entry, error: err })
          }
        }
      }
    } catch (err) {
      log.warn("inbox cleanup failed", { error: err })
    }
    if (cleaned > 0) {
      log.info("inbox cleanup", { filesRemoved: cleaned })
    }
  }

  function splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text]

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      let splitIndex = remaining.lastIndexOf("\n", maxLength)
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        splitIndex = remaining.lastIndexOf(" ", maxLength)
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        splitIndex = maxLength
      }

      chunks.push(remaining.slice(0, splitIndex))
      remaining = remaining.slice(splitIndex).trimStart()
    }

    return chunks
  }
}
