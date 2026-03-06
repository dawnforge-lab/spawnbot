# Spawnbot v3 — Kilo Code Fork Plan

## Strategy

Fork Kilo Code CLI (`@kilocode/cli`, MIT license) as the agentic reasoning engine. Strip Kilo-specific branding/telemetry, keep the battle-tested core (session management, tools, MCP, providers, TUI), and add spawnbot's daemon layer on top (Telegram, autonomy, memory, cron, onboarding).

## Why Fork Instead of Build From Scratch

The v2 delivery plan (docs/delivery-plan.md) called for building Epics 1-2 from scratch: daemon scaffold, LLM integration, tool system, turn runner, conversation history. Kilo Code already provides all of this at production quality (~51k lines), plus:

- 20+ LLM providers via Vercel AI SDK
- Mature tool runtime (bash, file ops, glob, grep, web fetch, web search, LSP)
- First-class MCP support (stdio + remote + OAuth)
- Session management with compaction and history
- Permission system with auto-approve mode
- Agent/subagent architecture
- TUI interface
- SQLite storage via Drizzle ORM
- Headless CLI mode (`run --auto --format json`)

Building this from scratch would take months. Forking gives us the engine on day 1.

## What Changes From v2 Plan

| v2 Plan | v3 (Fork) Approach |
|---------|-------------------|
| Epic 1: Foundation (daemon, config, CLI, SQLite) | **Inherited** from Kilo Code. Adapt config to add spawnbot-specific fields |
| Epic 2: Agent Core (LLM, tools, turn runner) | **Inherited** from Kilo Code entirely |
| Epic 3: Memory (FTS5, decay, context director) | **Build** — this is spawnbot-specific. Add as extension to Kilo's storage |
| Epic 4: Input System (priority queue, router) | **Build** — wraps Kilo's `session.prompt()` |
| Epic 5: Telegram & ngrok | **Build** — Telegram as MCP server + listener feeding the input queue |
| Epic 6: Autonomy (loop, cron, pollers) | **Build** — feeds input queue, triggers `session.prompt()` |
| Epic 7: Onboarding | **Build** — replaces Kilo's auth/setup with SOUL.yaml co-creation wizard |
| Epic 8: Web UI | **Inherited** — Kilo has Hono server + API. Extend with dashboard |
| Epic 9: Doctor & Polish | **Adapt** — extend Kilo's existing diagnostics |

**Net effect:** Epics 1-2 go from "build" to "inherit". We focus entirely on what makes spawnbot unique.

## Runtime

**Bun** (not Node.js). Kilo Code is built on Bun. The Bun-specific APIs (`Bun.serve`, `Bun.file`, `bun-pty`, `Bun.which`, etc.) are used in ~43 call sites. Migrating to Node.js is possible but unnecessary — Bun is faster startup, native TypeScript, and the ecosystem is stable enough for a CLI/daemon.

## Monorepo vs Single Package

**Flatten to single package.** Kilo Code is a monorepo with 16 packages. We only need `packages/opencode/` (the CLI core). Extract it as the root package, drop the rest.

Workspace packages to evaluate:
- `@kilocode/kilo-gateway` — Auth/API gateway. **Strip** (replace with simple API key config)
- `@kilocode/kilo-telemetry` — PostHog telemetry. **Strip**
- `@kilocode/plugin` — Plugin system. **Keep** (tools are plugins)
- `@kilocode/sdk` — Client SDK for driving the server. **Keep** (used by `run` command)
- `@opencode-ai/util` — Error handling utils. **Inline** what we need

---

## Phase 1: Fork & Strip (Foundation)

**Goal:** A working CLI that builds, runs, and has all Kilo branding removed.

### 1.1 — Extract from monorepo
- Copy `packages/opencode/` as project root
- Inline needed code from workspace dependencies (`@kilocode/sdk`, `@opencode-ai/util`)
- Update `package.json` — rename to `spawnbot`, remove workspace references
- Verify `bun install` and `bun run dev` work

### 1.2 — Strip Kilo telemetry
- Remove `@kilocode/kilo-telemetry` imports and all `Telemetry.*` calls
- Remove `@kilocode/kilo-gateway` imports and all gateway auth
- Remove Kilo-specific config migrations (`ModesMigrator`, `RulesMigrator`, `WorkflowsMigrator`, `McpMigrator`, `IgnoreMigrator`)
- Remove Kilo OAuth/auth flow (keep provider API key auth)
- Remove `kilocode/` directory (except `soul.txt` concept — replaced in Phase 2)

### 1.3 — Rebrand
- CLI name: `spawnbot` (was `kilo` / `opencode`)
- Config directory: `~/.spawnbot/` (was `~/.config/opencode/`)
- Config file: `spawnbot.json` or adapt to `config.yaml` + `SOUL.yaml`
- Binary: `spawnbot` in package.json bin
- TUI branding: logo, colors, about text
- Error messages, help text

### 1.4 — Verify core functionality
- `spawnbot run "hello"` works with at least one provider
- Tools work: bash, read, write, edit, glob, grep, web fetch
- MCP servers can be configured and connected
- TUI works: `spawnbot` (interactive mode)
- Sessions persist in SQLite

### Acceptance
- Clean build with no Kilo references in runtime code
- All core CLI features work under `spawnbot` name
- No telemetry phone-home

---

## Phase 2: SOUL System (Identity & Personality)

**Goal:** Replace Kilo's generic `soul.txt` with spawnbot's SOUL.yaml personality system.

### 2.1 — SOUL.yaml schema
- Define TypeScript types for SOUL.yaml (identity, personality, voice, safety, goals, playbook)
- YAML loader with validation
- Default SOUL.yaml for new installs

### 2.2 — System prompt injection
- Replace `SystemPrompt.soul()` (which reads `soul.txt`) with SOUL.yaml renderer
- Build structured prompt sections: identity, personality traits (1-10 scale), voice style, safety rules, goals, playbook
- Cache with mtime invalidation on SOUL.yaml
- Merge with provider-specific prompts (keep Kilo's per-provider prompt tuning)

### 2.3 — Agent personality in TUI
- Show agent name and tagline in TUI header
- Agent-specific welcome message

### Acceptance
- SOUL.yaml defines agent personality
- System prompt dynamically built from SOUL.yaml
- Personality visible in TUI and responses

---

## Phase 3: Memory System

**Goal:** Long-term memory with FTS5 search, importance decay, and token-budgeted context loading.

### 3.1 — Memory schema
- Add tables to Kilo's SQLite: `memories`, `memories_fts` (FTS5)
- Drizzle migration
- CRUD operations: store, recall (FTS5), browse (by category), delete

### 3.2 — Memory tools
- Register as built-in tools (same pattern as Kilo's existing tools):
  - `memory_store(content, category, importance)`
  - `memory_recall(query, limit)`
  - `memory_browse(category, limit)`
  - `memory_delete(id)`
- Categories: emotional, factual, preference, task, relationship, interaction

### 3.3 — Importance decay
- Background timer (configurable interval, default 24h)
- `importance *= decay_factor` (default 0.95)
- Access tracking (`last_accessed_at`, `access_count`)
- Auto-delete below `min_importance` threshold

### 3.4 — Context Director
- Before each turn: retrieve relevant memories via FTS5
- Token budget (configurable, default 2000 tokens)
- Rank by `fts5_rank * importance`
- Inject as system prompt section
- Hook into Kilo's `Plugin.trigger("experimental.chat.system.transform")`

### Acceptance
- Agent stores and recalls memories across sessions
- Relevant memories auto-loaded before each turn
- Old memories decay unless frequently accessed

---

## Phase 4: Input System & Telegram

**Goal:** Priority-based input processing with Telegram as the primary channel.

### 4.1 — Priority queue
- 4 levels: critical > high > normal > low
- FIFO within each level
- Blocking dequeue (Promise waiter)
- Max size per level

### 4.2 — Input router
- Dequeue loop → format with source attribution → call `session.prompt()`
- Source formats: `[telegram from Name]`, `[cron/job-name]`, `[autonomy]`
- Sequential processing (one turn at a time)

### 4.3 — Telegram MCP server
- grammY-based MCP server (stdio transport)
- Tools: `tg_send`, `tg_photo`, `tg_react`
- Auto-configured in spawnbot's MCP config

### 4.4 — Telegram listener
- grammY bot with long polling (default) or webhook
- Text, photo, voice, document handling
- Owner verification (Telegram user ID from config)
- Messages -> InputEvent at `normal` priority -> queue

### 4.5 — Response delivery
- Route agent responses back to originating Telegram chat
- Message splitting for long responses
- Markdown formatting

### 4.6 — ngrok tunnel (optional)
- Start tunnel when `ngrok.enabled: true`
- Auto-configure Telegram webhook URL
- Static domain support

### Acceptance
- Telegram message -> agent processes -> responds in Telegram
- High priority events processed before low priority
- Agent can proactively send via `tg_send` tool

---

## Phase 5: Autonomy & Scheduling

**Goal:** The agent acts on its own when idle, runs scheduled jobs, polls integrations.

### 5.1 — Autonomy loop
- Idle tracking (updated on each user/channel turn)
- Base interval: 30 min check-ins
- Escalation: 15 min after 2h idle, WARNING after 6h
- Directed prompts via `low` priority queue events

### 5.2 — Cron scheduler
- croner-based
- Jobs from config with schedule, prompt, priority
- Source: `cron/{job-name}`

### 5.3 — Poller manager
- Load poller modules from `pollers/` directory
- Contract: `poll(lastState) -> { events, newState }`
- State persisted in SQLite `state` table
- Events enqueued at declared priority

### Acceptance
- Idle agent checks in after 30 min
- Cron jobs fire on schedule
- Custom pollers can be added as `.ts` files

---

## Phase 6: Onboarding

**Goal:** "My mom can do it" setup with LLM-assisted personality creation.

### 6.1 — Setup wizard
- `spawnbot setup` command
- Single path: LLM provider -> name + purpose -> co-creation -> Telegram -> smoke test

### 6.2 — LLM co-creation
- Use Vercel AI SDK `streamText()` with configured provider
- Conversational flow: Personality -> Voice -> Safety -> Goals -> Playbook
- Outputs structured SOUL.yaml

### 6.3 — Telegram auto-detection
- Validate bot token via `getMe`
- Poll `getUpdates` for chat ID auto-detection
- Test message send

### 6.4 — Smoke test
- Validate config, test LLM, test Telegram
- Run test prompt

### Acceptance
- Complete setup in one `spawnbot setup` run
- SOUL.yaml created collaboratively with LLM
- Everything validated before first start

---

## Phase 7: Polish & Dashboard

**Goal:** Web dashboard, diagnostics, production readiness.

### 7.1 — Extend Hono server with dashboard
- Agent status, recent conversations, memory stats
- Chat interface (web -> input queue)
- Config viewer

### 7.2 — Doctor command
- `spawnbot doctor` — check config, DB, LLM, Telegram, daemon
- Extend Kilo's existing debug infrastructure

### 7.3 — Deployment
- systemd service file
- Install script
- Log rotation

### Acceptance
- Web dashboard shows agent status
- `spawnbot doctor` gives actionable diagnostics

---

## Delivery Order

```
Phase 1: Fork & Strip ---------> Working CLI under spawnbot name
Phase 2: SOUL System ----------> Personality-driven agent
Phase 3: Memory System --------> Long-term memory with FTS5
Phase 4: Input & Telegram -----> Telegram control plane + priority queue
Phase 5: Autonomy & Scheduling > Self-directed operation
Phase 6: Onboarding -----------> Easy setup wizard
Phase 7: Polish & Dashboard ---> Production ready
```

**MVP (minimum useful):** Phases 1-4 = CLI with personality + memory + Telegram

---

## What We Get For Free (From Kilo Code)

- 20+ LLM providers (Anthropic, OpenAI, Google, Bedrock, Azure, Groq, xAI, OpenRouter...)
- Mature tools: bash (PTY), file ops, glob, grep (ripgrep), web fetch, web search, code search
- MCP client (stdio + remote + OAuth)
- Session management with compaction and auto-summarization
- Agent/subagent architecture (orchestrator, explore, debug agents)
- Permission system with `--auto` mode
- TUI with themes
- SQLite + Drizzle ORM
- Headless mode (`spawnbot run --auto "message"`)
- LSP integration for code diagnostics
- Skill system
- Plan mode
- Git-aware (worktrees, snapshots)

## What We Build (Spawnbot-Specific)

- SOUL.yaml personality system
- Memory with FTS5 + importance decay + context director
- Priority input queue + source attribution
- Telegram integration (listener + MCP server)
- Autonomy loop (idle escalation)
- Cron scheduler
- Poller manager
- LLM co-creation onboarding
- ngrok tunnel for webhooks
- Web dashboard extension

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Kilo Code is built on Bun; faster startup, native TS |
| Base | Kilo Code CLI fork | 51k lines of battle-tested agentic tooling |
| License | MIT | Inherited from Kilo Code |
| Config | config.yaml + SOUL.yaml + .env | Two YAML files + secrets |
| Database | SQLite via Drizzle (inherited) | Extend with memory tables |
| Telegram | grammY as MCP server + listener | Proven, well-typed |
| Tunnel | ngrok | Simple webhook exposure |
| No fallbacks | Transparent errors | Core principle from v1 |

## Files to Carry From Current Repo

- `docs/` — Research and analysis documents (move to new structure)
- `.serena/` — Serena project memories
- `CLAUDE.md` — Project instructions (update for new structure)
- `README.md` — Update for new project
- `.mcp.json` — MCP config (update)
