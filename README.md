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

## Quick Install

```bash
# 1. Install bun (skip if you already have it)
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc

# 2. Install spawnbot
curl -fsSL https://raw.githubusercontent.com/dawnforge-lab/spawnbot/main/install.sh | bash
```

The installer will:
1. Clone spawnbot to `~/.spawnbot`
2. Install all dependencies
3. Add `spawnbot` to your PATH
4. Create a default `SOUL.md` for you to review

### Manual Install

```bash
git clone https://github.com/dawnforge-lab/spawnbot.git ~/.spawnbot
cd ~/.spawnbot
bun install
export PATH="$HOME/.spawnbot/bin:$PATH"  # add to ~/.bashrc or ~/.zshrc
spawnbot
```

## Getting Started

### 1. Launch spawnbot

```bash
spawnbot
```

This opens the TUI. Connect a provider when prompted, then type `/setup` to start the onboarding wizard.

### 2. That's it

There's only one command you need to remember: `spawnbot`.

- **Very first run** — no provider configured yet, so it opens a standalone TUI. Use `/connect` to add an API key.
- **After provider is set** — `spawnbot` starts the daemon in the background (Telegram, cron, autonomy) + opens the TUI attached to it
- **Close the terminal** — daemon keeps running, Telegram still works
- **Run `spawnbot` again** — daemon already running, TUI just reconnects
- **`spawnbot stop`** — stops the background daemon

The `/setup` command walks you through an interactive conversation to:
- Name your agent and co-create its personality with the LLM
- Configure Telegram (bot token + owner ID)
- Add optional API keys (OpenAI for Whisper + embeddings)
- Schedule cron jobs
- Install optional skills (image generation, TTS, Gmail, etc.)
- Set up autostart (systemd/launchd)

This creates files in the workspace (`~/.spawnbot/workspace/`):
- `SOUL.md` — Operating instructions + agent identity (co-created with LLM)
- `USER.md` — Information about you
- `GOALS.md` — Current objectives
- `PLAYBOOK.md` — Action templates
- `.env` — API keys and secrets
- `spawnbot.json` — Provider and model config

### 3. Talk to your agent

- **Terminal** — just type in the TUI
- **Telegram** — send a message to your bot

Both flow into the same conversation. The agent sees `[telegram]` prefix for Telegram messages so it knows the source.

## Commands

| Command | Description |
|---------|-------------|
| `spawnbot` | Start daemon (if needed) + open TUI |
| `spawnbot stop` | Stop the background daemon |
| `spawnbot restart` | Restart the daemon |
| `spawnbot status` | Check if the daemon is running |
| `spawnbot logs` | Show recent log output |
| `spawnbot logs -f` | Follow logs in real time |
| `spawnbot doctor` | Check configuration and dependencies |
| `spawnbot run "message"` | One-shot: send a message and get a response |
| `spawnbot reset` | Clear conversation history (fresh start) |

### TUI Commands

Type these in the TUI prompt:

| Command | Description |
|---------|-------------|
| `/setup` | Run the onboarding wizard |
| `/help` | Show help and keyboard shortcuts |
| `/connect` | Add or manage LLM provider API keys |
| `/models` | Switch between available models |
| `/compact` | Summarize a long session near context limits |
| `/undo` / `/redo` | Undo or redo the last message and file changes |
| `/new` | Start a fresh conversation session |
| `/sessions` | List and continue previous conversations |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+Shift+V` | Paste text from clipboard |
| `Ctrl+T` | Cycle model variants |
| `Tab` | Cycle agents (Build, Plan, etc.) |
| `Ctrl+P` | Open command palette |
| `Ctrl+X E` | Open external editor |
| `Shift+Enter` | New line in prompt |
| `Escape` | Stop the AI mid-response |
| `Ctrl+C` | Clear input (press twice to exit) |
| `PageUp/PageDown` | Scroll conversation |

### Advanced Commands

| Command | Description |
|---------|-------------|
| `spawnbot daemon` | Start daemon in foreground (for debugging) |
| `spawnbot daemon --dry-run` | Validate config and exit |
| `spawnbot auth` | Manage LLM provider credentials |
| `spawnbot models` | List available models |
| `spawnbot session` | Manage sessions |
| `spawnbot --help` | Show all available commands |

## Requirements

- An LLM provider API key (e.g. `ANTHROPIC_API_KEY`)
- Optional: A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Optional: [ngrok](https://ngrok.com/) account for Telegram webhooks
- Optional: `OPENAI_API_KEY` for voice transcription (Whisper) and vector embeddings

## Configuration

All config lives in the workspace directory (`~/.spawnbot/workspace/` by default) or `~/.config/spawnbot/` (global). Workspace takes priority.

### Directory Layout

```
~/.spawnbot/                        # Install dir (git repo — code only)
  ├── src/
  ├── bin/
  └── node_modules/

~/.spawnbot/workspace/              # Agent workspace (default, configurable)
  ├── SOUL.md                       # Operating instructions + identity
  ├── USER.md                       # About the owner
  ├── GOALS.md                      # Current objectives
  ├── PLAYBOOK.md                   # Action templates
  ├── SKILLS.md                     # Skills index (agent-maintained)
  ├── .env                          # API keys and secrets
  ├── CRONS.yaml                    # Scheduled jobs
  ├── POLLERS.yaml                  # Feed pollers
  ├── spawnbot.json                 # Provider/model config
  ├── skills/                       # User skills
  ├── tools/                        # User tools
  └── (agent's work files)
```

Override workspace location with `SPAWNBOT_WORKSPACE` env var or set it in `.env`.

### Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Operating instructions + agent identity |
| `USER.md` | Information about you (the owner) |
| `GOALS.md` | Current objectives and targets |
| `PLAYBOOK.md` | Action templates and procedures |
| `SKILLS.md` | Index of skills and tools (agent-maintained) |
| `CRONS.yaml` | Scheduled jobs |
| `POLLERS.yaml` | Feed/API pollers (e.g. RSS) |
| `.env` | API keys and secrets |
| `spawnbot.json` | Provider, model, and feature config |

### SOUL.md

The most important file. It's inlined into the system prompt on every turn.

Everything above the `---` separator is **operating instructions** (tools, code style, git rules, safety). Everything below is **identity** (name, personality, stop phrase). The `/setup` command only modifies the identity section — it never overwrites your operating instructions.

```markdown
# Spawnbot

You are a capable, autonomous AI agent...

## Tools
- Use dedicated tools over bash...

## Working with code
- Read code before modifying it...

---

# Identity

You are Jarvis, a sharp and efficient AI assistant.

## Personality
- Direct and concise. No filler.
- Proactive — anticipate what I need next.

## Stop Phrase
The phrase "Jarvis, stand down" immediately halts all autonomous actions.
```

You can edit this file directly at any time. Changes take effect on the next conversation turn.

In daemon mode, SOUL.md is **required** — the daemon will throw if it's missing. Run `spawnbot` and type `/setup` to create one.

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

Located in the workspace directory (e.g. `~/.spawnbot/workspace/.env`):

```bash
# LLM Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Custom workspace (default: ~/.spawnbot/workspace/)
# SPAWNBOT_WORKSPACE=~/my-agent

# Telegram (optional)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_OWNER_ID=12345678

# Optional
NGROK_AUTHTOKEN=2abc...           # Enables webhook mode
NGROK_DOMAIN=mybot.ngrok.dev      # Stable webhook URL

# Idle loop tuning (ms, optional)
IDLE_BASE_INTERVAL=1800000        # 30 min default
IDLE_ESCALATION=7200000           # 2h default
IDLE_WARNING=21600000             # 6h default
```

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
|----------|---------|
| `create-skill` | Teaches the agent how to create new SKILL.md files |
| `create-tool` | Teaches the agent how to create custom TypeScript tools |
| `create-poller` | Teaches the agent how to create poller plugins |
| `coding-best-practices` | Universal tool usage, code style, and workflow guidance |
| `autonomous-behavior` | Guidelines for autonomous operation (injected during cron/idle) |

### Optional skills (selected during setup)

| Skill | Purpose |
|----------|---------|
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
spawnbot
  ├── Daemon (background)
  │     ├── Pre-flight validation (SOUL.md, API key)
  │     ├── Session (SQLite) → Persistent conversation + auto-rotation
  │     ├── Input Queue (4-level priority) → Routes events to the LLM session
  │     │     ├── Telegram messages (normal priority)
  │     │     ├── Cron jobs (normal priority)
  │     │     ├── Poller events (normal priority)
  │     │     └── Idle loop prompts (low priority)
  │     ├── Telegram (grammY) → Webhook (ngrok) or long polling
  │     └── Autonomy → Cron, pollers, idle loop, memory decay
  ├── TUI (foreground, attaches to daemon)
  │     ├── Interactive chat → Same session as daemon
  │     ├── SOUL.md → System prompt (operating instructions + identity)
  │     ├── Memory (SQLite + FTS5 + vectors) → Long-term recall with auto-inject
  │     └── Tools (22 built-in + custom) → bash, read, write, memory, telegram, etc.
  └── Vercel AI SDK → Anthropic, OpenAI, Google, DeepSeek, Groq, etc.
```

Key design decisions:
- **No fallbacks** — Errors are transparent, never hidden. Config parse failures throw.
- **Single command** — `spawnbot` handles everything. Daemon auto-starts, TUI auto-attaches.
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
spawnbot doctor
```

Checks: config directories, SOUL.md (existence + content validation), .env, API tokens, CRONS.yaml syntax, POLLERS.yaml syntax, data directory, database, and daemon session state.

### Logs

```bash
# Show recent logs
spawnbot logs

# Follow logs in real time
spawnbot logs -f
```

Log files are stored in `~/.local/share/spawnbot/log/`.

### Fresh start

To reset the agent's conversation history:

```bash
spawnbot reset
```

The agent will start a new conversation on the next start, but memories persist.

### Common issues

| Problem | Solution |
|---------|----------|
| Agent won't start | Run `spawnbot doctor` to identify missing config |
| "SOUL.md not found" | Run `spawnbot` and type `/setup`, or create `SOUL.md` in the workspace |
| "No LLM provider API key" | Add `*_API_KEY` to `.env` in the workspace or use `/connect` in TUI |
| Telegram not connecting | Check `TELEGRAM_BOT_TOKEN` in `.env` |
| Queue full messages | Agent is busy — messages are processed sequentially |
| YAML parse error | Fix syntax in `CRONS.yaml` or `POLLERS.yaml` |
| Can't paste text | Use `Ctrl+Shift+V` for text, `Ctrl+V` for images |

## Updating

```bash
cd ~/.spawnbot
git pull
bun install
spawnbot stop && spawnbot
```

Or re-run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/dawnforge-lab/spawnbot/main/install.sh | bash
```

## Uninstalling

```bash
# Stop the agent
spawnbot stop

# Remove the installation
rm -rf ~/.spawnbot

# Remove the PATH entry from your shell config (~/.bashrc, ~/.zshrc, etc.)
# Look for the line: export PATH="$HOME/.spawnbot/bin:$PATH"

# Optionally remove data
rm -rf ~/.local/share/spawnbot
rm -rf ~/.config/spawnbot
```

## License

MIT — See [LICENSE](LICENSE) for details.

Based on [Kilo Code](https://github.com/Kilo-Org/kilocode) and [opencode](https://github.com/sst/opencode).
