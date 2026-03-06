# spawnbot v1 — Codebase Audit

## Concrete Bugs

### Bug 1 — Wire spawn readiness is a polling timer, not a real signal
`lib/wire/client.js:130-147` — Resolves 100ms after process appears alive, not after Kimi CLI is ready for JSON-RPC. Comment says "wait for stdout output" but code doesn't check stdout.

### Bug 2 — Config singleton not reset between contexts
`lib/config/index.js:9-10` — `_config` cached at module level. Low severity since child processes start fresh.

### Bug 3 — Dual conversation logging
`lib/daemon/index.js:128-134` + `lib/mcp/core/server.js:376-387` — Daemon auto-logs turns AND agent has `convo_log` tool. Leads to duplicates. Tool should be renamed `convo_annotate` or removed.

### Bug 4 — `flow_start` HTTP loopback has no timeout
`lib/mcp/core/server.js:769-791` — HTTP request to daemon with no timeout. Can deadlock the MCP server which deadlocks Kimi CLI which deadlocks the daemon.

### Bug 5 — `_fixLogPermissions` deletes unwritable log files
`lib/logger.js:43-56` — Silently deletes root-owned log files instead of attempting chmod. Loses diagnostic data.

### Bug 6 — `_attemptRecovery` doesn't emit `wire_ready`
`lib/daemon/index.js:707-732` — Creates new WireClient but doesn't emit `wire_ready`, so foreground display goes dark during recovery.

### Bug 7 — `fs.watch` recursive not reliable on Linux
`lib/daemon/index.js:793-819` — `watch(configDir, { recursive: true })` uses inotify on Linux which doesn't support recursive. Changes to `config/agent/system.md` may not trigger.

## Fragility Hotspots

- **Wire protocol is a black box** — No schema validation, undocumented event types, no version compat check
- **Singleton DB** — `initDatabase()` silently ignores path if already initialized
- **Dynamic import caching** — Poller modules cached by ES runtime, no reload mechanism
- **Ngrok reconnect** — `this.running` never set to true on initial failure, so reconnect never fires

## Innovations Worth Keeping

### Priority Input Queue (`lib/input/queue.js`)
4-level priority (critical > high > normal > low) with FIFO within level. Blocking dequeue via Promise waiters. Clean, correct. Carry forward as-is.

### Source-Attributed Routing (`lib/input/router.js:159-164`)
Every input tagged `[SOURCE from SENDER]: content`. Critical for agent context — LLM knows who sent what. Carry forward. Consider JSON-structured envelope in v2.

### Structured Cron Prompts (`lib/input/cron.js:37-76`)
Per-job `prompt:`, `priority:`, `workspace:`, `flow:` fields in CRONS.yaml. Far superior to generic heartbeat. `workspace: true` auto-adds branch/PR instructions.

### Autonomy Loop (`lib/input/autonomy.js`)
30-min base interval, escalates to 15-min after 2h idle, warning text after 6h. Uses `low` priority so user messages preempt. Carry forward.

### SQLite Memory with FTS5 + Importance Decay (`lib/db/memory.js`)
FTS5 with Porter stemming, importance float (0-1), last_accessed_at tracking, daily decay. Categories: emotional, factual, preference, interaction, task, relationship. Combined rank: `(rank * -1) * importance DESC`.

### Poller Manager (`lib/input/poller-manager.js`)
Generic contract: `poll(lastState) → { events, newState }`. SQLite state persistence under `poller_state_${name}`. Carry forward.

### MCP Config Hot-Reload
After each turn, checks mcp.json mtime. If modified (agent used `tool_create`), restarts Wire client. One-turn delay acceptable.

### MCP Pre-flight Validation (`lib/daemon/index.js:566-632`)
Checks binary existence + Node.js syntax before starting Kimi CLI. Removes invalid servers from mcp.json. Prevents daemon failure from bad community MCP.

### Wire Display (`lib/wire/display.js`)
Live streaming terminal UI for thinking, tool calls, content. Returns `detach()` for clean teardown.

### Flow Engine (`lib/flow/parser.js`, `lib/flow/runner.js`)
Mermaid flowchart parser + runner. Each node = full LLM turn with tool access. Decision retry via `<choice>LABEL</choice>`. Innovative — Mermaid as workflow DSL.

## Unnecessary Complexity / Dead Code

- `lib/personality/loader.js` — Never imported, dead code
- `@modelcontextprotocol/sdk` in package.json — Never imported
- `lib/mcp/telegram/bot.js` — Thin re-export layer, flatten
- `tool_create` / `tool_install_community` / `tool_remove` — Complex runtime tool creation with circular deps
- `setWebhook` in `lib/telegram/bot.js` — Never called, dead code
- `formatJobNotification` in `lib/telegram/bot.js` — Never called, dead code

## Wire Protocol Issues

1. **Subprocess restart loses conversation history** — Full reasoning chain gone, only explicit memory_store calls survive
2. **Version negotiation one-directional** — Client sends 1.3, ignores server response version
3. **No steer queue** — Concurrent steer calls race
4. **--yolo non-negotiable** — No granular tool approval, safeword is only gate

## Config Sprawl

Essential (keep): SOUL.yaml, CRONS.yaml, integrations.yaml, .env
Consolidate: system.md template into framework (not user-editable)
Drop to skills: GOALS.yaml, PLAYBOOK.yaml
Artifacts (generated): rendered-system.md, mcp.json

## System Prompt Assessment

~800-1000 tokens rendered. Strong: autonomy instructions, input format, tool guidance.
Bloated: memory instructions (too prescriptive), session continuity (duplicates orientation), flow skills (only relevant during flows).
Missing: response length guidance, confirmation vs autonomous action guidance.

## Essential Files

| File | Purpose |
|------|---------|
| `lib/daemon/index.js` | Central orchestrator, lifecycle, restart |
| `lib/wire/client.js` | Wire protocol subprocess client |
| `lib/wire/handler.js` | Wire event routing, auto-approval |
| `lib/input/queue.js` | Priority queue |
| `lib/input/router.js` | Turn lifecycle: dequeue → format → prompt → response |
| `lib/input/autonomy.js` | Autonomy loop with idle escalation |
| `lib/input/poller-manager.js` | Generic integration polling |
| `lib/input/cron.js` | Structured cron with flow/workspace support |
| `lib/mcp/core/server.js` | All core agent tools |
| `lib/db/memory.js` | FTS5 memory search with importance decay |
| `lib/persona/prompt-builder.js` | System prompt rendering |
| `lib/persona/mcp-config.js` | MCP config generation |
| `lib/input/telegram-listener.js` | Telegram input adapter |
| `lib/flow/runner.js` | Flow execution engine |
| `lib/flow/parser.js` | Mermaid flowchart parser |
