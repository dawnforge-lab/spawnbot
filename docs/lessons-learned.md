# Lessons Learned

Distilled from building spawnbot v1, forking OpenClaw (3 epics), and studying thepopebot and picoclaw.

---

## LLM Integration

### What failed
- **Wire protocol subprocess (spawnbot v1):** Spawning Kimi CLI as a child process via JSON-RPC over stdin/stdout. Black box — no schema validation, undocumented event types, no version compat check. Subprocess restart loses entire conversation history. Only explicit `memory_store` calls survive. Recovery doesn't emit `wire_ready`, so displays go dark. Polling-based readiness check (100ms timer instead of actual stdout signal).
- **Pi SDK dependency (OpenClaw):** Proprietary `@mariozechner/pi-*` packages at v0.55.3. Tightly coupled — `createAgentSession()` owns the entire LLM lifecycle. Replacing it would be the biggest surgery in the codebase. Opaque session management, JSONL transcripts on disk, custom compaction logic.

### What works
- **Direct API calls:** Both Anthropic SDK and OpenAI SDK are well-typed, streaming-capable, and provider-specific. No abstraction layer needed for a single-agent system.
- **Vercel AI SDK (thepopebot):** Clean provider-agnostic abstraction with streaming, tool calls, structured output. Good if you need multi-provider support. Adds a dependency but it's well-maintained.

### Decision for v2
Use **Vercel AI SDK** (`ai` + provider packages). Provider-agnostic from day 1 — switch between Claude, GPT-4o, Gemini, DeepSeek, or local models via config. Cost optimization: use cheap models for routine tasks, expensive models for complex reasoning. No custom abstraction layer — Vercel AI SDK IS the abstraction.

---

## Memory System

### What failed
- **Markdown files on disk (OpenClaw):** Agent's `memory/` dir contains markdown files indexed into SQLite. File-watching via chokidar. Brittle — file system is the source of truth, index is derived. No structured metadata, no importance tracking, no decay.
- **JSONL sessions (PicoClaw/OpenClaw):** Append-only, no search, grows unbounded. Auto-summarization helps but loses detail.

### What works
- **SQLite FTS5 + importance decay (spawnbot v1):** FTS5 with Porter stemming, importance float (0-1), `last_accessed_at` tracking, daily decay. Categories: emotional, factual, preference, interaction, task, relationship. Combined rank: `(rank * -1) * importance DESC`. Clean, queryable, maintainable.
- **Hybrid search (OpenClaw):** BM25 + vector + temporal decay + MMR re-ranking. Production-grade but complex (requires embedding providers, sqlite-vec extension).
- **Context Director (OpenClaw Epic 2):** Token-budgeted memory loading into system prompt. Retrieves relevant memories, fits within budget, prepends to context. Proven pattern.

### Decision for v2
**SQLite + FTS5 + importance decay.** Start with text search (FTS5), add vector search later if needed. Port the Context Director pattern for token-budgeted recall. Use `better-sqlite3` (not `node:sqlite` which requires Node 22.12+).

---

## Autonomy

### What failed
- **HEARTBEAT.md gimmick (OpenClaw):** Reads a markdown file on a timer. No structure, no escalation, no priority. "Check your file" is not autonomy.
- **Pure cron (PicoClaw):** Fires prompts on schedule. No awareness of idle time, no escalation, no priority.

### What works
- **Idle escalation (spawnbot v1 → OpenClaw Epic 3):** 30-min base interval, escalates to 15-min after 2h idle, WARNING after 6h. Yields to higher-priority events. Directed check-in prompts (not "check your file" but "you've been idle for X, review tasks, take action").
- **Priority queue (spawnbot v1):** 4 levels (critical > high > normal > low) with FIFO within level. Blocking dequeue via Promise waiters. Autonomy uses `low` priority so user messages always preempt.
- **Source attribution (spawnbot v1 → OpenClaw Epic 3):** Every input tagged `[SOURCE from SENDER]: content`. LLM knows who sent what and why.

### Decision for v2
Port all three: **priority queue + autonomy loop + source attribution.** These are proven, ~300 lines total. Already designed and tested in OpenClaw Epics 2-3.

---

## Configuration

### What failed
- **JSON5 + AJV + Zod + hot-reload (OpenClaw):** Three validation layers for config. Over-engineered for a single-agent system. Hot-reload is nice but adds complexity. Config migrations system needed because schema evolves.
- **Config singleton not reset between contexts (spawnbot v1):** Module-level cache, subtle bug.
- **Config sprawl (spawnbot v1):** SOUL.yaml, CRONS.yaml, integrations.yaml, agent.yaml, sub.yaml, system.md, GOALS.yaml, PLAYBOOK.yaml, .env — too many files.

### What works
- **YAML for identity (spawnbot v1):** SOUL.yaml with structured personality data (traits 1-10, voice, safety, goals, playbook). Human-readable, mergeable, LLM-generatable.
- **Single config file (PicoClaw):** One `config.json` for everything. Simple. But JSON is unfriendly for humans.
- **Env var substitution (OpenClaw):** `${VAR_NAME}` in config resolved from environment. Clean for secrets.

### Decision for v2
**Two files:** `config.yaml` (agent config, channels, cron, integrations) + `SOUL.yaml` (personality, co-created with LLM). Secrets in `.env`. No validation framework — TypeScript types + runtime checks. No hot-reload (restart is fine for a daemon).

---

## Channels

### What failed
- **Plugin-based channel loading (OpenClaw):** jiti-based TypeScript plugin system. Powerful but complex — manifest files, config schemas, hook registration, lazy tool factories. Each channel is a full extension with its own package.json.
- **Hardcoded channels (PicoClaw):** 13 channels compiled into binary. Adding one = code change + rebuild. No dynamic loading.

### What works
- **grammY for Telegram (OpenClaw):** Proven library with `sequentialize` + `apiThrottler`. Webhook (preferred) or long polling. Photo, voice, document, sticker handling.
- **Single primary channel (spawnbot v1):** Telegram as the control plane. Everything else is an add-on poller, not a first-class channel.

### Decision for v2
**Telegram first via grammY.** Built directly into the daemon, not as a plugin. Add Discord/Slack later as simple adapters (same interface, different transport). No plugin system — direct imports.

---

## Onboarding

### What failed
- **Form-based wizard (OpenClaw):** Interactive CLI with @clack/prompts. Many options (quickstart/advanced/manual, 20+ CLI flags, Tailscale modes, auth modes). Powerful but overwhelming. Not "mom can do it."
- **Empty bootstrap files (OpenClaw):** Generates blank SOUL.md, IDENTITY.md, USER.md. User has to fill them manually with no guidance.

### What works
- **LLM-assisted co-creation (spawnbot v1):** Spawns the LLM itself during setup. Conversational flow where LLM suggests personality traits based on agent's stated purpose. Guides through Voice → Safety → Goals → Playbook. Outputs structured YAML between markers. Not a questionnaire — an actual creative collaboration.
- **Smoke testing (spawnbot v1):** Validates config, renders prompt, tests LLM connection, runs test prompt ("Who are you?") before finishing. Catches errors before the user thinks setup is done.
- **Telegram auto-detection (spawnbot v1):** After entering bot token, polls `getUpdates` for 2 minutes to auto-detect chat ID. User just sends a message to the bot.

### Decision for v2
Port the **LLM co-creation flow** as the primary onboarding. Steps: (1) API key, (2) agent name + purpose, (3) LLM co-creates SOUL.yaml, (4) Telegram setup with auto-detect, (5) smoke test. No advanced/manual/quickstart modes — one path.

---

## Deployment

### What failed
- **Subprocess management (spawnbot v1):** Spawning Kimi CLI, managing PID files, Wire protocol, recovery on crash. Fragile. `_attemptRecovery` doesn't emit `wire_ready`. `fs.watch` recursive doesn't work on Linux.
- **Ngrok reconnect bug (spawnbot v1):** `this.running` never set to true on initial failure, so reconnect never fires.

### What works
- **systemd service (both):** Standard Linux service management. OpenClaw uses `openclaw daemon install`, spawnbot uses custom sudoers setup.
- **Single process (PicoClaw):** No subprocess, no IPC, no recovery logic. The daemon IS the agent. Simpler.

### Decision for v2
**Single process daemon.** No subprocess. The daemon makes LLM API calls directly. systemd for auto-start. PID file for `spawnbot status`. No passwordless sudo — keep it simple, user runs `sudo` themselves if needed.

---

## System Prompt

### What failed
- **Template with ${VARIABLES} (spawnbot v1):** 170+ line template with `${IDENTITY_NAME}`, `${PERSONALITY_TRAITS}`, etc. Requires a rendering pipeline. Changes to SOUL.yaml require re-rendering. Generated file (`rendered-system.md`) is an artifact that can get stale.
- **Flat markdown concatenation (OpenClaw):** Reads SOUL.md + IDENTITY.md + TOOLS.md, concatenates into system prompt. No structure, no variables, no control over ordering.

### What works
- **Dynamic prompt building from structured data (OpenClaw Epic 2):** Context Director builds prompt at runtime from structured memory data with token budgeting. No file artifacts.
- **System prompt caching with mtime invalidation (PicoClaw):** Caches built prompt, invalidates when source files change. Avoids rebuilding every turn.

### Decision for v2
**Build system prompt at runtime from SOUL.yaml + config.** No template file, no rendering pipeline, no artifacts. Function that reads structured data and returns a prompt string. Cache with mtime check on SOUL.yaml.

---

## Over-Engineering Traps

1. **Plugin system before you have plugins.** OpenClaw's jiti plugin system is powerful but we don't need it. We're building ONE agent, not a platform. Direct imports are simpler.
2. **25+ hooks before you have hook consumers.** Most hooks had zero or one consumer. Start with function calls, add hooks when you have 3+ consumers.
3. **Config validation framework.** AJV + Zod + JSON5 for a config file. TypeScript types + a `validateConfig()` function is enough.
4. **WebSocket protocol with ECDSA auth.** For a locally-running daemon. HTTP with a bearer token is fine.
5. **Hot-reload everything.** Restart the daemon. It takes <1 second.
6. **Abstraction for hypothetical future.** "What if we need 5 LLM providers?" — we don't. Use Anthropic SDK directly.

---

## Innovation Inventory (Carry Forward)

| Innovation | Source | Lines | Status |
|-----------|--------|-------|--------|
| Priority Input Queue | spawnbot v1 | ~100 | Proven, port as-is |
| Source Attribution | spawnbot v1 → OC Epic 3 | ~30 | Proven, port as-is |
| Autonomy Loop (idle escalation) | spawnbot v1 → OC Epic 3 | ~150 | Proven, port as-is |
| Poller Manager | spawnbot v1 → OC Epic 3 | ~150 | Proven, port as-is |
| SQLite Memory + FTS5 + decay | spawnbot v1 → OC Epic 2 | ~300 | Proven, port as-is |
| Context Director (token-budgeted) | OC Epic 2 | ~200 | Proven, port as-is |
| LLM Co-Creation Onboarding | spawnbot v1 | ~400 | Proven, redesign for direct API |
| Structured Cron Prompts | spawnbot v1 | ~100 | Proven, port as-is |
| SOUL.yaml Personality | spawnbot v1 | ~50 | Proven, port as-is |
| Smoke Test on Setup | spawnbot v1 | ~50 | Proven, port as-is |
| System Prompt Caching (mtime) | PicoClaw | ~30 | Good idea, implement |
| Auto-Summarization | PicoClaw | ~50 | Good idea, implement |
| Skills Marketplace | PicoClaw | ~100 | Defer to later |
