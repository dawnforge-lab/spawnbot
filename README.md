# Spawnbot

An autonomous AI agent that lives in your terminal and talks to you on Telegram. It can write code, run commands, remember things, learn new skills, and operate on a schedule — all without supervision.

Built on [Kilo Code CLI](https://github.com/Kilo-Org/kilocode) (which builds on [opencode](https://github.com/sst/opencode)). Spawnbot strips the interactive TUI focus and adds the daemon layer: Telegram, memory, autonomy, and self-extending skills/tools.

## What It Does

- **Telegram integration** — Chat with your agent from anywhere. Supports webhooks (via ngrok) or long polling.
- **Long-term memory** — SQLite-backed memory with FTS5 full-text search. The agent stores and recalls memories across sessions. Relevant memories are automatically injected into each conversation turn.
- **Session persistence** — Conversation history survives daemon restarts. The agent picks up where it left off.
- **Autonomy** — Cron jobs, idle loops, and pollers let the agent act on its own schedule.
- **Self-extending** — The agent can create its own skills (prompt-level knowledge) and tools (executable TypeScript) at runtime.
- **Multi-provider** — Works with Anthropic (Claude), OpenAI, Google (Gemini), DeepSeek, Groq, and 15+ other LLM providers via the Vercel AI SDK.
- **20+ built-in tools** — bash, read, write, edit, glob, grep, web fetch, web search, memory, Telegram, and more.

## Requirements

- [Bun](https://bun.sh/) v1.1+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An LLM provider API key (e.g. `ANTHROPIC_API_KEY`)
- Optional: [ngrok](https://ngrok.com/) account for Telegram webhooks

## Install

```bash
git clone https://github.com/your-org/spawnbot.git
cd spawnbot
bun install
```

## Quick Start

### 1. Run the setup wizard

```bash
bun run src/index.ts setup
```

This creates `.spawnbot/` in your project with:
- `SOUL.md` — Agent personality and behavior
- `.env` — Telegram token, owner ID, ngrok config, LLM API keys

### 2. Configure your LLM provider

Set your provider API key in `.spawnbot/.env` or as an environment variable:

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...

# Google
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### 3. Start the daemon

```bash
bun run src/index.ts daemon
```

The daemon:
1. Loads `.spawnbot/.env`
2. Starts ngrok tunnel (if `NGROK_AUTHTOKEN` is set)
3. Resumes or creates a persistent session
4. Connects to Telegram (webhook or long polling)
5. Starts cron jobs, idle loop, and memory decay
6. Processes incoming messages through the LLM

### 4. Talk to your agent on Telegram

Send a message to your bot. It has full access to your project directory, all tools, and its memory system.

## Configuration

All config lives in `.spawnbot/` (project-level) or `~/.config/spawnbot/` (global).

### Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality, behavior rules, core identity |
| `USER.md` | Information about you (the owner) |
| `GOALS.md` | Current objectives and targets |
| `PLAYBOOK.md` | Action templates and procedures |
| `SKILLS.md` | Index of skills and tools (agent-maintained) |
| `CRONS.yaml` | Scheduled jobs |
| `.env` | API keys and secrets |

### SOUL.md

This is the most important file. It's the first thing the LLM sees on every turn. Define your agent's personality, rules, and behavior here.

```markdown
You are Jarvis, a sharp and efficient AI assistant.

# Personality
- Direct and concise. No filler.
- Proactive — anticipate what I need next.
- When unsure, investigate before asking.

# Rules
- Never push to main without asking.
- Always run tests before committing.
- Respond on Telegram within one message when possible.
```

If no SOUL.md exists, a sensible default is used.

### CRONS.yaml

Schedule autonomous tasks:

```yaml
- name: morning-report
  schedule: "0 9 * * *"
  prompt: "Check git log for yesterday's commits and send me a summary on Telegram."

- name: dependency-check
  schedule: "0 12 * * 1"
  prompt: "Run bun outdated and report any critical updates."
```

### .env

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_OWNER_ID=12345678
NGROK_AUTHTOKEN=2abc...           # Optional: enables webhook mode
NGROK_DOMAIN=mybot.ngrok.dev      # Optional: stable URL
ANTHROPIC_API_KEY=sk-ant-...
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `spawnbot setup` | Interactive onboarding wizard |
| `spawnbot daemon` | Start the autonomous daemon |
| `spawnbot doctor` | Check configuration and dependencies |
| `spawnbot reset-session` | Clear daemon session (fresh conversation on next start) |
| `spawnbot run "message"` | One-shot: send a message and get a response |
| `spawnbot session` | Manage sessions |
| `spawnbot auth` | Manage LLM provider credentials |
| `spawnbot models` | List available models |

All commands: `spawnbot --help`

## Memory System

The agent has a long-term memory backed by SQLite with FTS5 full-text search.

### How it works

1. **Agent-initiated** — The agent can explicitly call `memory_store` to save important information (preferences, decisions, facts).
2. **Automatic recall** — Before each LLM turn, relevant memories are retrieved via FTS5 and injected into the system prompt.
3. **Compaction flush** — When a long conversation is compacted (summarized), key sections are automatically saved as memories.
4. **Decay** — Memory importance decays over time (0.995x per hour), bottoming at 0.05. Memories are never deleted by decay.

### Memory tools

| Tool | Purpose |
|------|---------|
| `memory_store` | Save a memory with content, category, importance (0-1) |
| `memory_recall` | Full-text search across memories |
| `memory_browse` | Browse by category, sorted by importance |
| `memory_delete` | Remove a specific memory |

Categories: `general`, `factual`, `preference`, `emotional`, `task`, `relationship`, `interaction`.

## Skills and Tools

Spawnbot can extend itself at runtime by creating skills and tools.

### Skills (prompt-level knowledge)

A skill is a `SKILL.md` file with instructions the agent can load on demand. Create them in `.spawnbot/skills/`:

```
.spawnbot/skills/
  deploy-app/
    SKILL.md
  write-thread/
    SKILL.md
```

The agent has a built-in `create-skill` meta-skill that teaches it the format.

### Tools (executable code)

A tool is a TypeScript file in `.spawnbot/tools/` using the `@kilocode/plugin` format:

```typescript
import { tool } from "@kilocode/plugin"

export default tool({
  description: "Generate an image using DALL-E",
  args: {
    prompt: tool.schema.string().describe("Image description"),
  },
  async execute(args, ctx) {
    // Your logic here
    return "Image saved to output.png"
  },
})
```

Tools are discovered on session start. The agent has a built-in `create-tool` meta-skill that teaches it the format.

### Built-in skills

| Skill | Purpose |
|-------|---------|
| `create-skill` | Teaches the agent how to create new SKILL.md files |
| `create-tool` | Teaches the agent how to create custom TypeScript tools |
| `coding-best-practices` | Universal tool usage, code style, and workflow guidance |

## System Prompt

The system prompt is kept minimal:

1. **SOUL.md** — Identity and personality (the only always-on prompt)
2. **Environment** — Working directory, platform, paths to knowledge files
3. **Memories** — Auto-recalled relevant memories (~2000 tokens max)

Provider-specific prompts, coding guidelines, and other instructions are available as skills loaded on demand — not permanently in the system prompt.

## Architecture

```
spawnbot daemon
  ├── SOUL.md → System prompt (personality, rules)
  ├── Session (SQLite) → Persistent conversation history
  ├── Memory (SQLite + FTS5) → Long-term recall with auto-inject
  ├── Input Queue (priority-based) → Routes events to the LLM session
  │     ├── Telegram messages (critical priority)
  │     ├── Cron jobs (normal priority)
  │     └── Idle loop prompts (low priority)
  ├── Telegram (grammY) → Webhook (ngrok) or long polling
  ├── Tools (22 built-in + custom) → bash, read, write, memory, telegram, etc.
  ├── Skills (built-in + user) → On-demand prompt knowledge
  └── Vercel AI SDK → Anthropic, OpenAI, Google, DeepSeek, Groq, etc.
```

Key design decisions:
- **Single process** — No subprocesses, no IPC. The LLM runs in-process via Vercel AI SDK.
- **SQLite for everything** — Sessions, messages, memories, state. One file, zero infrastructure.
- **SOUL.md is king** — One file defines behavior. No scattered config.
- **Self-managed** — The agent maintains its own SKILLS.md index and can create skills/tools at runtime.
- **Auto-approve** — The daemon runs with all permissions granted. SOUL.md is the safety gate.

## Development

```bash
# Run in dev mode (with debug logging)
bun run src/index.ts daemon --print-logs --log-level DEBUG

# Type check
bun run typecheck

# Run tests
bun run test

# Database tools
bun run src/index.ts db
```

## Troubleshooting

### `spawnbot doctor`

Run the diagnostic command to check your setup:

```bash
bun run src/index.ts doctor
```

It checks: config directories, SOUL.md, .env, API tokens, data directory, and daemon session state.

### Logs

Logs are written to `~/.local/share/spawnbot/log/`. Use `--print-logs` to also print to stderr.

### Fresh start

To reset the daemon's conversation history:

```bash
bun run src/index.ts reset-session
```

The agent will start a new conversation on the next daemon start, but memories persist.

## License

MIT — See [LICENSE](LICENSE) for details.

Based on [Kilo Code](https://github.com/Kilo-Org/kilocode) and [opencode](https://github.com/sst/opencode).
