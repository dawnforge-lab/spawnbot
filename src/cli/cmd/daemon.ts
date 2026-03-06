import { Server } from "../../server/server"
import { Instance } from "../../project/instance"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Daemon } from "../../daemon"

export const DaemonCommand = cmd({
  command: "daemon",
  describe: "start spawnbot as an autonomous daemon (Telegram + cron + autonomy)",
  builder: (yargs) => withNetworkOptions(yargs),
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`spawnbot daemon listening on http://${server.hostname}:${server.port}`)

    // Start the daemon (Telegram, cron, idle loop, input router)
    await Daemon.start()

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
