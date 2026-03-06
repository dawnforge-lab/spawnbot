# spawnbot — Autonomous AI Agent Framework

## What This Is

spawnbot is an autonomous AI agent framework built by forking **Kilo Code CLI** (MIT license). It's a Bun/TypeScript daemon that provides a complete agentic CLI with personality (SOUL.yaml), long-term memory, Telegram integration, and autonomous operation.

**The core insight:** We don't build a reasoning engine from scratch. Kilo Code CLI IS the reasoning engine (session management, tools, MCP, 20+ LLM providers). We strip the branding, add personality, memory, Telegram, and autonomy on top.

## Architecture Overview

```
spawnbot CLI (Bun/TypeScript, forked from Kilo Code)
  |
  |- Inherited from Kilo Code:
  |    |- Session management (LLM loop, compaction, history)
  |    |- Tools: bash, read, write, edit, glob, grep, web fetch, web search, LSP
  |    |- MCP client (stdio + remote + OAuth)
  |    |- 20+ LLM providers via Vercel AI SDK
  |    |- TUI interface
  |    |- SQLite + Drizzle ORM
  |    |- Agent/subagent architecture
  |    |- Permission system (--auto mode)
  |    |- Skill system, plan mode
  |
  |- Spawnbot additions:
       |- SOUL.yaml personality system (replaces soul.txt)
       |- Memory: SQLite FTS5 + importance decay + context director
       |- Telegram: grammY listener + MCP server (tg_send, tg_photo, tg_react)
       |- Input queue: priority-based (critical > high > normal > low)
       |- Autonomy loop: idle escalation (30min -> 15min -> WARNING)
       |- Cron scheduler: croner-based scheduled prompts
       |- Poller manager: pluggable integration polling
       |- Onboarding: LLM co-creation wizard for SOUL.yaml
       |- ngrok tunnel: optional webhook mode for Telegram
```

## Key Principles

1. **Telegram is core, everything else is an add-on.** Telegram is the primary control channel. X, Reddit, etc. are pluggable pollers.
2. **SOUL.yaml defines identity.** Personality, voice, safety, goals — all in one YAML file, co-created with LLM during setup.
3. **No fallbacks.** Transparent errors that can be fixed, not hidden.
4. **Auto-approve everything.** The agent runs with `--auto` flag. Stop phrase (in SOUL.yaml) is the safety gate.
5. **SQLite + YAML hybrid.** YAML for identity/config. SQLite for operational state.

## Project Status

**Phase 1: Fork & Strip** — In progress. See `docs/plan-v3-kilocode-fork.md` for full plan.

## Key Files

- `docs/plan-v3-kilocode-fork.md` — Master plan (7 phases)
- `docs/architecture.md` — v2 architecture reference (being superseded by fork plan)
- `docs/delivery-plan.md` — v2 delivery plan reference (being superseded by fork plan)
- `docs/lessons-learned.md` — What worked/failed across all codebases
- `docs/research/` — Analysis of OpenClaw, thepopebot, picoclaw, spawnbot v1

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime | Bun |
| Language | TypeScript |
| LLM | Vercel AI SDK (`ai`) + 20+ provider packages |
| Telegram | grammY |
| Database | SQLite via Drizzle ORM |
| MCP | @modelcontextprotocol/sdk |
| Config | YAML (config.yaml + SOUL.yaml) + .env |
| Cron | croner |
| HTTP | Hono |
| Tunnel | ngrok |
| TUI | @opentui/solid (inherited from Kilo Code) |

## Development

```bash
bun install          # Install dependencies
bun run dev          # Start in dev mode
bun run build        # Build for production
```

## CRITICAL: No fallbacks — transparent errors that can be fixed, not hidden
## Update relevant serena memories after each commit
