# Codebase Structure

## Current State (cleaned, pre-fork)
```
spawnbot/
├── CLAUDE.md               # Project instructions
├── LICENSE                  # MIT (Kilo Code + opencode + Dawnforge Lab)
├── .gitignore
├── .mcp.json               # MCP server config (needs updating)
├── .serena/                 # Serena project config + memories
├── .claude/                 # Claude Code auto-memory
└── docs/
    ├── plan-v3-kilocode-fork.md    # MASTER PLAN (7 phases)
    ├── architecture.md              # v2 architecture reference
    ├── delivery-plan.md             # v2 delivery plan reference
    ├── lessons-learned.md           # Cross-codebase lessons
    └── research/
        ├── openclaw-analysis.md
        ├── spawnbot-v1-audit.md
        ├── thepopebot-analysis.md
        ├── picoclaw-analysis.md
        └── v2-architecture-decision.md
```

## Kilo Code Source (reference at /home/eugen-dev/Workflows/kilocode)
Core CLI in `packages/opencode/src/`:
```
agent/          # Agent definitions, prompts (code, plan, debug, orchestrator, ask, explore)
session/        # LLM loop, processor, compaction, history, system prompt
tool/           # bash, read, write, edit, glob, grep, webfetch, websearch, codesearch, task, skill, todo, plan
mcp/            # MCP client (stdio + remote + OAuth)
provider/       # 20+ LLM providers via Vercel AI SDK
storage/        # SQLite + Drizzle ORM
config/         # Config loading (JSONC)
server/         # Hono HTTP API
cli/            # CLI commands (run, serve, agent, mcp, auth, session, etc.)
cli/cmd/tui/    # Terminal UI (~1.8k lines)
permission/     # Permission system with --auto mode
skill/          # Skill system
plugin/         # Plugin system
kilocode/       # Kilo-specific branding/telemetry (TO STRIP)
```

## Key Kilo Code Architecture
- Internal Hono HTTP server + SDK client pattern
- Even CLI mode goes through same API as VS Code extension
- `kilo run --auto "message"` = headless mode
- System prompt: soul.txt + provider-specific prompt + agent prompt + user system
- Tools registered in `src/tool/registry.ts`
- MCP tools namespaced as `{serverName}_{toolName}`
- Sessions persisted in SQLite via Drizzle

## Spawnbot Extensions (added on top of Kilo Code)
- **Self-managed skills + tools system**: Agent can create its own skills (SKILL.md) and tools (.ts files)
  - Built-in meta-skills in `src/skill/builtin/`: `create-skill`, `create-tool`
  - Skills scanned from `.spawnbot/skills/`, `.claude/skills/`, `.agents/skills/`, built-in dir
  - Tools scanned from `.spawnbot/tools/` (via `Config.directories()` → `ToolRegistry`)
  - SKILLS.md added to docs reference (soul/index.ts) alongside GOALS.md, PLAYBOOK.md, USER.md
- **Daemon system**: `src/daemon/index.ts` — loads env, starts ngrok tunnel, creates auto-approve session, wires input router → SessionPrompt
- **Telegram integration**: `src/telegram/listener.ts` — grammY with webhook (ngrok) or long polling modes
- **Tunnel**: `src/tunnel/index.ts` — ngrok SDK integration
- **Setup wizard**: `src/cli/cmd/setup.ts` — interactive onboarding with LLM co-creation (provider setup → API key validation → multi-turn identity interview → Telegram validation → file generation)
- **Doctor**: `src/cli/cmd/doctor.ts` — config/env diagnostics
- **Status API**: `src/server/routes/status.ts` — uptime, queue, cron, pollers, tunnel, memory stats
- **Memory tools**: `src/tool/memory.ts` — memory_store, memory_recall, memory_browse, memory_delete
- **Telegram tools**: `src/tool/telegram.ts` — tg_send, tg_photo, tg_react
- **Custom tools**: `@kilocode/plugin` tool format — `tool({ description, args, execute })` in `.spawnbot/tools/*.ts`
- **Build script**: `script/build.ts` — compiles to native Bun binary with bundled migrations and solid JSX plugin
- **Type stubs**: `src/stubs/telemetry.ts` (Telemetry + Identity), `src/stubs/gateway.ts` (Kilo cloud features), `src/stubs/kilo-gateway.d.ts` (TUI type declarations)
- **Dry-run mode**: `spawnbot daemon --dry-run` — validates config, processes one test event, exits
- **Code cleanup**: All `// kilocode_change` markers removed (402 comments across 70 files), dead Kilo telemetry code deleted
