# spawnbot — Project Overview

## Purpose
Autonomous AI agent framework built on **Kimi CLI** (Apache 2.0). A Node.js daemon that spawns Kimi CLI via its Wire protocol (bidirectional JSON-RPC over stdin/stdout) and provides the integration layer for external services, memory, and autonomous operation.

**Core insight:** We don't build a reasoning engine — Kimi CLI IS the reasoning engine. spawnbot is the thin daemon that feeds it inputs, provides tools via MCP servers, and manages the autonomous loop.

## Tech Stack
- **Language:** JavaScript (ES Modules, `"type": "module"`)
- **Runtime:** Node.js >= 20.0.0
- **No TypeScript** — plain .js files throughout
- **Database:** SQLite via `better-sqlite3` + Drizzle ORM
- **Telegram:** grammy + @grammyjs/parse-mode
- **MCP:** @modelcontextprotocol/sdk (stdio-based MCP servers)
- **CLI prompts:** @inquirer/prompts
- **Config:** YAML files (yaml package)
- **Cron:** node-cron
- **License:** Apache-2.0

## Architecture
```
Agent Daemon (Node.js)
  ├── Core: Telegram listener, cron scheduler, autonomy loop
  ├── Generic Poller Manager (loads integrations.yaml)
  ├── Input Queue (priority-based)
  └── Wire Protocol Client (JSON-RPC 2.0 over stdin/stdout)
        └── Kimi CLI (--wire --agent-file agent.yaml)
              ├── System Prompt: from SOUL.yaml
              ├── Built-in tools: bash, read, write, glob, grep, fetch
              └── MCP Servers (stdio): Telegram, Agent Tools, Add-ons
```

## Key Design Principles
1. Telegram is core, everything else is an add-on
2. Each integration = MCP server + poller
3. Generic poller system via integrations.yaml
4. Wire protocol (JSON-RPC 2.0), not ACP
5. Auto-approve everything (--yolo flag), stop phrase is the safety gate
6. SQLite + YAML hybrid: YAML for identity/config, SQLite for operational state
7. **No fallbacks** — transparent errors that can be fixed, not hidden
8. **All media saved to disk** — photos, videos, voice, documents all saved to data/media/ with file paths sent as plain text to LLM (Wire protocol only accepts strings)
9. **Auto-logged conversations** — every turn_end is automatically logged to the `conversations` table in SQLite
10. **Startup orientation** — on every Wire connect (including crash-restarts), the agent is prompted to self-orient using its tools (convo_history, memory_search, task_list, read config files)
11. Default agent directory: `~/.spawnbot/agent/` — commands auto-resolve if CWD has no config/