import { Bot, type Context } from "grammy"
import { Log } from "@/util/log"
import fs from "fs"
import path from "path"
import { Global } from "@/global"
import { Transcribe } from "./transcribe"

const log = Log.create({ service: "telegram.listener" })

export namespace TelegramListener {
  let bot: Bot | undefined
  let allowedUsers: Set<number> = new Set()
  let ownerChatId: number | undefined
  let mode: "polling" | "webhook" = "polling"

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
      const filePath = await downloadFile(video.file_id, filename)
      const caption = ctx.message.caption ?? ""

      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[Video "${filename}" (${video.duration}s) attached]`
        : `${caption ? caption + "\n\n" : ""}[Video received but download failed]`

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
  }

  // ── Outbound ──────────────────────────────────────────────────────

  export async function stop() {
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
      const file = await bot.api.getFile(fileId)
      if (!file.file_path) return undefined

      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
      const res = await fetch(url)
      if (!res.ok) return undefined

      const inboxDir = path.join(Global.Path.data, "inbox")
      fs.mkdirSync(inboxDir, { recursive: true })

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
      const destPath = path.join(inboxDir, `${Date.now()}-${safeName}`)
      const buffer = await res.arrayBuffer()
      fs.writeFileSync(destPath, Buffer.from(buffer))

      log.info("downloaded telegram file", { fileId, path: destPath, size: buffer.byteLength })
      return destPath
    } catch (err) {
      log.error("failed to download telegram file", { fileId, error: err })
      return undefined
    }
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
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          log.warn("telegram API retry", { attempt, delay, error: err?.message })
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw lastError
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
