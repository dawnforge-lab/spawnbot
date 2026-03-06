import fs from "fs"
import path from "path"
import { parse as parseYaml } from "yaml"
import { Soul } from "./schema"
import { renderSoul } from "./render"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Global } from "@/global"

const log = Log.create({ service: "soul" })

let cached: { prompt: string; mtime: number } | undefined

/**
 * Resolve the SOUL.yaml path. Checks:
 * 1. Project .spawnbot/SOUL.yaml
 * 2. Project config/SOUL.yaml
 * 3. Global ~/.config/spawnbot/SOUL.yaml
 */
function resolvePath(): string | undefined {
  const candidates = [
    path.join(Instance.directory, ".spawnbot", "SOUL.yaml"),
    path.join(Instance.directory, "config", "SOUL.yaml"),
    path.join(Global.Path.config, "SOUL.yaml"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

/**
 * Load and render the SOUL.yaml into a system prompt string.
 * Uses mtime-based caching to avoid re-parsing on every call.
 * Returns the default soul prompt if no SOUL.yaml is found.
 */
export function loadSoul(): string {
  const soulPath = resolvePath()

  if (!soulPath) {
    return renderSoul(DEFAULT_SOUL)
  }

  const stat = fs.statSync(soulPath)
  const mtime = stat.mtimeMs

  if (cached && cached.mtime === mtime) {
    return cached.prompt
  }

  try {
    const raw = fs.readFileSync(soulPath, "utf-8")
    const data = parseYaml(raw)
    const parsed = Soul.parse(data)
    const prompt = renderSoul(parsed)
    cached = { prompt, mtime }
    log.info("loaded SOUL.yaml", { path: soulPath })
    return prompt
  } catch (err) {
    log.error("failed to parse SOUL.yaml, using default", { path: soulPath, error: err })
    throw err
  }
}

/** Invalidate the cache (e.g. after editing SOUL.yaml). */
export function invalidateCache() {
  cached = undefined
}

export { Soul, renderSoul }
export type { Soul as SoulType } from "./schema"

const DEFAULT_SOUL: import("./schema").Soul = {
  identity: {
    name: "Spawnbot",
    role: "a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices",
  },
  personality: {
    traits: [
      { name: "directness", level: 9, description: "Goes straight to the point without filler" },
      { name: "thoroughness", level: 8, description: "Breaks tasks into clear steps and works through them methodically" },
      { name: "autonomy", level: 8, description: "Uses available tools to accomplish tasks without unnecessary back-and-forth" },
    ],
    archetype: "expert engineer",
  },
  voice: {
    tone: "direct and technical",
    style: "Clear, concise, and action-oriented. Leads with the answer, not the reasoning.",
    avoid: [
      "Great,",
      "Certainly,",
      "Okay,",
      "Sure,",
      "ending messages with questions or offers for further assistance",
    ],
  },
  safety: {
    rules: [],
    stop_phrase: "STOP",
  },
  goals: [],
}
