# Spawnbot

An autonomous AI agent that lives in your terminal and talks to you on Telegram. It can write code, run commands, remember things, learn new skills, and operate on a schedule — all without supervision.

Built on [Kilo Code CLI](https://github.com/Kilo-Org/kilocode) (which builds on [opencode](https://github.com/sst/opencode)). Spawnbot strips the interactive TUI focus and adds the daemon layer: Telegram, memory, autonomy, and self-extending skills/tools.

## What It Does

- **Telegram integration** — Chat with your agent from anywhere. Supports webhooks (via ngrok) or long polling.
- **Long-term memory** — SQLite-backed memory with FTS5 full-text search + optional vector embeddings. The agent stores and recalls memories across sessions. Relevant memories are automatically injected into each conversation turn.
- **Session persistence** — Conversation history survives daemon restarts. Sessions auto-rotate after 5 compactions to stay fresh.
- **Autonomy** — Cron jobs, idle loops, and pollers (e.g. RSS feeds) let the agent act on its own schedule.
- **Self-extending** — The agent can create its own skills (prompt-level knowledge) and tools (executable TypeScript) at runtime.
- **Multi-provider** — Works with Anthropic (Claude), OpenAI, Google (Gemini), DeepSeek, Groq, and 15+ other LLM providers via the Vercel AI SDK.
- **20+ built-in tools** — bash, read, write, edit, glob, grep, web fetch, web search, memory, Telegram, and more.

## Requirements

- [Bun](https://bun.sh/) v1.1+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An LLM provider API key (e.g. `ANTHROPIC_API_KEY`)
- Optional: [ngrok](https://ngrok.com/) account for Telegram webhooks
- Optional: `OPENAI_API_KEY` for voice transcription (Whisper) and vector embeddings

## Install

Clone into a dedicated directory (e.g. `~/.spawnbot`):

```bash
git clone https://github.com/dawnforge-lab/spawnbot.git ~/.spawnbot
cd ~/.spawnbot
bun install
```

Optionally add the CLI to your PATH:

```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH="$HOME/.spawnbot/node_modules/.bin:$PATH"
alias spawnbot="bun ~/.spawnbot/src/index.ts"
```

### Build (optional)

Compile to a standalone native binary:

```bash
bun run build
# Output: dist/spawnbot-<platform>-<arch>/bin/spawnbot
```

## Quick Start

### 1. Run the setup wizard

```bash
cd ~/.spawnbot
bun run src/index.ts setup
```

The wizard walks you through 10 steps:
1. Choose LLM provider + validate API key
2. Name your agent
3. Co-create personality with the LLM (multi-turn interview)
4. Configure Telegram (bot token + owner ID)
5. Optional: OpenAI API key for Whisper + embeddings
6. Gemini safety filters (Google provider only)
7. Schedule cron jobs
8. Choose agent model
9. Select optional skills (image generation, TTS, Gmail, etc.)
10. Autostart configuration

This creates `.spawnbot/` in your project directory with:
- `SOUL.md` — Agent personality and behavior (co-created with LLM)
- `USER.md` — Information about you
- `GOALS.md` — Current objectives
- `PLAYBOOK.md` — Action templates
- `.env` — API keys and secrets
- `spawnbot.json` — Provider and model config

### 2. Start the daemon

```bash
bun run src/index.ts daemon
```

The daemon:
1. Validates configuration (SOUL.md, API key, Telegram token)
2. Loads `.spawnbot/.env`
3. Starts ngrok tunnel (if `NGROK_AUTHTOKEN` is set)
4. Resumes or creates a persistent session
5. Connects to Telegram (webhook or long polling)
6. Loads configured pollers (POLLERS.yaml)
7. Starts cron jobs, idle loop, and memory decay
8. Processes incoming messages through the LLM

### 3. Talk to your agent on Telegram

Send a message to your bot. It has full access to your project directory, all tools, and its memory system.

### Dry run

Test your configuration without connecting to Telegram:

```bash
bun run src/index.ts daemon --dry-run
```

## Configuration

All config lives in `.spawnbot/` (project-level) or `~/.config/spawnbot/` (global). Project-level takes priority.

### Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality, behavior rules, core identity |
| `USER.md` | Information about you (the owner) |
| `GOALS.md` | Current objectives and targets |
| `PLAYBOOK.md` | Action templates and procedures |
| `SKILLS.md` | Index of skills and tools (agent-maintained) |
| `CRONS.yaml` | Scheduled jobs |
| `POLLERS.yaml` | Feed/API pollers (e.g. RSS) |
| `.env` | API keys and secrets |
| `spawnbot.json` | Provider, model, and feature config |

### SOUL.md

This is the most important file. It's inlined into the system prompt on every turn. Define your agent's personality, rules, and behavior here.

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

In daemon mode, SOUL.md is **required** — the daemon will throw if it's missing. Run `spawnbot setup` to create one.

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

Parse errors throw immediately — no silent failures.

### POLLERS.yaml

Monitor external feeds:

```yaml
- type: rss
  url: https://example.com/feed.xml
  label: example-blog
  interval: 600  # seconds (default: 10 min)
```

New feed items are enqueued as events for the agent to process.

### .env

```bash
# Required
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_OWNER_ID=12345678

# LLM Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Optional
NGROK_AUTHTOKEN=2abc...           # Enables webhook mode
NGROK_DOMAIN=mybot.ngrok.dev      # Stable webhook URL

# Idle loop tuning (ms, optional)
IDLE_BASE_INTERVAL=1800000        # 30 min default
IDLE_ESCALATION=7200000           # 2h default
IDLE_WARNING=21600000             # 6h default
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `spawnbot setup` | Interactive onboarding wizard (10 steps) |
| `spawnbot daemon` | Start the autonomous daemon |
| `spawnbot daemon --dry-run` | Validate config and exit |
| `spawnbot doctor` | Check configuration, YAML syntax, API keys |
| `spawnbot reset-session` | Clear daemon session (fresh conversation on next start) |
| `spawnbot run "message"` | One-shot: send a message and get a response |
| `spawnbot session` | Manage sessions |
| `spawnbot auth` | Manage LLM provider credentials |
| `spawnbot models` | List available models |

All commands: `spawnbot --help`

## Memory System

The agent has a long-term memory backed by SQLite with FTS5 full-text search and optional OpenAI vector embeddings.

### How it works

1. **Agent-initiated** — The agent calls `memory_store` to save important information (preferences, decisions, facts).
2. **Automatic recall** — Before each LLM turn, relevant memories are retrieved via hybrid search (FTS5 + vector similarity) and injected into the system prompt (~2000 tokens max).
3. **Compaction flush** — When a long conversation is compacted, key sections (discoveries, goals, instructions, accomplished work) are automatically saved as memories.
4. **Decay** — Memory importance decays over time (0.995x per hour), bottoming at 0.05. Memories are never deleted by decay.
5. **Session rotation** — After 5 compactions, the daemon creates a fresh session. Memories carry over seamlessly since they live in the database, not the session.

### Memory tools

| Tool | Purpose |
|------|---------|
| `memory_store` | Save a memory with content, category, importance (0-1) |
| `memory_recall` | Hybrid full-text + semantic search across memories |
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

Tools are discovered on session start.

### Built-in skills

| Skill | Purpose |
|-------|---------|
| `create-skill` | Teaches the agent how to create new SKILL.md files |
| `create-tool` | Teaches the agent how to create custom TypeScript tools |
| `create-poller` | Teaches the agent how to create poller plugins |
| `coding-best-practices` | Universal tool usage, code style, and workflow guidance |
| `autonomous-behavior` | Guidelines for autonomous operation (injected during cron/idle) |

### Optional skills (selected during setup)

| Skill | Purpose |
|-------|---------|
| `image-generation` | Generate images via fal.ai |
| `text-to-speech` | Text-to-speech via Cartesia |
| `gmail` | Read and send Gmail |
| `google-calendar` | Manage Google Calendar events |
| `x-twitter` | Post and read on X/Twitter |
| `reddit` | Browse and post on Reddit |
| `moltbook` | Moltbook integration |

## System Prompt Architecture

The system prompt uses a 3-layer model optimized for provider prompt caching:

1. **Layer 1 (cached)** — Provider prompt + SOUL.md + agent prompt
2. **Layer 2 (dynamic)** — Environment context, docs references
3. **Layer 3 (dynamic)** — Memory context (~2000 tokens, auto-recalled)

Only SOUL.md changes invalidate the prompt cache. Other docs (USER.md, GOALS.md, etc.) are referenced but not inlined — the agent reads them with file tools.

## Architecture

```
spawnbot daemon
  ├── Pre-flight validation (SOUL.md, API key, Telegram)
  ├── SOUL.md → System prompt (personality, rules)
  ├── Session (SQLite) → Persistent conversation + auto-rotation
  ├── Memory (SQLite + FTS5 + vectors) → Long-term recall with auto-inject
  ├── Input Queue (4-level priority) → Routes events to the LLM session
  │     ├── Telegram messages (normal priority)
  │     ├── Cron jobs (normal priority)
  │     ├── Poller events (normal priority)
  │     └── Idle loop prompts (low priority)
  ├── Error handling → Errors delivered back to user, not swallowed
  ├── Telegram (grammY) → Webhook (ngrok) or long polling + retry
  ├── Tools (22 built-in + custom) → bash, read, write, memory, telegram, etc.
  ├── Skills (built-in + user) → On-demand prompt knowledge
  └── Vercel AI SDK → Anthropic, OpenAI, Google, DeepSeek, Groq, etc.
```

Key design decisions:
- **No fallbacks** — Errors are transparent, never hidden. Config parse failures throw.
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
bun test

# Build native binary
bun run build
```

## Troubleshooting

### `spawnbot doctor`

Run the diagnostic command to check your setup:

```bash
bun run src/index.ts doctor
```

Checks: config directories, SOUL.md (existence + content validation), .env, API tokens, CRONS.yaml syntax, POLLERS.yaml syntax, data directory, database, and daemon session state.

### Logs

Logs are written to `~/.local/share/spawnbot/log/`. Use `--print-logs` to also print to stderr.

### Fresh start

To reset the daemon's conversation history:

```bash
bun run src/index.ts reset-session
```

The agent will start a new conversation on the next daemon start, but memories persist.

### Common issues

| Problem | Solution |
|---------|----------|
| Daemon won't start | Run `spawnbot doctor` to identify missing config |
| "SOUL.md not found" | Run `spawnbot setup` or create `.spawnbot/SOUL.md` |
| "No LLM provider API key" | Add `*_API_KEY` to `.spawnbot/.env` |
| Telegram not connecting | Check `TELEGRAM_BOT_TOKEN` in `.env` |
| Queue full messages | Agent is busy — messages are processed sequentially |
| YAML parse error | Fix syntax in `CRONS.yaml` or `POLLERS.yaml` |

## License

MIT — See [LICENSE](LICENSE) for details.

Based on [Kilo Code](https://github.com/Kilo-Org/kilocode) and [opencode](https://github.com/sst/opencode).
