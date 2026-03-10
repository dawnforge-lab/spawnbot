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
    withNetworkOptions(yargs)
      .option("directory", {
        type: "string",
        describe: "project directory to operate in",
        default: process.cwd(),
      })
      .option("dry-run", {
        type: "boolean",
        describe: "validate config, process one test event, then exit",
        default: false,
      }),
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)

    const server = Server.listen(opts)
    const port = server.port!
    console.log(`spawnbot daemon listening on http://${server.hostname}:${port}`)

    const { writePortFile, removePortFile } = await import("../../daemon/state")

    await Instance.provide({
      directory: args.directory as string,
      init: InstanceBootstrap,
      async fn() {
        await Daemon.start(port, args.directory as string)

        // Write port file AFTER everything is wired so the bash script
        // doesn't think the daemon is ready when it's still initializing
        writePortFile(port)

        if (args.dryRun) {
          await runDryRun()
          await Daemon.stop()
          await Instance.disposeAll()
          await server.stop(true)
          return
        }

        // Graceful shutdown
        const abort = new AbortController()
        const shutdown = async () => {
          try {
            await Daemon.stop()
            await Instance.disposeAll()
            await server.stop(true)
            removePortFile()
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

async function runDryRun() {
  const { InputQueue } = await import("../../input/queue")

  console.log("\n--- DRY RUN ---")
  console.log("Subsystems started. Injecting test event...")

  // Inject a synthetic test event
  const enqueued = InputQueue.enqueue({
    id: "dry-run-test",
    source: "cli",
    sender: "dry-run",
    content: "This is a dry-run test. Respond with a single sentence confirming you are operational.",
    priority: "critical",
    timestamp: Date.now(),
  })

  if (!enqueued) {
    console.error("FAIL: Could not enqueue test event (queue full?)")
    process.exitCode = 1
    return
  }

  console.log("Test event enqueued. Waiting for processing...")

  // Wait for the event to be processed (timeout after 60s)
  const start = Date.now()
  const timeout = 60_000
  while (InputQueue.size() > 0 && Date.now() - start < timeout) {
    await Bun.sleep(500)
  }

  if (Date.now() - start >= timeout) {
    console.error("FAIL: Timed out waiting for event processing")
    process.exitCode = 1
    return
  }

  console.log("PASS: Event processed successfully")
  console.log("--- DRY RUN COMPLETE ---\n")
}
