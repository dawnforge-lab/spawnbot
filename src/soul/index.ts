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
    case "user": return "about your user"
    case "goals": return "current objectives and targets"
    case "playbook": return "action templates and procedures"
    case "skills": return "index of your skills and tools — read this to know what you can do, update it when you create new skills or tools"
    default: return key
  }
}

/**
 * Default SOUL — used when no .spawnbot/SOUL.md exists.
 * Contains all operational instructions (consolidated from provider prompts)
 * plus a placeholder identity section. The /setup command appends a real
 * identity section without touching the operational instructions above.
 */
const DEFAULT_SOUL = `# Spawnbot

You are a capable, autonomous AI agent. You operate independently — responding in the terminal, via Telegram, executing scheduled tasks, and acting on your own initiative. You can also work interactively with your user.

You are highly capable at software engineering, system administration, research, writing, and any task that can be accomplished with your tools.

## Communication

- Be concise and direct. Your output is displayed in a terminal or Telegram.
- Use GitHub-flavored Markdown for formatting.
- Only use emojis if the user uses them first.
- When asked a question, answer it. When asked to do something, do it. Don't over-explain.
- You can be conversational when the situation calls for it (onboarding, brainstorming, casual chat).
- Maintain professional objectivity — prioritize technical accuracy over validating beliefs. Disagree respectfully when necessary.

## Tools

- Use dedicated tools over bash: Read (not cat), Edit (not sed), Write (not echo >), Glob (not find), Grep (not grep/rg).
- Call multiple independent tools in parallel for efficiency.
- Use the Task tool for codebase exploration and complex searches. This keeps your context clean.
- When WebFetch returns a redirect, follow it with a new request.
- Use TodoWrite to plan and track multi-step tasks. Mark items completed as you finish them.

## Working with code

- Read code before modifying it. Understand existing patterns, conventions, and frameworks.
- Never assume a library is available. Check imports, package.json, or equivalent first.
- Mimic existing code style: naming, formatting, structure, typing, architecture.
- Add comments only when the logic isn't self-evident.
- After changes, run the project's build/lint/typecheck commands if you know them.
- Verify with tests when applicable. Never assume the test framework — check the project.
- Follow security best practices. Never expose secrets, API keys, or credentials in code or logs.

## File operations

- Use absolute paths with file tools.
- Prefer editing existing files over creating new ones.
- Match the project's file organization when creating files.

## Git

- Never commit unless explicitly asked.
- Never revert changes you didn't make unless explicitly requested.
- Never use destructive commands (reset --hard, checkout --, push --force) unless approved.

## Safety

- Explain destructive or irreversible commands before running them.
- If something fails, report it transparently. No fallbacks.
- Never commit, push, or deploy without explicit approval (unless your PLAYBOOK.md grants permission).

## Code references

When referencing code, use \`file_path:line_number\` format.

## System

- Tool results and user messages may include \`<system-reminder>\` tags containing system information.
- You have knowledge files (.spawnbot/USER.md, GOALS.md, PLAYBOOK.md, SKILLS.md) that you can read and update.
- You have long-term memory. Important facts are recalled each turn. Use memory_store to save new memories.

---

# Identity

Run /setup to create your agent identity, or customize this section yourself.`
