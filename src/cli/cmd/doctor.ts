import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import fs from "fs"
import yaml from "js-yaml"
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
        name: "SOUL.md content",
        run: () => {
          const locations = [Global.Path.config]
          try { locations.unshift(path.join(Instance.directory, ".spawnbot")) } catch { /* no instance */ }

          for (const dir of locations) {
            const p = path.join(dir, "SOUL.md")
            if (!fs.existsSync(p)) continue
            const content = fs.readFileSync(p, "utf-8")
            if (content.length < 50) return `${p}: suspiciously short (${content.length} chars)`
            if (!content.includes("# ")) return `${p}: no Markdown headings found — may be malformed`
            return undefined
          }
          return "No SOUL.md found to validate"
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
        name: "LLM provider API key",
        run: () => {
          const keys = Object.keys(process.env).filter((k) => k.endsWith("_API_KEY"))
          if (keys.length > 0) return undefined
          return "No *_API_KEY environment variable found — set one in .env (will be loaded at runtime)"
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
        name: "CRONS.yaml syntax",
        run: () => {
          const locations: string[] = []
          try { locations.push(path.join(Instance.directory, ".spawnbot", "CRONS.yaml")) } catch { /* no instance */ }
          locations.push(path.join(Global.Path.config, "CRONS.yaml"))

          for (const loc of locations) {
            if (!fs.existsSync(loc)) continue
            try {
              const content = fs.readFileSync(loc, "utf-8")
              const parsed = yaml.load(content)
              if (!Array.isArray(parsed)) return `${loc}: must be a YAML array`
              return undefined
            } catch (err) {
              return `${loc}: YAML parse error — ${String(err)}`
            }
          }
          return undefined // no file = OK
        },
      },
      {
        name: "POLLERS.yaml syntax",
        run: () => {
          const locations: string[] = []
          try { locations.push(path.join(Instance.directory, ".spawnbot", "POLLERS.yaml")) } catch { /* no instance */ }
          locations.push(path.join(Global.Path.config, "POLLERS.yaml"))

          for (const loc of locations) {
            if (!fs.existsSync(loc)) continue
            try {
              const content = fs.readFileSync(loc, "utf-8")
              const parsed = yaml.load(content)
              if (!Array.isArray(parsed)) return `${loc}: must be a YAML array`
              return undefined
            } catch (err) {
              return `${loc}: YAML parse error — ${String(err)}`
            }
          }
          return undefined // no file = OK
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
      {
        name: "Daemon session",
        run: () => {
          const file = path.join(Global.Path.data, "daemon-session-id")
          if (!fs.existsSync(file)) return "No persisted session (will create on first daemon start)"
          const id = fs.readFileSync(file, "utf-8").trim()
          return id ? undefined : "Empty session file (will create on next daemon start)"
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
      } else if (error.includes("will use default") || error.includes("will be loaded") || error.includes("will create")) {
        prompts.log.warn(`${check.name}: ${error}`)
        warned++
      } else {
        prompts.log.error(`${check.name}: ${error}`)
        failed++
      }
    }

    prompts.outro(
      `${passed} passed, ${warned} warnings, ${failed} errors${failed > 0 ? " — run 'spawnbot' and type /setup to fix" : ""}`,
    )
  },
})
