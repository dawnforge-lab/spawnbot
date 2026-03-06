# spawnbot — Project Overview

## Purpose
Autonomous AI agent framework forked from **Kilo Code CLI** (MIT license). Adds personality (SOUL.yaml), long-term memory, Telegram integration, and autonomous operation on top of Kilo Code's battle-tested agentic CLI.

**Core insight:** Kilo Code CLI IS the reasoning engine (session management, tools, MCP, 20+ LLM providers). spawnbot adds personality, memory, Telegram, and autonomy on top.

## Tech Stack
- **Runtime:** Bun
- **Language:** TypeScript (ES Modules)
- **Base:** Kilo Code CLI fork (`@kilocode/cli` v7.0.39, from `packages/opencode/` in Kilo monorepo)
- **LLM:** Vercel AI SDK (`ai`) + 20+ provider packages (Anthropic, OpenAI, Google, Bedrock, Azure, Groq, xAI, etc.)
- **Database:** SQLite via Drizzle ORM
- **MCP:** @modelcontextprotocol/sdk (stdio + remote + OAuth)
- **Telegram:** grammY (to be added)
- **HTTP:** Hono (inherited from Kilo Code)
- **TUI:** @opentui/solid (inherited from Kilo Code)
- **Config:** YAML (config.yaml + SOUL.yaml) + .env
- **Cron:** croner (to be added)
- **Tunnel:** ngrok (to be added)
- **License:** MIT

## Current Status
**Phase 1: Fork & Strip** — COMPLETE. Kilo Code CLI extracted, telemetry/gateway stubbed, imports rewritten, user-facing strings rebranded to spawnbot. CLI boots and shows help. Config files use `spawnbot.json`, config dirs use `.spawnbot/`, mDNS uses `spawnbot.local`. Legacy `kilo.json`/`opencode.json` still supported as fallback.

**Phase 2: SOUL System** — COMPLETE. Simplified from YAML to Markdown:
- SOUL.md: Agent identity/personality, inlined into system prompt (mtime-cached)
- USER.md, GOALS.md, PLAYBOOK.md: Referenced in system prompt, agent reads/writes with tools
- Only SOUL.md changes invalidate provider prompt cache; other docs are read on demand
- Searches .spawnbot/ → ~/.config/spawnbot/. Falls back to built-in default.

**Phase 3: Memory System** — COMPLETE. FTS5 full-text search, importance decay, 4 tools (store/recall/browse/delete), context director (token-budgeted injection before each turn). Memory table + FTS5 virtual table created at DB init. Categories: general, factual, preference, emotional, task, relationship, interaction.

Next: Phase 4 (Input system + Telegram integration).

## Key Design Principles
1. Telegram is core, everything else is an add-on
2. SOUL.yaml defines identity (co-created with LLM during setup)
3. **No fallbacks** — transparent errors that can be fixed, not hidden
4. Auto-approve everything (--auto flag), stop phrase is the safety gate
5. SQLite + YAML hybrid: YAML for identity/config, SQLite for operational state

## Kilo Code Source
Cloned at `/home/eugen-dev/Workflows/kilocode` for reference. Core CLI code is in `packages/opencode/`.
