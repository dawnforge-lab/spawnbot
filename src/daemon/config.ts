import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Log } from "@/util/log"
import type { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"

const log = Log.create({ service: "daemon.config" })

/**
 * Load .env file from .spawnbot/ or global config, injecting into process.env.
 * Bun auto-loads .env from cwd but we need the agent-specific one.
 */
export function loadEnv() {
  const candidates = [
    tryPath(path.join(Instance.directory, ".spawnbot", ".env")),
    tryPath(path.join(Global.Path.config, ".env")),
  ].filter(Boolean) as string[]

  for (const envPath of candidates) {
    const content = fs.readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      // Don't overwrite existing env vars
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
    log.info("loaded env", { path: envPath })
    return
  }

  log.warn("no .env file found")
}

/**
 * Load CRONS.yaml from .spawnbot/ or global config.
 * Returns empty array if no file exists.
 */
export function loadCrons(): CronScheduler.Job[] {
  const candidates = [
    tryPath(path.join(Instance.directory, ".spawnbot", "CRONS.yaml")),
    tryPath(path.join(Global.Path.config, "CRONS.yaml")),
  ].filter(Boolean) as string[]

  for (const cronPath of candidates) {
    const content = fs.readFileSync(cronPath, "utf-8")
    const parsed = yaml.load(content)
    if (!Array.isArray(parsed)) {
      log.warn("CRONS.yaml is not an array, skipping", { path: cronPath })
      return []
    }
    log.info("loaded crons", { path: cronPath, count: parsed.length })
    return parsed as CronScheduler.Job[]
  }

  return []
}

/**
 * Wire poller state persistence to JSON files in the data directory.
 */
export function wirePollerState() {
  const stateDir = path.join(Global.Path.data, "poller-state")
  fs.mkdirSync(stateDir, { recursive: true })

  PollerManager.setStatePersistence(
    async (name: string) => {
      const file = path.join(stateDir, `${name}.json`)
      if (!fs.existsSync(file)) return {}
      const content = fs.readFileSync(file, "utf-8")
      return JSON.parse(content)
    },
    async (name: string, state: Record<string, any>) => {
      const file = path.join(stateDir, `${name}.json`)
      fs.writeFileSync(file, JSON.stringify(state, null, 2))
    },
  )

  log.info("poller state persistence wired", { dir: stateDir })
}

function tryPath(p: string): string | undefined {
  return fs.existsSync(p) ? p : undefined
}
