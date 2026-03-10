import z from "zod"
import { Tool } from "./tool"
import { TelegramListener } from "@/telegram/listener"

export const TelegramPhotoTool = Tool.define("tg_photo", {
  description: `Send a photo to Telegram proactively (for autonomous actions only). Do NOT use this for replying to user messages. The photo can be a URL or a file_id.`,
  parameters: z.object({
    photo: z.string().describe("Photo URL or file_id"),
    caption: z.string().optional().describe("Photo caption (supports Markdown)"),
    chat_id: z.coerce.number().optional().describe("Target chat ID (defaults to owner chat)"),
  }),
  async execute(params) {
    const messageId = await TelegramListener.sendPhoto(params.chat_id, params.photo, params.caption)
    if (messageId === undefined) {
      return {
        title: "Photo send failed",
        metadata: { messageId: undefined as number | undefined, sent: false },
        output: "Failed to send photo.",
      }
    }
    return {
      title: "Photo sent",
      metadata: { messageId: messageId as number | undefined, sent: true },
      output: `Photo sent (id: ${messageId})`,
    }
  },
})

export const TelegramReactTool = Tool.define("tg_react", {
  description: `React to a Telegram message with an emoji.`,
  parameters: z.object({
    chat_id: z.coerce.number().describe("Chat ID containing the message"),
    message_id: z.coerce.number().describe("Message ID to react to"),
    emoji: z.string().describe("Emoji to react with (e.g. 👍, ❤️, 🔥)"),
  }),
  async execute(params) {
    await TelegramListener.react(params.chat_id, params.message_id, params.emoji)
    return {
      title: "Reacted",
      metadata: {},
      output: `Reacted with ${params.emoji}`,
    }
  },
})
