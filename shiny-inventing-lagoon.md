# Spawnbot v2 — Project Plan & Architecture Decision

## Context

Spawnbot v1 proved that autonomous agents need **structured prompting, not reminders**. But the Wire protocol / Kimi CLI architecture became fragile — subprocess management, restart storms, state bugs. We've analyzed three codebases (spawnbot, OpenClaw, thepopebot) from actual code and operational experience. This document captures findings and proposes the path forward.

## The Decision: Which Foundation?

### Option A: Fork OpenClaw

**What it has (from actual code):**
- TypeScript, production-grade plugin system (40+ extensions)
- Pi SDK embedded (no subprocess — `createAgentSession()` directly)
- 8+ messaging channels (Telegram via grammY, Discord, Slack, Signal, iMessage, WhatsApp)
- Hybrid memory search (BM25 + vector + temporal decay + sqlite-vec)
- Multi-agent routing with per-agent config
- Full web UI (Lit web components — dashboard, config editor, sessions, cron manager, logs)
- Hot-reload config, strict validation, doctor command
- Plugin SDK with tool factories, hooks, channel plugins, provider plugins

**What's wrong (from operational experience):**
- Heartbeat is a gimmick — says "check your file" but doesn't direct the agent
- Markdown memory files get cluttered after days of running
- Session continuity breaks — context lost between sessions
- Reactive by design — waits to be prompted, not truly autonomous
- Heavy on tokens in long runs (injects MEMORY.md + bootstrap files every turn)
- Pi SDK lock-in

**Effort to fix autonomy:** Replace heartbeat runner logic with structured prompting. Replace md memory with SQLite tables (infra already exists). Add priority input queue and source-attributed router as new modules. These are additive changes, not core rewrites.

### Option B: Fork thepopebot

**What it has:**
- JavaScript/Next.js, simpler codebase
- LangGraph + SqliteSaver = truly persistent conversations across restarts
- Web UI with streaming chat (React + Vercel AI SDK)
- Telegram integration, cron scheduler
- GitHub Actions for heavy jobs (parallel, isolated Docker containers)

**What's wrong:**
- **GitHub Actions is mandatory** — can't run jobs locally
- No memory system (only LangGraph thread checkpoints)
- No integration polling, no priority queue
- No plugin system, tools hardcoded
- JavaScript only

**Effort to fix:** Memory, polling, priority queue, plugin system all need building from scratch. GitHub Actions lock-in is architectural — can't be changed without rewriting the core dispatch model.

### Recommendation: Fork OpenClaw

**Why:** OpenClaw has 80% of the infrastructure we need. The 20% that's missing (real autonomy) is spawnbot's core innovation and can be added as new modules without rewriting OpenClaw's internals. Thepopebot's GitHub Actions dependency is a hard constraint we can't work around.

The key insight: OpenClaw's problems are **fixable design choices** (heartbeat logic, md-file memory, token loading). Thepopebot's problems are **architectural constraints** (GitHub Actions, no plugin system, no memory).

---

## Architecture: OpenClaw + Spawnbot Autonomy Layer

```
OpenClaw Gateway (keep)
  ├── Channels (keep — Telegram, Discord, Slack, Web, etc.)
  ├── Plugin System (keep — tool factories, hooks, providers)
  ├── Web UI (keep — Lit components, dashboard, config)
  ├── Config (keep — JSON5, hot-reload, validation)
  ├── Multi-Agent (keep — per-agent routing)
  ├── LLM Engine (keep Pi SDK, wrap for future flexibility)
  │
  ├── AUTONOMY LAYER (NEW — from spawnbot)
  │     ├── Priority Input Queue (critical > high > normal > low)
  │     ├── Source-Attributed Router ([telegram/Eugen], [cron/daily-review])
  │     ├── Structured Cron Prompts (replace heartbeat gimmick)
  │     ├── Autonomy Loop (directed check-ins, not generic reminders)
  │     ├── Poller Manager (integration polling with state persistence)
  │     └── Context Director (token-budgeted context loading per turn)
  │
  ├── MEMORY (REPLACE md files → SQLite-first)
  │     ├── memories table (content, category, importance, decay)
  │     ├── FTS5 search (atomic inserts)
  │     ├── Vector search (keep OpenClaw's hybrid search infra)
  │     ├── Temporal decay (actually scheduled)
  │     └── Conversation history (persistent across sessions)
  │
  └── ONBOARDING (ENHANCE)
        ├── Web-based setup wizard
        ├── One-command install (npm or Docker)
        ├── Template personalities
        └── Guided API key + channel setup
```

---

## Epics & Stories

### Epic 1: Project Setup & Fork
> Fork OpenClaw, establish project identity, verify base functionality

- **S1.1** Fork OpenClaw repo, rebrand (new name TBD or keep spawnbot)
- **S1.2** Set up dev environment (pnpm, TypeScript, tests run)
- **S1.3** Trim unused extensions (voice-call, msteams, matrix, etc. — keep core channels)
- **S1.4** Verify: gateway starts, web UI loads, Telegram connects, agent responds
- **S1.5** Document codebase map — files to keep, modify, replace

### Epic 2: Memory System Overhaul
> Replace md-file memory with SQLite-first, fix spawnbot v1 bugs

- **S2.1** Design memory schema (content, category, importance, access_count, decay_score, timestamps)
- **S2.2** Implement memory CRUD with atomic FTS5 inserts (transaction-wrapped)
- **S2.3** Implement memory tools as OpenClaw plugin tools (store, recall, search)
- **S2.4** Implement temporal decay as scheduled job (configurable half-life)
- **S2.5** Integrate with OpenClaw's vector search for hybrid results
- **S2.6** Add conversation history persistence (survives gateway restarts)
- **S2.7** Implement Context Director — token-budgeted context loading per turn (no more injecting everything)

### Epic 3: Autonomy Engine
> The core innovation — replace reactive heartbeat with directed autonomous behavior

- **S3.1** Implement Priority Input Queue (4 levels, max size, waiter pattern with proper cleanup)
- **S3.2** Implement Source-Attributed Router ([source/sender] tagging on every turn)
- **S3.3** Replace heartbeat runner with Structured Cron Prompts — specific directed instructions
- **S3.4** Implement Autonomy Loop — periodic directed check-ins based on goals/tasks
- **S3.5** Session continuity — load conversation history from SQLite on restart, no orientation prompt
- **S3.6** Implement poller manager (integration contract: poll(lastState) → events + newState)
- **S3.7** Wire autonomy events into OpenClaw's existing channel delivery system

### Epic 4: Onboarding & Setup
> "My mom should be able to install and use it"

- **S4.1** One-command install: `npm install -g spawnbot` or `docker run`
- **S4.2** Web-based setup wizard at localhost/setup
- **S4.3** Wizard Step 1: API key (with provider picker + "get a key" links)
- **S4.4** Wizard Step 2: Agent personality (templates or custom description)
- **S4.5** Wizard Step 3: Telegram connect (optional, guided)
- **S4.6** Wizard Step 4: Agent starts → redirect to chat
- **S4.7** Passwordless sudo (automated during install on Linux)
- **S4.8** Doctor command (port from spawnbot + enhance)

### Epic 5: Terminal Interface
> CLI interaction alongside web UI

- **S5.1** `spawnbot chat` — terminal REPL that connects to running gateway
- **S5.2** Streaming display: text, tool calls, thinking indicators
- **S5.3** CLI commands: start, stop, status, doctor, config, logs
- **S5.4** Service management: systemd install/uninstall (port from spawnbot)

### Epic 6: Integration Framework
> Pluggable add-ons using OpenClaw's plugin system

- **S6.1** Define integration contract (poller + tools, built on OpenClaw plugin SDK)
- **S6.2** Integration loader from config (hot-reloadable via OpenClaw's config watcher)
- **S6.3** Reference integration: Twitter/X (port from spawnbot)
- **S6.4** Reference integration: GitHub webhooks (port from spawnbot)
- **S6.5** Documentation: how to create an integration

### Epic 7: Production Hardening
> Reliable always-on operation

- **S7.1** Structured logging with categories (port from spawnbot logger)
- **S7.2** Token usage tracking and budgeting per turn
- **S7.3** Error recovery without restart storms
- **S7.4** Rate limiting per channel
- **S7.5** Log rotation and cleanup
- **S7.6** Health monitoring dashboard in web UI

---

## Delivery Plan

| Phase | Epics | Duration | Milestone |
|-------|-------|----------|-----------|
| **Phase 1: Foundation** | E1 | Week 1 | Fork running, Telegram works, web UI loads |
| **Phase 2: Memory** | E2 | Week 2-3 | SQLite memory with search, conversation persistence |
| **Phase 3: Autonomy** | E3 | Weeks 3-5 | Structured prompting, priority queue, directed crons |
| **Phase 4: Onboarding** | E4 | Week 5-6 | Web setup wizard, one-command install |
| **Phase 5: CLI** | E5 | Week 6-7 | Terminal REPL + service management |
| **Phase 6: Integrations** | E6 | Week 7-8 | Poller system + reference integrations |
| **Phase 7: Hardening** | E7 | Ongoing | Logging, monitoring, recovery |

## Decisions Made

- **Foundation:** Fork OpenClaw
- **Repo:** New repo (old spawnbot stays as reference)
- **Language:** TypeScript (OpenClaw is already TS)

## Open Questions

1. **Project name?** Keep "spawnbot" or rebrand?
2. **Keep OpenClaw plugin SDK compatibility?** If yes, community plugins work. If no, simpler codebase.
3. **Docker-first or bare Node.js for "my mom" install?**
4. **Pi SDK lock-in** — wrap it behind an interface from day one, or address later?
