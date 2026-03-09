import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "@/util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { WorkspaceServeCommand } from "./cli/cmd/workspace-serve"
import { Filesystem } from "./util/filesystem"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
// TUI commands are lazy-loaded to avoid pulling in .tsx / JSX at import time.
// This allows non-TUI commands (setup, daemon, doctor) to run without the
// @opentui/solid Babel preload, which requires bunfig.toml in $cwd.
const AttachCommand = {
  command: "attach <url>",
  describe: "attach to a running spawnbot server",
  builder: (yargs: any) =>
    yargs
      .positional("url", { type: "string", demandOption: true })
      .option("dir", { type: "string", description: "directory to run in" })
      .option("continue", { alias: ["c"], describe: "continue the last session", type: "boolean" })
      .option("session", { alias: ["s"], type: "string", describe: "session id to continue" })
      .option("fork", { type: "boolean", describe: "fork the session when continuing" })
      .option("password", { alias: ["p"], type: "string", describe: "basic auth password" })
      .option("prompt", { type: "string", describe: "prompt to send on attach" }),
  handler: async (args: any) => {
    const { AttachCommand: Cmd } = await import("./cli/cmd/tui/attach")
    return Cmd.handler!(args)
  },
}
const TuiThreadCommand = {
  command: "$0 [project]",
  describe: "start spawnbot tui",
  builder: (yargs: any) =>
    yargs
      .positional("project", { type: "string" })
      .option("prompt", { type: "string", describe: "initial prompt to send" })
      .option("model", { type: "string", alias: ["m"], describe: "model to use" })
      .option("continue", { alias: ["c"], type: "boolean", describe: "continue last session" })
      .option("session", { alias: ["s"], type: "string", describe: "session id to continue" })
      .option("fork", { type: "boolean", describe: "fork the session" })
      .option("agent", { type: "string", describe: "agent to use" }),
  handler: async (args: any) => {
    const { TuiThreadCommand: Cmd } = await import("./cli/cmd/tui/thread")
    return Cmd.handler!(args)
  },
}
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { SetupCommand } from "./cli/cmd/setup"
import { DoctorCommand } from "./cli/cmd/doctor"
import { DaemonCommand } from "./cli/cmd/daemon"
import { ResetSessionCommand } from "./cli/cmd/reset-session"
import { ConfigCommand } from "./cli/cmd/config"
import { Instance } from "./project/instance"
import { DbCommand } from "./cli/cmd/db"
import path from "path"
import { Global } from "./global"
import { JsonMigration } from "./storage/json-migration"
import { Database } from "./storage/db"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

let cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("spawnbot")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"

    Log.Default.info("opencode", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    const marker = path.join(Global.Path.data, "kilo.db")
    if (!(await Filesystem.exists(marker))) {
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        await JsonMigration.run(Database.Client().$client, {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(DbCommand)
  .command(SetupCommand)
  .command(DoctorCommand)
  .command(DaemonCommand)
  .command(ResetSessionCommand)
  .command(ConfigCommand)

if (Installation.isLocal()) {
  cli = cli.command(WorkspaceServeCommand)
}

cli = cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write((e instanceof Error ? e.message : String(e)) + EOL)
  }
  process.exitCode = 1
} finally {
  await Instance.disposeAll()

  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
