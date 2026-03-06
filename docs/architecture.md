# Spawnbot v2 — Architecture

## Design Principles

1. **Single process, no subprocess.** The daemon makes LLM API calls directly. No Wire protocol, no CLI spawning, no IPC.
2. **Build a product, not a platform.** No plugin system, no generic hooks, no framework abstractions. Direct imports, direct function calls.
3. **Telegram is the control plane.** Primary channel for input and output. Everything else is an add-on poller.
4. **Simplicity over flexibility.** One config format, one onboarding path. Add flexibility when needed, not before.
5. **Transparent errors.** No fallbacks that hide problems. If something fails, surface it clearly.

## System Overview

```
┌──────────────────────────────────────────────────┐
│                  Spawnbot Daemon                  │
│                  (Node.js process)                │
│                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │  Telegram    │  │   Cron      │  │ Autonomy │ │
│  │  Listener    │  │  Scheduler  │  │  Loop    │ │
│  └──────┬───────┘  └──────┬──────┘  └────┬─────┘ │
│         │                 │              │        │
│         ▼                 ▼              ▼        │
│  ┌────────────────────────────────────────────┐   │
│  │           Input Queue (Priority)           │   │
│  │     critical > high > normal > low         │   │
│  └─────────────────────┬──────────────────────┘   │
│                        │                          │
│                        ▼                          │
│  ┌────────────────────────────────────────────┐   │
│  │              Input Router                  │   │
│  │  [SOURCE from SENDER]: content             │   │
│  │  Dequeue → Format → Build Prompt → Call    │   │
│  └─────────────────────┬──────────────────────┘   │
│                        │                          │
│                        ▼                          │
│  ┌────────────────────────────────────────────┐   │
│  │            Agent Turn Runner               │   │
│  │  System prompt + history + tools → LLM     │   │
│  │  Tool execution loop (0-N iterations)      │   │
│  │  Response → delivery                       │   │
│  └─────────┬──────────────────┬───────────────┘   │
│            │                  │                    │
│            ▼                  ▼                    │
│  ┌──────────────┐   ┌──────────────────┐         │
│  │  Vercel AI   │   │    Tool System   │         │
│  │  SDK         │   │  memory, tasks,  │         │
│  │  (multi-LLM) │   │  telegram, shell │         │
│  └──────────────┘   └──────────────────┘         │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │              SQLite Database               │   │
│  │  memories, conversations, tasks, state     │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌──────────────┐   ┌──────────────────┐         │
│  │  Poller      │   │   Config         │         │
│  │  Manager     │   │   (YAML)         │         │
│  └──────────────┘   └──────────────────┘         │
└──────────────────────────────────────────────────┘
```

## Component Details

### 1. Telegram Listener

**Library:** grammY (proven in OpenClaw + spawnbot v1)

**Modes:**
- Long polling (development, simple setup)
- Webhook (production, requires public URL via ngrok)

**Capabilities:**
- Text messages, photos, voice, documents
- Inline keyboards for confirmations
- Reactions for acknowledgement
- Group chat support (mention-triggered)

**Integration:**
- Receives messages → wraps as `InputEvent` with source attribution → enqueues at `normal` priority
- Receives responses from agent → sends back to originating chat
- Owner verification via Telegram user ID

### 2. Input Queue

**Design:** Priority queue with 4 levels, FIFO within each level.

```typescript
type Priority = "critical" | "high" | "normal" | "low";

type InputEvent = {
  id: string;
  content: string;
  source: string;        // "telegram", "cron", "autonomy", "poller/{name}"
  sender?: string;       // display name or ID
  priority: Priority;
  metadata?: Record<string, unknown>;
  createdAt: number;
};
```

**Behavior:**
- `enqueue(event)` — adds to appropriate priority bucket
- `dequeue()` — returns highest priority event, blocks if empty (Promise waiter)
- Max queue size per priority level (prevents memory leak)
- Critical events always accepted (never dropped)

### 3. Input Router

**Responsibility:** Dequeue events, format them with source attribution, hand to agent turn runner.

**Source attribution format:**
```
[telegram from Eugen]: Hey, check the latest news
[cron/morning-checkin]: Good morning! Review your tasks and plan the day.
[autonomy]: Autonomous check-in #3. You have been idle for 45 minutes.
[poller/x-twitter from @user]: New mention: "..."
```

### 4. Agent Turn Runner

**Core loop:**
1. Build system prompt (from SOUL.yaml + config)
2. Load conversation history (from SQLite)
3. Load relevant memories (Context Director — token-budgeted FTS5 recall)
4. Format user input with source attribution
5. Call LLM via Vercel AI SDK `streamText()` (provider from config)
6. Parse tool calls, execute tools
7. Feed results back to LLM
8. Repeat until no more tool calls
9. Log conversation to SQLite
10. Route response to delivery (Telegram, etc.)

**Tool execution:**
- Tools defined as typed functions with parameter schemas
- Sequential execution (no parallel tool calls initially)
- Each tool call logged to conversation history
- Max iterations configurable (default: 20)

### 5. LLM Integration

**Library:** Vercel AI SDK (`ai` + provider packages)

**Provider-agnostic.** Supports multiple providers through a unified interface:
- `@ai-sdk/anthropic` — Claude (Sonnet, Haiku, Opus)
- `@ai-sdk/openai` — GPT-4o, o1, o3
- `@ai-sdk/google` — Gemini
- `@ai-sdk/deepseek` — DeepSeek
- Any OpenAI-compatible API (Ollama, local models, etc.)

**Default model:** Configurable in `config.yaml` (no hardcoded provider)

**Features used:**
- `streamText()` — streaming responses with tool calls
- `generateText()` — non-streaming for simple calls
- Tool definitions via Zod schemas (Vercel AI SDK pattern)
- Multi-turn conversation
- Provider-specific features (e.g., extended thinking for Anthropic)

**Why Vercel AI SDK over direct SDKs:**
- One interface for all providers — switch models in config, not code
- Cost optimization — use cheap models (DeepSeek, Gemini Flash) for routine tasks, expensive models for complex reasoning
- Well-maintained, TypeScript-first, streaming-native

### 6. Tool System

**Built-in tools:**

| Tool | Purpose |
|------|---------|
| `memory_store` | Store a memory with category + importance |
| `memory_recall` | Search memories via FTS5 |
| `memory_browse` | List recent memories by category |
| `memory_delete` | Remove a memory |
| `task_create` | Create a task |
| `task_list` | List tasks by status |
| `task_update` | Update task status/details |
| `tg_send` | Send Telegram message |
| `tg_photo` | Send photo to Telegram |
| `tg_react` | React to a message |
| `shell_exec` | Execute shell command (with safety checks) |
| `web_fetch` | Fetch a URL |
| `web_search` | Search the web |

**Tool definition pattern:**
```typescript
type Tool = {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
};
```

### 7. SQLite Database

**Library:** better-sqlite3 (synchronous, no Node 22.12+ requirement)

**Tables:**

```sql
-- Long-term memory with importance decay
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL,  -- emotional, factual, preference, task, relationship
  importance REAL DEFAULT 0.5,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0
);
CREATE VIRTUAL TABLE memories_fts USING fts5(content, tokenize='porter');

-- Conversation log
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,     -- telegram, cron, autonomy, poller
  sender TEXT,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  tools_used TEXT,          -- JSON array
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at INTEGER NOT NULL
);

-- Task tracking
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',  -- pending, active, done, cancelled
  priority TEXT DEFAULT 'normal',
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Key-value state (poller state, daemon state, etc.)
CREATE TABLE state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 8. Autonomy Loop

**Ported from spawnbot v1 → OpenClaw Epic 3.**

**Behavior:**
- Base interval: 30 minutes
- After 2h idle: escalate to 15-minute checks + urgency note
- After 6h idle: WARNING + "take proactive action now"
- Uses `low` priority — yields to everything else
- Only fires when no other events are pending
- Directed prompts (not "check your file")

**Activity tracking:**
- Updated on every agent turn triggered by user/channel input
- Reset escalation on real activity

### 9. Poller Manager

**Ported from spawnbot v1 → OpenClaw Epic 3.**

**Contract:**
```typescript
type PollerModule = {
  name: string;
  defaultInterval: number;  // seconds
  poll(lastState: unknown): Promise<{
    events: PollEvent[];
    newState: unknown;
  }>;
};
```

**State persistence:** JSON files in `data/poller-state/{name}.json`

**Event dispatch:** Events enqueued at their declared priority. High/critical events trigger immediate processing.

### 10. Cron Scheduler

**Library:** croner (proven in OpenClaw)

**Config in `config.yaml`:**
```yaml
crons:
  morning_checkin:
    schedule: "0 9 * * *"
    prompt: "Good morning! Review tasks, check for updates, plan the day."
    priority: normal
    enabled: true
  evening_summary:
    schedule: "0 18 * * *"
    prompt: "End of day. Summarize what happened, note pending items."
    priority: normal
    enabled: true
```

**Integration:** Cron fires → creates InputEvent with source `cron/{jobName}` → enqueues at configured priority.

### 11. Config System

**Two files:**

**`config.yaml`** — Operational config
```yaml
agent:
  name: "MyAgent"
  provider: "anthropic"          # anthropic, openai, google, deepseek, custom
  model: "claude-sonnet-4-20250514"
  max_tokens: 4096
  max_tool_iterations: 20
  custom_base_url: ""            # for custom OpenAI-compatible providers

telegram:
  polling: true          # false = webhook mode
  webhook_domain: ""     # for webhook mode (ngrok domain)
  allowed_users: []      # Telegram user IDs (empty = owner only)

ngrok:
  enabled: false
  static_domain: ""      # optional fixed domain (e.g., agent.ngrok-free.app)

autonomy:
  enabled: true
  base_interval_minutes: 30
  escalation_threshold_hours: 2
  escalated_interval_minutes: 15

crons:
  morning_checkin:
    schedule: "0 9 * * *"
    prompt: "Good morning! Review tasks and plan the day."
    priority: normal
    enabled: true

pollers:
  enabled: true
  directory: "pollers"

memory:
  decay_interval_hours: 24
  decay_factor: 0.95
  min_importance: 0.01
```

**`SOUL.yaml`** — Agent personality (co-created with LLM)
```yaml
identity:
  name: "AgentName"
  tagline: "One-liner purpose"
  description: "Full description"

personality:
  traits:
    analytical: 7
    creative: 5
    assertive: 6
    thorough: 8
    humorous: 3

voice:
  style: "professional but approachable"
  tone: "neutral"
  emojis: false
  vocabulary:
    prefer: ["precisely", "let's"]
    avoid: ["basically", "honestly"]

safety:
  stop_phrase: "emergency-stop"
  hard_limits:
    - "Never share credentials"
    - "Never execute destructive commands without confirmation"
  behavior_rules:
    - "Always cite sources"
    - "Ask for clarification when unsure"

goals:
  - name: "Daily summaries"
    description: "Summarize key events each day"

playbook:
  - category: "Research"
    tasks:
      - "Search for relevant news"
      - "Summarize findings"
```

**`.env`** — Secrets
```
# LLM Provider (set the one matching config.yaml provider)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
DEEPSEEK_API_KEY=...

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=987654321

# ngrok (optional, for webhook mode)
NGROK_AUTHTOKEN=...
```

### 12. System Prompt Builder

**Built at runtime from SOUL.yaml + config.** No template file, no rendering step.

```typescript
function buildSystemPrompt(soul: SoulConfig, config: AgentConfig): string {
  // Identity section
  // Personality traits (1-10 scale)
  // Voice style and rules
  // Safety rules and stop phrase
  // Goals and playbook
  // Memory instructions
  // Tool usage guidance
  // Autonomy instructions
  // Input format explanation
  // Current date/time
}
```

**Cached** with mtime-based invalidation on SOUL.yaml.

### 13. Onboarding (LLM Co-Creation)

**One path, no modes:**

1. **LLM Provider** — Select provider (Anthropic, OpenAI, Gemini, DeepSeek, custom), enter API key, validate with test call
2. **Agent Identity** — Ask for name + 1-2 sentence purpose
3. **LLM Co-Creation** — Stream a conversation with the configured LLM:
   - LLM suggests personality traits based on purpose
   - User adjusts/approves
   - LLM guides through Voice → Safety → Goals → Playbook
   - When user approves, LLM outputs SOUL.yaml
4. **Telegram Setup** — Bot token (with validation) + auto-detect chat ID
5. **ngrok Setup** — Optional tunnel for webhook mode (authtoken + static domain)
6. **GitHub Agent Repo** — Optional: create repo via `gh` CLI, generate Actions workflow, initial commit
7. **Smoke Test** — Test LLM connection + run test prompt
8. **Start Daemon** — Option to start immediately or show manual start command

**LLM call for co-creation:** Via Vercel AI SDK `streamText()` (not subprocess). Streaming for real-time display.

## Directory Structure

```
~/.spawnbot/                  # Data directory
├── config.yaml               # Operational config
├── SOUL.yaml                 # Personality (co-created)
├── .env                      # Secrets
├── data/
│   ├── agent.sqlite          # SQLite database
│   ├── poller-state/         # Poller state files
│   └── logs/
│       └── spawnbot.log
├── pollers/                   # Custom poller modules
└── skills/                    # Agent skills (future)

~/Workflows/spawnbotv2/        # Framework source
├── src/
│   ├── index.ts              # CLI entry point
│   ├── daemon/               # Daemon lifecycle, health, ngrok tunnel
│   ├── agent/                # Turn runner, system prompt, tool execution
│   ├── input/                # Queue, router, autonomy loop, cron
│   ├── memory/               # SQLite + FTS5 + decay
│   ├── telegram/             # grammY bot, message handling
│   ├── pollers/              # Poller manager
│   ├── config/               # YAML loader, SOUL.yaml parser
│   ├── setup/                # Onboarding wizard + co-creation + GitHub
│   ├── doctor/               # Diagnostics
│   ├── db/                   # Schema, migrations
│   └── ui/                   # Web dashboard
├── docs/
├── package.json
└── tsconfig.json
```

## Technology Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime | Node.js >= 20 | Proven, ecosystem, TypeScript |
| Language | TypeScript (strict) | Type safety, IDE support |
| LLM | Vercel AI SDK (`ai`) | Provider-agnostic, streaming, tool calls |
| LLM Providers | @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google | Configurable, swap in config |
| Telegram | grammY | Proven in OpenClaw, well-typed |
| Database | better-sqlite3 | Sync API, no Node 22.12+ req |
| Full-text search | FTS5 (built into SQLite) | Fast, Porter stemming |
| Config | yaml (npm package) | Human-readable, structured |
| Cron | croner | Proven in OpenClaw |
| Tunnel | ngrok | Simple webhook exposure |
| CLI | commander | Lightweight, standard |
| Web UI | Hono + htmx (or similar) | Lightweight server-rendered dashboard |
| Dev | tsx | Zero-config TypeScript execution |
| Build | tsc | Standard TypeScript compiler |
| Test | vitest | Fast, TypeScript-native |
| Lint | oxlint | Fast, zero-config |
