# Spawnbot v2 — Delivery Plan

## Goal

An autonomous AI agent daemon that is **autonomous** (acts on its own, escalates when idle), **simple** (one config, one path, minimal setup), and **customizable** ("my mom can do it" — LLM-assisted personality creation).

## Epics Overview

| # | Epic | Description | Core Files |
|---|------|-------------|------------|
| 1 | Foundation | Daemon scaffold, config, CLI, SQLite | ~10 files |
| 2 | Agent Core | LLM calls (multi-provider), tool system, turn runner | ~8 files |
| 3 | Memory | SQLite + FTS5 + decay, context director | ~5 files |
| 4 | Input System | Priority queue, router, source attribution | ~4 files |
| 5 | Telegram & ngrok | grammY listener, delivery, ngrok tunnel | ~5 files |
| 6 | Autonomy | Autonomy loop, cron scheduler, poller manager | ~5 files |
| 7 | Onboarding | LLM co-creation, setup wizard, GitHub agent repo | ~6 files |
| 8 | Web UI | Dashboard for monitoring, config, logs | ~5 files |
| 9 | Doctor & Polish | Diagnostics, logging, error handling | ~3 files |

---

## Epic 1: Foundation

**Goal:** A running TypeScript daemon with config loading, SQLite, CLI, and logging.

### Stories

**S1.1 — Project bootstrap**
- `package.json` with dependencies (better-sqlite3, yaml, commander, tsx, vitest)
- `tsconfig.json` (strict, ESM, NodeNext)
- Directory structure: `src/{daemon,agent,input,memory,telegram,pollers,config,setup,doctor,db}`

**S1.2 — Config loader**
- Load `config.yaml` + `SOUL.yaml` + `.env` from `~/.spawnbot/`
- TypeScript types for config shape
- Runtime validation (no AJV/Zod — simple type checks)
- `SPAWNBOT_HOME` env var override

**S1.3 — SQLite database**
- better-sqlite3 initialization
- Schema: memories, memories_fts, conversations, tasks, state
- Auto-create tables on first run

**S1.4 — Logger**
- Tagged logger (component → prefixed output)
- File logging to `data/logs/spawnbot.log`
- Log rotation (size-based)
- Levels: debug, info, warn, error

**S1.5 — CLI entry point**
- `spawnbot start` — start daemon (foreground or background)
- `spawnbot stop` — stop daemon (PID file)
- `spawnbot status` — check if running
- `spawnbot setup` — run onboarding wizard
- `spawnbot doctor` — run diagnostics

**S1.6 — Daemon lifecycle**
- PID file management
- Graceful shutdown (SIGTERM, SIGINT)
- Port management (HTTP health endpoint)
- Process state tracking

### Acceptance
- `spawnbot start` starts a daemon that logs "ready" and stays alive
- `spawnbot stop` stops it cleanly
- `spawnbot status` reports running/stopped
- Config loaded from `~/.spawnbot/config.yaml`
- SQLite DB created at `~/.spawnbot/data/agent.sqlite`

---

## Epic 2: Agent Core

**Goal:** The agent can receive a prompt, call any configured LLM provider, execute tools, and return a response.

### Stories

**S2.1 — Multi-provider LLM integration**
- Vercel AI SDK (`ai` package) for provider-agnostic LLM calls
- Provider packages: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`
- Provider + model resolved from `config.yaml` (e.g., `provider: deepseek`, `model: deepseek-chat`)
- Support for any OpenAI-compatible API via custom base URL
- Streaming responses via `streamText()`
- Tool use via Vercel AI SDK tool definitions
- Token counting from response
- Error handling (rate limits, network errors, provider-specific)

**S2.2 — System prompt builder**
- Build from SOUL.yaml + config at runtime
- Sections: identity, personality, voice, safety, goals, playbook, memory instructions, tool guidance, autonomy instructions, date/time
- Cache with mtime invalidation

**S2.3 — Tool system**
- Tool registry with Zod parameter schemas (Vercel AI SDK pattern)
- Tool execution with context (db, config, telegram client)
- Built-in tools: `memory_store`, `memory_recall`, `memory_browse`, `memory_delete`
- Tool call logging

**S2.4 — Turn runner**
- Load conversation history from SQLite
- Build messages array (system + history + new input)
- LLM call → tool execution loop → final response
- Log conversation turn to SQLite
- Max iterations guard

**S2.5 — Conversation history**
- SQLite-based (not JSONL)
- Load last N turns for context
- Token-aware truncation
- Auto-summarization when history grows large (defer to Epic 3)

### Acceptance
- Can send a prompt and get a response from any configured provider
- Switch providers by changing `config.yaml` (no code change)
- Tools execute and results feed back to LLM
- Conversation logged to SQLite
- System prompt built from SOUL.yaml

---

## Epic 3: Memory

**Goal:** Long-term memory with FTS5 search, importance decay, and token-budgeted context loading.

### Stories

**S3.1 — Memory store/recall**
- `memory_store(content, category, importance)` — insert into memories + FTS5
- `memory_recall(query, limit)` — FTS5 search with importance weighting
- `memory_browse(category, limit)` — list by category
- `memory_delete(id)` — remove from both tables
- Categories: emotional, factual, preference, task, relationship, interaction

**S3.2 — Importance decay**
- Periodic decay (configurable interval, default 24h)
- `importance *= decay_factor` (default 0.95)
- `last_accessed_at` updated on recall
- Memories below `min_importance` (0.01) auto-deleted
- Access count tracking (frequently accessed memories decay slower)

**S3.3 — Context Director**
- Before each turn: retrieve relevant memories via FTS5
- Token budget (configurable, default 2000 tokens)
- Rank by combined score: `fts5_rank * importance`
- Prepend to conversation as context
- Port from OpenClaw Epic 2 pattern

**S3.4 — Conversation auto-logging**
- Log every turn: source, sender, input, output, tools_used, tokens
- Queryable history for context loading

### Acceptance
- Agent can store and recall memories across sessions
- Importance decays over time
- Relevant memories auto-loaded before each turn
- All conversations logged to SQLite

---

## Epic 4: Input System

**Goal:** Priority-based input processing with source attribution.

### Stories

**S4.1 — Priority queue**
- 4 levels: critical > high > normal > low
- FIFO within each level
- Blocking dequeue (Promise waiter)
- Max size per level (configurable)

**S4.2 — Input router**
- Dequeue loop: take highest priority event
- Format with source attribution: `[SOURCE from SENDER]: content`
- Hand to agent turn runner
- Sequential processing (one turn at a time)

**S4.3 — Source attribution**
- Every input tagged with origin
- Formats: `[telegram from Name]`, `[cron/job-name]`, `[autonomy]`, `[poller/name from sender]`
- Included in conversation logging

### Acceptance
- High priority events processed before low priority
- Every agent turn has source attribution in context
- Queue doesn't grow unbounded

---

## Epic 5: Telegram & ngrok

**Goal:** Full Telegram integration with optional ngrok tunnel for webhook mode.

### Stories

**S5.1 — Telegram listener**
- grammY bot with long polling (default) or webhook
- Text, photo, voice, document handling
- Owner verification (Telegram user ID from config)
- Message → InputEvent at `normal` priority

**S5.2 — Telegram delivery**
- Send text responses (with Markdown formatting)
- Send photos (with caption)
- React to messages
- Message splitting for long responses
- Error handling (rate limits, network)

**S5.3 — Telegram tools**
- `tg_send(text, chat_id?)` — send message
- `tg_photo(url_or_path, caption?, chat_id?)` — send photo
- `tg_react(message_id, emoji)` — add reaction

**S5.4 — ngrok tunnel**
- Start ngrok tunnel on daemon start (when `ngrok.enabled: true`)
- Expose local webhook endpoint to public URL
- Auto-configure Telegram webhook URL from ngrok tunnel
- Support static domain (for stable webhook URLs)
- Graceful shutdown (close tunnel on daemon stop)
- Health check: verify tunnel is alive
- `NGROK_AUTHTOKEN` from `.env`

### Acceptance
- Send a Telegram message → agent responds in Telegram
- Agent can proactively send messages via tools
- Photos and media handled
- Only allowed users can interact
- With ngrok enabled: webhook mode works via public tunnel URL
- Without ngrok: long polling mode works out of the box

---

## Epic 6: Autonomy

**Goal:** The agent acts on its own — checks in when idle, runs scheduled jobs, polls integrations.

### Stories

**S6.1 — Autonomy loop**
- Idle tracking (updated on each user/channel turn)
- Base interval: 30 min check-ins
- Escalation: 15 min after 2h idle, WARNING after 6h
- Directed prompts (review tasks, check for work, take initiative)
- `low` priority (yields to everything)

**S6.2 — Cron scheduler**
- croner-based
- Jobs from `config.yaml` with schedule, prompt, priority
- Source: `cron/{job-name}`
- Timezone support

**S6.3 — Poller manager**
- Load poller modules from `pollers/` directory
- Contract: `poll(lastState) → { events, newState }`
- State persisted as JSON files
- Events enqueued at their declared priority
- High/critical events trigger immediate processing

### Acceptance
- Leave agent idle → check-in prompt after 30 min
- After 2h idle → more frequent, more urgent check-ins
- Cron jobs fire on schedule
- Custom poller can be added as a `.ts` file in `pollers/`

---

## Epic 7: Onboarding

**Goal:** "My mom can do it" setup experience with LLM-assisted personality creation, GitHub agent repo, and one-command deployment.

### Stories

**S7.1 — Setup wizard**
- `spawnbot setup` command
- Single path: LLM provider → name + purpose → co-creation → Telegram → ngrok → GitHub → smoke test
- Creates `~/.spawnbot/` with all config files
- Re-runnable (merges with existing config)

**S7.2 — LLM provider selection**
- Choose provider: Anthropic, OpenAI, Google, DeepSeek, custom (OpenAI-compatible)
- Enter API key (masked input)
- Validate with test API call
- Write to `.env` and `config.yaml`

**S7.3 — LLM co-creation**
- Via Vercel AI SDK `streamText()` with configured provider (not subprocess)
- Streaming conversation display
- Setup assistant prompt guides through: Personality → Voice → Safety → Goals → Playbook
- Outputs structured SOUL.yaml
- Fallback to defaults if LLM call fails

**S7.4 — Telegram auto-detection**
- Validate bot token via `getMe`
- Poll `getUpdates` for chat ID auto-detection (2 min timeout)
- Fallback to manual entry
- Test message send

**S7.5 — ngrok setup (optional)**
- Ask if user wants webhook mode (vs long polling)
- If yes: prompt for ngrok authtoken
- Optional: static domain for stable URLs
- Write to `.env` and `config.yaml`

**S7.6 — GitHub agent repo (optional)**
- Check `gh` CLI is installed and authenticated
- Create repo (name defaults to agent name, kebab-cased)
- Choose visibility (private/public)
- Generate `.github/workflows/spawnbot.yml` — GitHub Actions workflow for:
  - Scheduled agent tasks (cron-triggered via Actions)
  - Webhook event processing
  - Agent health monitoring
- Generate `.gitignore`, `README.md`
- Initial commit + push
- Print webhook setup instructions

**S7.7 — Smoke test**
- Validate config
- Test LLM connection with configured provider
- Run test prompt ("Who are you? Say hello in one sentence")
- Test Telegram connection
- Report results

### Acceptance
- `spawnbot setup` guides user through complete setup
- Any supported LLM provider works for co-creation
- LLM helps create SOUL.yaml interactively
- Telegram configured with minimal manual input
- ngrok tunnel optional for webhook mode
- GitHub repo created with Actions workflow (optional)
- Smoke test confirms everything works

---

## Epic 8: Web UI

**Goal:** A lightweight web dashboard for monitoring, configuration, and interaction.

### Stories

**S8.1 — HTTP server**
- Hono (or similar lightweight framework) serving on configurable port
- Serves both API endpoints and rendered HTML
- Bearer token auth (from config)
- Accessible via ngrok tunnel or local network

**S8.2 — Dashboard page**
- Agent status (running, uptime, last activity)
- Recent conversations (source, input preview, timestamp)
- Memory stats (total, by category, decay status)
- Task overview (pending, active, completed counts)
- Queue status (events per priority level)

**S8.3 — Chat interface**
- Send messages to agent from browser
- Streaming response display
- Source shown as `[web from User]`
- Conversation history view

**S8.4 — Config viewer**
- View current config.yaml and SOUL.yaml (read-only initially)
- View active cron jobs and their last run status
- View active pollers and their state

**S8.5 — Log viewer**
- Tail recent log entries
- Filter by level (debug, info, warn, error)
- Auto-refresh

### Acceptance
- Web UI accessible at configured port
- Dashboard shows real-time agent status
- Can chat with agent from browser
- Config and logs viewable
- Protected by auth token

---

## Epic 9: Doctor & Polish

**Goal:** Diagnostics, error handling, production readiness.

### Stories

**S9.1 — Doctor command**
- Check Node.js version
- Validate config files exist and parse
- Test SQLite database
- Test LLM provider API key (whichever is configured)
- Test Telegram bot token + chat ID
- Test ngrok tunnel (if enabled)
- Check daemon status (PID file, port)
- Check disk space, log size
- Report pass/fail/warn with explanations

**S9.2 — Error handling**
- LLM rate limit → backoff + retry (provider-agnostic via Vercel AI SDK)
- Network errors → retry with exponential backoff
- Telegram errors → log + continue
- ngrok errors → log + fallback to polling mode
- SQLite errors → transparent error (no fallback)
- Unhandled rejections → log + continue daemon

**S9.3 — Logging polish**
- Structured logging with timestamps
- Log rotation
- Debug mode (verbose tool call logging)
- `spawnbot logs` command (tail log file)

### Acceptance
- `spawnbot doctor` reports actionable diagnostics
- Daemon handles transient errors without crashing
- Logs are useful for debugging

---

## Dependency Summary

| Package | Purpose | Size Impact |
|---------|---------|-------------|
| `ai` | Vercel AI SDK core | Light |
| `@ai-sdk/anthropic` | Claude provider | Light |
| `@ai-sdk/openai` | OpenAI/DeepSeek provider | Light |
| `@ai-sdk/google` | Gemini provider | Light |
| `grammy` | Telegram bot | Light |
| `better-sqlite3` | SQLite database | Medium (native) |
| `yaml` | Config parsing | Light |
| `croner` | Cron scheduling | Light |
| `commander` | CLI framework | Light |
| `@ngrok/ngrok` | Tunnel for webhooks | Light |
| `hono` | HTTP server for web UI | Light |
| `zod` | Schema validation (Vercel AI SDK tools) | Light |
| `tsx` | TypeScript dev runner | Dev only |
| `vitest` | Test framework | Dev only |
| `oxlint` | Linter | Dev only |
| `typescript` | Compiler | Dev only |

**Total runtime deps: ~11** (ai SDK + 3 providers, grammy, better-sqlite3, yaml, croner, commander, ngrok, hono, zod)

---

## Delivery Order & Dependencies

```
Epic 1: Foundation ──────────────────────┐
                                         │
Epic 2: Agent Core ──────────────────────┤
                                         │
Epic 3: Memory ──────────────────────────┤ (needs Epic 2 for tools)
                                         │
Epic 4: Input System ────────────────────┤ (needs Epic 2 for turn runner)
                                         │
Epic 5: Telegram & ngrok ───────────────┤ (needs Epic 4 for queue)
                                         │
Epic 6: Autonomy ────────────────────────┤ (needs Epic 4 for queue)
                                         │
Epic 7: Onboarding ─────────────────────┤ (needs Epics 2, 5 for smoke test)
                                         │
Epic 8: Web UI ─────────────────────────┘ (needs Epics 1-6 running)

Epic 9: Doctor & Polish ── (anytime, parallel track)
```

**Critical path:** Foundation → Agent Core → Input System → Telegram & ngrok → Autonomy

**MVP (minimum to be useful):** Epics 1-5 = daemon + multi-LLM + memory + queue + Telegram + ngrok

---

## What We're NOT Building (Yet)

- Plugin system (direct imports, not extensible architecture)
- Multiple channels (Telegram only, add Discord/Slack later)
- Hook system (direct function calls)
- Hot-reload (restart the daemon)
- Config validation framework (TypeScript types + runtime checks)
- MCP server support (can add later)
- Multi-agent / subagents (can add later)
