import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import fs from "fs"
import { Global } from "../../global"
import { Instance } from "../../project/instance"

interface Check {
  name: string
  run: () => string | undefined // returns error message or undefined for pass
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check agent configuration and dependencies",
  builder: (yargs) => yargs,
  handler: async () => {
    prompts.intro(UI.logo())

    const checks: Check[] = [
      {
        name: "Global config directory",
        run: () => {
          return fs.existsSync(Global.Path.config)
            ? undefined
            : `Missing: ${Global.Path.config}`
        },
      },
      {
        name: "SOUL.md (global)",
        run: () => {
          const p = path.join(Global.Path.config, "SOUL.md")
          return fs.existsSync(p) ? undefined : `Not found: ${p} (will use default)`
        },
      },
      {
        name: "SOUL.md (project)",
        run: () => {
          try {
            const p = path.join(Instance.directory, ".spawnbot", "SOUL.md")
            return fs.existsSync(p) ? undefined : `Not found: ${p}`
          } catch {
            return "No project context (run from a project directory)"
          }
        },
      },
      {
        name: ".env file",
        run: () => {
          const locations = [
            path.join(Global.Path.config, ".env"),
          ]
          try {
            locations.unshift(path.join(Instance.directory, ".spawnbot", ".env"))
          } catch { /* no instance */ }

          for (const loc of locations) {
            if (fs.existsSync(loc)) return undefined
          }
          return "No .env found — Telegram won't work without TELEGRAM_BOT_TOKEN"
        },
      },
      {
        name: "TELEGRAM_BOT_TOKEN",
        run: () => {
          if (process.env.TELEGRAM_BOT_TOKEN) return undefined
          return "Not set in environment (will be loaded from .env at runtime)"
        },
      },
      {
        name: "NGROK_AUTHTOKEN",
        run: () => {
          if (process.env.NGROK_AUTHTOKEN) return undefined
          return "Not set — Telegram will use long polling instead of webhooks (will be loaded from .env at runtime)"
        },
      },
      {
        name: "Data directory",
        run: () => {
          return fs.existsSync(Global.Path.data)
            ? undefined
            : `Missing: ${Global.Path.data}`
        },
      },
    ]

    let passed = 0
    let warned = 0
    let failed = 0

    for (const check of checks) {
      const error = check.run()
      if (!error) {
        prompts.log.success(check.name)
        passed++
      } else if (error.includes("will use default") || error.includes("will be loaded")) {
        prompts.log.warn(`${check.name}: ${error}`)
        warned++
      } else {
        prompts.log.error(`${check.name}: ${error}`)
        failed++
      }
    }

    prompts.outro(
      `${passed} passed, ${warned} warnings, ${failed} errors${failed > 0 ? " — run 'spawnbot setup' to fix" : ""}`,
    )
  },
})
