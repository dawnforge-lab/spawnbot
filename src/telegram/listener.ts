import { Bot, webhookCallback, type Context } from "grammy"
import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"
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

  export interface Config {
    token: string
    allowedUsers?: number[] // Telegram user IDs
    ownerChatId?: number // Primary chat ID for responses
    /** Webhook URL — if set, uses webhook mode instead of long polling */
    webhookUrl?: string
    /** Secret token for webhook verification */
    webhookSecret?: string
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

    if (config.webhookUrl) {
      mode = "webhook"
      // Set webhook with Telegram API — await so failures propagate
      const secretPath = config.webhookSecret ?? config.token.split(":")[1]
      const fullUrl = `${config.webhookUrl}/telegram/${secretPath}`
      await bot.api.setWebhook(fullUrl)
      log.info("telegram webhook set", { url: fullUrl })
    } else {
      mode = "polling"
      // Clear any stale webhook from a previous crashed daemon
      await bot.api.deleteWebhook({ drop_pending_updates: true }).catch((err) => {
        log.warn("failed to clear stale webhook before polling", { error: err })
      })
      bot.start({
        onStart: () => {
          log.info("telegram long polling started", {
            allowedUsers: [...allowedUsers],
          })
        },
      })
    }
  }

  /**
   * Get the Hono-compatible webhook handler.
   * Mount this at /telegram/:secret on your Hono app.
   */
  export function webhookHandler() {
    if (!bot || mode !== "webhook") return undefined
    return webhookCallback(bot, "hono")
  }

  /** Download a file from Telegram and save it to the inbox directory. */
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

      // Use timestamp prefix to avoid collisions
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

  /** Enqueue an event or notify the user if the queue is full */
  async function enqueueOrReply(ctx: Context, event: InputQueue.InputEvent): Promise<void> {
    const accepted = InputQueue.enqueue(event)
    if (!accepted) {
      await ctx.reply("I'm currently busy processing other messages. Please try again shortly.").catch((err) => {
        log.warn("failed to send queue-full reply", { error: err })
      })
    }
  }

  /** Retry a Telegram API call with exponential backoff for transient errors */
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

  function registerHandlers() {
    if (!bot) return

    bot.on("message:text", async (ctx) => {
      if (!isAllowed(ctx)) {
        log.warn("unauthorized message", {
          userId: ctx.from?.id,
          username: ctx.from?.username,
        })
        return
      }

      const event: InputQueue.InputEvent = {
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content: ctx.message.text,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          username: ctx.from?.username,
        },
        timestamp: Date.now(),
      }

      await enqueueOrReply(ctx, event)
    })

    bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx)) return

      // Download the highest-resolution photo
      const photos = ctx.message.photo
      const largest = photos[photos.length - 1]
      const filePath = await downloadFile(largest.file_id, `photo_${largest.file_id}.jpg`)

      const caption = ctx.message.caption ?? ""
      if (!filePath) {
        await ctx.reply("Photo download failed. I'll still process your message but won't be able to see the image.").catch(() => {})
      }
      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[Photo saved to ${filePath} — read and analyze this image]`
        : caption || "[photo received but download failed]"

      await enqueueOrReply(ctx, {
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          filePath,
          fileType: "photo",
          mime: "image/jpeg",
        },
        timestamp: Date.now(),
      })
    })

    bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx)) return

      const doc = ctx.message.document
      const filename = doc.file_name ?? "document"
      const filePath = await downloadFile(doc.file_id, filename)

      const caption = ctx.message.caption ?? ""
      if (!filePath) {
        await ctx.reply(`Document "${filename}" download failed. I'll still process your message but won't be able to read the file.`).catch(() => {})
      }
      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[File "${filename}" saved to ${filePath} — read and analyze this file]`
        : `${caption ? caption + "\n\n" : ""}[Document "${filename}" received but download failed]`

      await enqueueOrReply(ctx, {
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          filePath,
          fileType: "document",
          fileName: filename,
          mime: doc.mime_type,
        },
        timestamp: Date.now(),
      })
    })

    bot.on("message:voice", async (ctx) => {
      if (!isAllowed(ctx)) return

      const voice = ctx.message.voice
      const filePath = await downloadFile(voice.file_id, `voice_${voice.file_id}.ogg`)

      // Attempt Whisper transcription if file was downloaded
      let transcript: string | undefined
      if (filePath) {
        transcript = await Transcribe.audio(filePath)
      }

      let content: string
      if (transcript) {
        content = `[Voice message (${voice.duration}s) transcribed]:\n\n${transcript}`
      } else if (filePath) {
        content = `[Voice message (${voice.duration}s) saved to ${filePath} — transcription unavailable, analyze this audio file]`
      } else {
        await ctx.reply("Voice message download failed.").catch(() => {})
        content = "[Voice message received but download failed]"
      }

      await enqueueOrReply(ctx, {
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          filePath,
          fileType: "voice",
          mime: voice.mime_type ?? "audio/ogg",
          duration: voice.duration,
          transcript,
        },
        timestamp: Date.now(),
      })
    })

    bot.on("message:video", async (ctx) => {
      if (!isAllowed(ctx)) return

      const video = ctx.message.video
      const filename = video.file_name ?? `video_${video.file_id}.mp4`
      const filePath = await downloadFile(video.file_id, filename)

      const caption = ctx.message.caption ?? ""
      if (!filePath) {
        await ctx.reply("Video download failed. I'll still process your message but won't be able to see the video.").catch(() => {})
      }
      const content = filePath
        ? `${caption ? caption + "\n\n" : ""}[Video "${filename}" (${video.duration}s) saved to ${filePath}]`
        : `${caption ? caption + "\n\n" : ""}[Video received but download failed]`

      await enqueueOrReply(ctx, {
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          filePath,
          fileType: "video",
          fileName: filename,
          mime: video.mime_type,
          duration: video.duration,
        },
        timestamp: Date.now(),
      })
    })

    bot.on("message:sticker", async (ctx) => {
      if (!isAllowed(ctx)) return

      const sticker = ctx.message.sticker
      await enqueueOrReply(ctx, {
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content: `[Sticker: ${sticker.emoji ?? ""}${sticker.set_name ? ` from "${sticker.set_name}"` : ""}]`,
        priority: "low",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          fileType: "sticker",
        },
        timestamp: Date.now(),
      })
    })
  }

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

    // Split long messages (Telegram limit: 4096 chars)
    const MAX_LENGTH = 4096
    const chunks = splitMessage(text, MAX_LENGTH)

    let lastMessageId: number | undefined
    for (const chunk of chunks) {
      const sent = await retryTelegram(async () => {
        return bot!.api.sendMessage(target, chunk, {
          parse_mode: "Markdown",
        }).catch(async () => {
          // Retry without Markdown if parsing fails
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
      return bot!.api.sendPhoto(target, photo, {
        caption,
        parse_mode: "Markdown",
      })
    })
    return sent.message_id
  }

  /** React to a message */
  export async function react(
    chatId: number,
    messageId: number,
    emoji: string,
  ): Promise<void> {
    if (!bot) return
    await bot.api.setMessageReaction(chatId, messageId, [
      { type: "emoji", emoji: emoji as any },
    ]).catch((err) => {
      log.warn("failed to set reaction", { error: err })
    })
  }

  export function getBot() {
    return bot
  }

  export function getOwnerChatId() {
    return ownerChatId
  }

  export function getMode() {
    return mode
  }

  function isAllowed(ctx: Context): boolean {
    if (allowedUsers.size === 0) return true // no restrictions
    return ctx.from ? allowedUsers.has(ctx.from.id) : false
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

      // Try to split at a newline
      let splitIndex = remaining.lastIndexOf("\n", maxLength)
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // Try space
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
