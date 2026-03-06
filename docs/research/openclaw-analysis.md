# OpenClaw Codebase Analysis

## Project Structure

```
openclaw/
├── src/                    # Core TypeScript source
│   ├── agents/             # Agent runner, tools, session management, Pi SDK wrappers
│   ├── auto-reply/         # Inbound message routing, heartbeat prompt logic, follow-up
│   ├── channels/           # Channel plugin loader, config schema, action types
│   ├── config/             # JSON5 loader, Zod schema, AJV validator, migrations, hot-reload
│   ├── cron/               # CronService, job runners
│   ├── gateway/            # WebSocket+HTTP server, methods, protocol, events, auth
│   ├── infra/              # Heartbeat runner, update runner, system events
│   ├── memory/             # MemoryIndexManager, hybrid search, sqlite-vec, BM25/FTS5
│   ├── plugin-sdk/         # Public SDK modules for plugin authors
│   ├── plugins/            # Plugin loader (jiti), registry, hooks, types, runtime
│   ├── process/            # Command queue, lane concurrency
│   ├── telegram/           # grammY bot factory
│   └── wizard/             # Onboarding wizard runner
├── extensions/             # Bundled plugin extensions (telegram, memory-core, discord, etc.)
├── ui/                     # Web Control UI (Vite + Lit 3)
└── packages/               # Internal workspace packages
```

## Core Architecture

### Gateway Startup (`src/gateway/server.impl.ts`)
1. Load + validate JSON5 config
2. Apply legacy config migrations + plugin auto-enable rules
3. Prepare secrets runtime snapshot
4. Start WebSocket server (port 18789)
5. Load plugins via `loadOpenClawPlugins()`
6. Start heartbeat runner
7. Build cron service
8. Create channel manager
9. Attach WS handlers, config hot-reloader, health monitor

### Message Flow
```
Inbound message (any channel)
  → Channel plugin → auto-reply dispatcher
  → Command queue (lane concurrency)
  → runReplyAgent() or runCronIsolatedAgentTurn()
  → runEmbeddedAttempt() in agents/pi-embedded-runner/run/attempt.ts
  → before_prompt_build hook → before_agent_start hook
  → createAgentSession() from @mariozechner/pi-coding-agent
  → Pi SDK handles LLM streaming, tool calls, compaction
  → after_tool_call hooks → agent_end hook
  → Outbound delivery via channel plugin
```

### WebSocket Protocol
- JSON frames with `type` field: `event` (push), `req` (call), `res` (response)
- Challenge/response auth with WebCrypto ECDSA device identity
- Sequence numbers with gap detection

## LLM Integration — Pi SDK

Four `@mariozechner/pi-*` packages at v0.55.3:
- `pi-agent-core`: Agent types, StreamFn, tool definitions
- `pi-ai`: LLM provider stream functions (`streamSimple`)
- `pi-coding-agent`: Session management (`createAgentSession`, `SessionManager`)
- `pi-tui`: Terminal UI (dev only)

**Central call site:** `src/agents/pi-embedded-runner/run/attempt.ts`
```typescript
const session = createAgentSession({
  systemPrompt, tools, streamFn, resourceLoader, settingsManager, history
});
subscribeEmbeddedPiSession(session, { onToolCall, onContent, onTurnEnd });
await session.prompt(userInput);
```

Providers: anthropic, openai, google, ollama, deepseek, xai, mistral, venice, github-copilot, any OpenAI-compat.

## Plugin System

### Loading via jiti (TypeScript runtime, no build step)
- Three origins: bundled (`extensions/`), workspace, external (`config.plugins.loadPaths`)
- `openclaw.plugin.json` manifest per plugin
- Only one `kind: "memory"` plugin loads at a time

### Plugin API Surface
```typescript
interface OpenClawPluginApi {
  registerTool(factory: ToolFactory): void;
  registerHook(name, handler): void;
  registerChannel({ plugin: ChannelPlugin }): void;
  registerProvider(provider): void;
  registerGatewayMethod(method, handler): void;
  registerHttpRoute(route): void;
  registerCli(registrar): void;
  registerService(service): void;
  registerCommand(command): void;
}
```

### Hook System — 25+ hooks with strategies:
- `before_prompt_build` — sequential modifying, inject into system prompt
- `before_agent_start` — sequential modifying, block/modify agent start
- `llm_input` / `llm_output` — sequential modifying, mutate LLM messages
- `before_tool_call` / `after_tool_call` — sequential modifying
- `agent_end` — parallel void
- `message_received` / `message_sending` / `message_sent`
- `session_start` / `session_end`
- `gateway_start` / `gateway_stop`
- `before_compaction` / `after_compaction`
- `subagent_spawning` / `subagent_spawned` / `subagent_ended`

### Tool Factories (lazy, receive session context)
```typescript
type ToolFactory = (ctx: {
  config, workspaceDir, agentId, sessionKey, sessionId,
  messageChannel, agentAccountId, requesterSenderId, senderIsOwner, sandboxed
}) => AnyAgentTool | AnyAgentTool[] | null;
```

## Channel System

Bundled channels: telegram (grammY), discord, slack, whatsapp, signal, matrix, imessage, line, zalo, twitch, nostr, irc, mattermost, msteams, etc.

### Telegram (`src/telegram/bot.ts`)
- grammY with `sequentialize` + `apiThrottler`
- Webhook (preferred) or long polling
- Photo, voice, document, sticker handling
- Inline keyboard + reactions

## Memory System

### Architecture
File-based: agent's `memory/` dir contains Markdown files indexed into SQLite.
Pluggable via `kind: "memory"` plugins.

### Database (node:sqlite built-in, requires Node >= 22.12.0)
Tables: `meta`, `files`, `chunks`, `embedding_cache`, `chunks_fts` (FTS5), `chunks_vec` (sqlite-vec)

### Hybrid Search (`src/memory/hybrid.ts`)
```
score = vectorWeight(0.7) * vectorScore + textWeight(0.3) * bm25Score
  × temporal_decay(exp(-lambda * ageInDays))
  → MMR re-ranking for diversity
```

### Embedding Providers
openai, gemini, voyage, mistral, ollama, local (node-llama-cpp)

### File Watching
chokidar watches memory dir → re-chunk → compute embeddings (with cache) → update tables

## Cron/Heartbeat

### CronService (`src/gateway/server-cron.ts`)
Uses `croner` library. Job types: `agentTurn`, `heartbeat`, `webhook`

### Heartbeat Runner (`src/infra/heartbeat-runner.ts`)
- Long-running loop with configurable interval (default 1h)
- Wake handler pattern for early triggering (coalesces multiple triggers)
- Active hours checking
- Queue empty check (won't interrupt active turns)
- Reads `HEARTBEAT.md` from agent workspace
- Deduplication (skip same content within 24h)
- `HEARTBEAT_OK` token for transcript pruning

## Web UI (Vite + Lit 3)

### Components
Root: `openclaw-app` LitElement. Tabs: Chat, Sessions, Agents, Cron, Channels, Config, Logs, Usage, Skills, Nodes.

### Gateway Client (`ui/src/ui/gateway.ts`)
WebSocket with device identity auth (WebCrypto ECDSA P-256 in IndexedDB).
Exponential backoff reconnect (800ms base, 1.7x, 15s cap).

## Config System

### Format: JSON5 with env var substitution (`${VAR_NAME}`)
### Validation: AJV (structural) + Zod (semantic)
### Hot-reload via chokidar watching config file

## Database — NO application DB

OpenClaw has NO Drizzle ORM. NO tasks/conversations/events/revenue tables.
- Sessions: JSONL transcript files on disk (Pi SDK SessionManager)
- Session metadata: `sessions.json` JSON file
- Memory: SQLite (memory.db) for search index only
- Config: JSON5 file

## Key Files

| File | Purpose |
|------|---------|
| `src/gateway/server.impl.ts` | Gateway startup orchestration |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Central LLM invocation |
| `src/plugins/loader.ts` | Plugin discovery and loading |
| `src/plugins/hooks.ts` | Hook system (25+ hooks) |
| `src/plugins/types.ts` | Plugin API surface |
| `src/memory/manager.ts` | MemoryIndexManager |
| `src/memory/hybrid.ts` | Hybrid search (BM25 + vector + decay + MMR) |
| `src/memory/memory-schema.ts` | SQLite schema |
| `src/infra/heartbeat-runner.ts` | Autonomous loop |
| `src/gateway/server-cron.ts` | Scheduled jobs |
| `src/config/io.ts` | Config loading |
| `src/config/zod-schema.ts` | Config validation |
| `src/telegram/bot.ts` | grammY bot factory |
| `src/gateway/server-channels.ts` | Channel lifecycle |
| `ui/src/ui/gateway.ts` | WS client with device auth |
| `ui/src/ui/app.ts` | Root UI component |

## Key Observations for v2

**Strengths to keep:**
1. Plugin system via jiti — TypeScript, zero build, AJV schema per plugin, lazy tool factories
2. Hybrid memory search (BM25 + vector + temporal decay + MMR) — production-grade
3. Hook system — clean extension points at every LLM pipeline stage
4. Heartbeat wake handler pattern — coalescing triggers with interval loop
5. Gateway WS protocol — challenge/response auth, sequence numbers, gap detection
6. Channel system — proven multi-channel architecture

**What needs replacing:**
- Pi SDK dependency → direct LLM API calls or Vercel AI SDK
- JSONL transcript files → SQLite conversation persistence
- `HEARTBEAT.md` gimmick → structured cron prompts from spawnbot
- No application DB → add tasks, memories, conversations, state tables
- Node >= 22.12.0 requirement for `node:sqlite` → consider better-sqlite3
