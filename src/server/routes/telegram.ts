import { Hono } from "hono"
import { webhookCallback } from "grammy"
import { TelegramListener } from "@/telegram/listener"
import { Log } from "@/util/log"

const log = Log.create({ service: "server.telegram" })

export function TelegramRoutes() {
  return new Hono().post("/", (c) => {
    const bot = TelegramListener.getBot()
    if (!bot) {
      log.error("webhook received but bot not running")
      return c.text("bot not running", 503)
    }

    const secret = bot.token.split(":")[1]
    const handler = webhookCallback(bot, "hono", {
      secretToken: secret,
      onTimeout: "return",
      timeoutMilliseconds: 60_000,
    })

    return handler(c)
  })
}
