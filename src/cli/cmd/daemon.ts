import { Server } from "../../server/server"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Daemon } from "../../daemon"

export const DaemonCommand = cmd({
  command: "daemon",
  describe: "start spawnbot as an autonomous daemon (Telegram + cron + autonomy)",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("directory", {
      type: "string",
      describe: "project directory to operate in",
      default: process.cwd(),
    }),
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const port = server.port!
    console.log(`spawnbot daemon listening on http://${server.hostname}:${port}`)

    // Provide Instance context (required for Session, tools, etc.)
    await Instance.provide({
      directory: args.directory as string,
      init: InstanceBootstrap,
      async fn() {
        // Start the daemon (ngrok, Telegram, cron, idle loop, input router)
        await Daemon.start({ serverPort: port })

        // Mount Telegram webhook route on the server
        const { TelegramListener } = await import("../../telegram/listener")
        const handler = TelegramListener.webhookHandler()
        if (handler) {
          const { Hono } = await import("hono")
          const webhookApp = new Hono()
          webhookApp.post("/telegram/:secret", (c) => handler(c))
          Server.App().route("/", webhookApp)
          console.log(`telegram webhook mode active`)
        }

        // Graceful shutdown
        const abort = new AbortController()
        const shutdown = async () => {
          try {
            await Daemon.stop()
            await Instance.disposeAll()
            await server.stop(true)
          } finally {
            abort.abort()
          }
        }
        process.on("SIGTERM", shutdown)
        process.on("SIGINT", shutdown)
        process.on("SIGHUP", shutdown)
        await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
      },
    })
  },
})
