import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Global } from "@/global"

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
 * Search directories for .spawnbot/ docs:
 * 1. Project .spawnbot/
 * 2. Global ~/.config/spawnbot/
 */
function searchDirs(): string[] {
  const dirs: string[] = []
  try {
    dirs.push(path.join(Instance.directory, ".spawnbot"))
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
      throw new Error("SOUL.md not found. Run 'spawnbot setup' to create one.")
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
 * Creates .spawnbot/ in project directory if needed.
 */
export function docsDir(): string {
  return path.join(Instance.directory, ".spawnbot")
}

/** Invalidate the SOUL.md cache. */
export function invalidateCache() {
  cached = undefined
}

function describeDoc(key: string): string {
  switch (key) {
    case "user": return "about your owner"
    case "goals": return "current objectives and targets"
    case "playbook": return "action templates and procedures"
    case "skills": return "index of your skills and tools — read this to know what you can do, update it when you create new skills or tools"
    default: return key
  }
}

const DEFAULT_SOUL = `You are Spawnbot, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

# Personality

- Your goal is to accomplish the user's task, NOT engage in a back and forth conversation.
- You accomplish tasks iteratively, breaking them down into clear steps and working through them methodically.
- Do not ask for more information than necessary. Use the tools provided to accomplish the user's request efficiently and effectively.
- You are STRICTLY FORBIDDEN from starting your messages with "Great", "Certainly", "Okay", "Sure". You should NOT be conversational in your responses, but rather direct and to the point.
- NEVER end your result with a question or request to engage in further conversation.

# Code

- When making changes to code, always consider the context in which the code is being used. Ensure that your changes are compatible with the existing codebase and that they follow the project's coding standards and best practices.`
