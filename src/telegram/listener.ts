import { Bot, type Context } from "grammy"
import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "telegram.listener" })

export namespace TelegramListener {
  let bot: Bot | undefined
  let allowedUsers: Set<number> = new Set()
  let ownerChatId: number | undefined

  export interface Config {
    token: string
    allowedUsers?: number[] // Telegram user IDs
    ownerChatId?: number // Primary chat ID for responses
  }

  export function start(config: Config) {
    if (bot) {
      log.warn("telegram listener already running")
      return
    }

    bot = new Bot(config.token)
    allowedUsers = new Set(config.allowedUsers ?? [])
    ownerChatId = config.ownerChatId

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

      InputQueue.enqueue(event)
    })

    bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx)) return

      const caption = ctx.message.caption ?? "[photo received]"
      InputQueue.enqueue({
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content: caption,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          hasPhoto: true,
        },
        timestamp: Date.now(),
      })
    })

    bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx)) return

      const caption = ctx.message.caption ?? `[document: ${ctx.message.document.file_name ?? "unknown"}]`
      InputQueue.enqueue({
        id: ulid(),
        source: "telegram",
        sender: ctx.from?.first_name ?? ctx.from?.username ?? "unknown",
        content: caption,
        priority: "normal",
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.from?.id,
          hasDocument: true,
          fileName: ctx.message.document.file_name,
        },
        timestamp: Date.now(),
      })
    })

    bot.catch((err) => {
      log.error("telegram bot error", { error: err })
    })

    bot.start({
      onStart: () => {
        log.info("telegram listener started", {
          allowedUsers: [...allowedUsers],
        })
      },
    })
  }

  export async function stop() {
    if (bot) {
      await bot.stop()
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
      const sent = await bot.api.sendMessage(target, chunk, {
        parse_mode: "Markdown",
      }).catch(async () => {
        // Retry without Markdown if parsing fails
        return bot!.api.sendMessage(target, chunk)
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

    const sent = await bot.api.sendPhoto(target, photo, {
      caption,
      parse_mode: "Markdown",
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
