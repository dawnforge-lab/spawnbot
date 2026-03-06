import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Instance } from "../../project/instance"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless spawnbot server",
  handler: async (args) => {
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`spawnbot server listening on http://${server.hostname}:${server.port}`)

    const abort = new AbortController()
    const shutdown = async () => {
      try {
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
