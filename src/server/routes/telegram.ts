import { Hono } from "hono"
import { TelegramListener } from "@/telegram/listener"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Daemon } from "@/daemon"
import { Log } from "@/util/log"

const log = Log.create({ service: "server.telegram" })

export function TelegramRoutes() {
  return new Hono().post("/", async (c) => {
    const bot = TelegramListener.getBot()
    if (!bot) {
      log.error("webhook received but bot not running")
      return c.text("bot not running", 503)
    }

    // Validate secret token
    const secret = bot.token.split(":")[1]
    const headerSecret = c.req.header("x-telegram-bot-api-secret-token")
    if (headerSecret !== secret) {
      log.warn("webhook secret mismatch")
      return c.text("unauthorized", 401)
    }

    // Parse update
    const update = await c.req.json()

    // Fire-and-forget: process update within the daemon's workspace context
    // (HTTP requests don't inherit the daemon's AsyncLocalStorage context,
    //  so we explicitly provide the same directory the daemon uses)
    void Instance.provide({
      directory: Daemon.getDirectory(),
      init: InstanceBootstrap,
      fn: () => bot.handleUpdate(update),
    }).catch((err) => {
      log.error("handleUpdate failed", { error: err })
    })

    return c.text("ok", 200)
  })
}
