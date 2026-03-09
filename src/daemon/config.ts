import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Log } from "@/util/log"
import type { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"
import { createRssPoller, type RssPollerConfig } from "@/autonomy/pollers/rss"

const log = Log.create({ service: "daemon.config" })

/**
 * Load .env file from workspace or global config, injecting into process.env.
 * Bun auto-loads .env from cwd but we need the agent-specific one.
 */
export function loadEnv() {
  const candidates = [
    tryPath(path.join(Instance.directory, ".env")),
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
      let value = trimmed.slice(eqIdx + 1).trim()
      // Strip surrounding quotes (single or double)
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
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
 * Load CRONS.yaml from workspace or global config.
 * Returns empty array if no file exists.
 */
export function loadCrons(): CronScheduler.Job[] {
  const candidates = [
    tryPath(path.join(Instance.directory, "CRONS.yaml")),
    tryPath(path.join(Global.Path.config, "CRONS.yaml")),
  ].filter(Boolean) as string[]

  for (const cronPath of candidates) {
    const content = fs.readFileSync(cronPath, "utf-8")
    let parsed: unknown
    try {
      parsed = yaml.load(content)
    } catch (err) {
      throw new Error(`Failed to parse CRONS.yaml at ${cronPath}: ${String(err)}`)
    }
    // All-comment files parse as undefined/null — treat as empty
    if (parsed == null) {
      log.info("loaded crons (empty/comments only)", { path: cronPath })
      return []
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`CRONS.yaml at ${cronPath} must be a YAML array`)
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

  const safeName = (name: string) => name.replace(/[/\\]/g, "_")

  PollerManager.setStatePersistence(
    async (name: string) => {
      const file = path.join(stateDir, `${safeName(name)}.json`)
      if (!fs.existsSync(file)) return {}
      const content = fs.readFileSync(file, "utf-8")
      return JSON.parse(content)
    },
    async (name: string, state: Record<string, any>) => {
      const file = path.join(stateDir, `${safeName(name)}.json`)
      fs.writeFileSync(file, JSON.stringify(state, null, 2))
    },
  )

  log.info("poller state persistence wired", { dir: stateDir })
}

/**
 * Persist the daemon session ID so it survives restarts.
 */
export function saveSessionID(sessionID: string) {
  const file = sessionIDPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, sessionID)
  log.info("saved daemon session ID", { sessionID, path: file })
}

/**
 * Load the previously persisted daemon session ID, if any.
 */
export function loadSessionID(): string | undefined {
  const file = sessionIDPath()
  if (!fs.existsSync(file)) return undefined
  const id = fs.readFileSync(file, "utf-8").trim()
  if (!id) return undefined
  log.info("loaded daemon session ID", { sessionID: id })
  return id
}

/**
 * Clear the persisted daemon session ID (for reset).
 */
export function clearSessionID() {
  const file = sessionIDPath()
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    log.info("cleared daemon session ID")
  }
}

function sessionIDPath(): string {
  return path.join(Global.Path.data, "daemon-session-id")
}

/**
 * Load POLLERS.yaml from workspace or global config.
 * Registers all configured pollers with the PollerManager.
 *
 * Format:
 * ```yaml
 * - type: rss
 *   url: https://example.com/feed.xml
 *   label: example        # optional
 *   interval: 600         # optional, seconds
 * ```
 */
export async function loadPollers() {
  const candidates = [
    tryPath(path.join(Instance.directory, "POLLERS.yaml")),
    tryPath(path.join(Global.Path.config, "POLLERS.yaml")),
  ].filter(Boolean) as string[]

  for (const pollerPath of candidates) {
    const content = fs.readFileSync(pollerPath, "utf-8")
    let parsed: unknown
    try {
      parsed = yaml.load(content)
    } catch (err) {
      throw new Error(`Failed to parse POLLERS.yaml at ${pollerPath}: ${String(err)}`)
    }
    // All-comment files parse as undefined/null — treat as empty
    if (parsed == null) {
      log.info("loaded pollers (empty/comments only)", { path: pollerPath })
      return
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`POLLERS.yaml at ${pollerPath} must be a YAML array`)
    }

    let registered = 0
    for (const entry of parsed) {
      if (entry.type === "rss" && entry.url) {
        const config: RssPollerConfig = {
          url: entry.url,
          label: entry.label,
          interval: entry.interval,
        }
        await PollerManager.register(createRssPoller(config), config.interval)
        registered++
      } else {
        log.warn("unknown poller type or missing url", { entry })
      }
    }

    log.info("loaded pollers", { path: pollerPath, count: registered })
    return
  }
}

function tryPath(p: string): string | undefined {
  return fs.existsSync(p) ? p : undefined
}
