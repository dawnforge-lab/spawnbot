import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Global } from "@/global"

import DEFAULT_SOUL from "./default-soul.txt"

const log = Log.create({ service: "soul" })

let cached: { content: string; mtime: number } | undefined

/** File names for agent knowledge documents */
const DOCS = {
  soul: "SOUL.md",
  user: "USER.md",
  goals: "GOALS.md",
  playbook: "PLAYBOOK.md",
  skills: "SKILLS.md",
} as const

/**
 * Search directories for agent docs (SOUL.md, USER.md, etc.):
 * 1. Workspace root (Instance.directory)
 * 2. Global ~/.config/spawnbot/
 */
function searchDirs(): string[] {
  const dirs: string[] = []
  try {
    dirs.push(Instance.directory)
  } catch {
    // Instance context not available (e.g. during tests or before project init)
  }
  dirs.push(Global.Path.config)
  return dirs
}

function findFile(filename: string): string | undefined {
  for (const dir of searchDirs()) {
    const candidate = path.join(dir, filename)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Load SOUL.md content with mtime-based caching.
 * Returns the file content directly — it's Markdown, ready for the system prompt.
 * Falls back to the built-in default if no SOUL.md exists.
 */
export function loadSoul(opts?: { required?: boolean }): string {
  const soulPath = findFile(DOCS.soul)

  if (!soulPath) {
    if (opts?.required) {
      throw new Error("SOUL.md not found. Run 'spawnbot' and type /setup to create one.")
    }
    // Write default SOUL.md to disk so users can see and edit it
    try {
      const dir = docsDir()
      fs.mkdirSync(dir, { recursive: true })
      const targetPath = path.join(dir, DOCS.soul)
      fs.writeFileSync(targetPath, DEFAULT_SOUL + "\n", "utf-8")
      log.info("created default SOUL.md", { path: targetPath })
    } catch (e) {
      log.debug("could not write default SOUL.md to disk", { error: e })
    }
    return DEFAULT_SOUL
  }

  const stat = fs.statSync(soulPath)
  const mtime = stat.mtimeMs

  if (cached && cached.mtime === mtime) {
    return cached.content
  }

  const content = fs.readFileSync(soulPath, "utf-8").trim()
  cached = { content, mtime }
  log.info("loaded SOUL.md", { path: soulPath })
  return content
}

/**
 * Build the reference block that tells the agent about its knowledge files.
 * Only lists files that actually exist. Injected into system prompt so the
 * agent knows it can read/write them with standard tools.
 */
export function buildDocsReference(): string | undefined {
  const found: string[] = []

  for (const [key, filename] of Object.entries(DOCS)) {
    if (key === "soul") continue // SOUL.md is inlined, not referenced
    const filepath = findFile(filename)
    if (filepath) {
      found.push(`- ${filepath} (${describeDoc(key)})`)
    }
  }

  if (found.length === 0) return undefined

  return [
    "You have knowledge files you can read and update:",
    ...found,
  ].join("\n")
}

/**
 * Get the preferred directory for creating new doc files.
 * Returns the workspace root (Instance.directory).
 */
export function docsDir(): string {
  return Instance.directory
}

/** Invalidate the SOUL.md cache. */
export function invalidateCache() {
  cached = undefined
}

function describeDoc(key: string): string {
  switch (key) {
    case "user": return "about your user"
    case "goals": return "current objectives and targets"
    case "playbook": return "action templates and procedures"
    case "skills": return "index of your skills and tools — read this to know what you can do, update it when you create new skills or tools"
    default: return key
  }
}
