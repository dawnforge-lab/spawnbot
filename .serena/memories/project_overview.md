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

****Phase 2: SOUL System** — COMPLETE. Simplified from YAML to Markdown:
- SOUL.md: Contains ALL operating instructions + agent identity, inlined into system prompt (mtime-cached)
- Operational instructions (tools, code conventions, safety, git) above `---` separator
- Identity section (name, personality, goals, stop phrase) below `---`, populated by /setup
- Provider prompt reduced to 1 line; SOUL.md is the single source of truth for all agent behavior
- USER.md, GOALS.md, PLAYBOOK.md: Referenced in system prompt, agent reads/writes with tools
- Only SOUL.md changes invalidate provider prompt cache; other docs are read on demand
- Searches .spawnbot/ → ~/.config/spawnbot/. Falls back to built-in default.
- User can edit entire SOUL.md to customize any aspect of agent behavior

**Phase 3: Memory System** — COMPLETE. FTS5 full-text search, importance decay, 4 tools (store/recall/browse/delete), context director (token-budgeted injection before each turn). Memory table + FTS5 virtual table created at DB init. Categories: general, factual, preference, emotional, task, relationship, interaction.

**Phase 4: Input & Telegram** — COMPLETE. Priority queue (4 levels, blocking dequeue, 5 tests), input router (source attribution, sequential processing, 5 tests), Telegram listener (grammY, long polling, text/photo/doc, owner verification, message splitting), 3 Telegram tools (tg_send, tg_photo, tg_react), response routing back to originating source.

All phases complete. TypeScript compiles clean (0 errors), 60 tests pass, build produces native binary.

**Remaining work:**
- End-to-end testing with real Telegram token + LLM provider
- Session rotation for long-running daemon
- Poller plugins (framework ready, no pollers registered)
- `--dry-run` mode for daemon testing without Telegram

## Key Design Principles
1. Telegram is core, everything else is an add-on
2. SOUL.yaml defines identity (co-created with LLM during setup)
3. **No fallbacks** — transparent errors that can be fixed, not hidden
4. Auto-approve everything (--auto flag), stop phrase is the safety gate
5. SQLite + YAML hybrid: YAML for identity/config, SQLite for operational state

## Kilo Code Source
Cloned at `/home/eugen-dev/Workflows/kilocode` for reference. Core CLI code is in `packages/opencode/`.
