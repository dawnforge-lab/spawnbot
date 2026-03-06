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
