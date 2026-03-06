# thepopebot Codebase Analysis

## Overview

NPM package (`thepopebot` v1.2.73-beta.18) that scaffolds autonomous AI agent deployments.
Two-layer architecture: Next.js "Event Handler" (always-running) + Docker Agent containers (ephemeral, via GitHub Actions).

## Project Structure

```
thepopebot/                       # NPM package source
├── api/index.js                  # All /api/* route handlers (catch-all GET + POST)
├── lib/
│   ├── actions.js                # Shared dispatcher: agent | command | webhook
│   ├── cron.js                   # node-cron scheduler + version check
│   ├── triggers.js               # Webhook trigger middleware (TRIGGERS.json)
│   ├── paths.js                  # Central path resolver
│   ├── ai/
│   │   ├── agent.js              # createReactAgent singletons (job + code agents)
│   │   ├── index.js              # chat(), chatStream(), summarizeJob(), addToThread()
│   │   ├── model.js              # createModel() — multi-provider factory
│   │   ├── tools.js              # All LangChain tool definitions
│   │   └── web-search.js         # Provider-conditional web search
│   ├── channels/
│   │   ├── base.js               # ChannelAdapter abstract class
│   │   └── telegram.js           # TelegramAdapter
│   ├── chat/
│   │   ├── api.js                # POST /stream/chat — Vercel AI SDK streaming
│   │   └── components/           # React UI (chat, message, sidebar)
│   ├── code/
│   │   ├── actions.js            # Code workspace CRUD, container lifecycle
│   │   └── ws-proxy.js           # WebSocket auth proxy to ttyd in Docker
│   ├── db/
│   │   ├── schema.js             # Drizzle schema: users, chats, messages, etc.
│   │   └── index.js              # getDb() + initDatabase()
│   └── tools/
│       ├── create-job.js         # GitHub API branch creation for jobs
│       ├── github.js             # GitHub REST API wrapper
│       ├── telegram.js           # Send helpers, markdown to HTML, typing indicator
│       └── docker.js             # Docker Engine API via Unix socket
├── config/instrumentation.js     # Server startup: .env, DB init, crons
├── bin/cli.js                    # npx thepopebot CLI (init, setup, upgrade)
└── drizzle/                      # SQL migrations (0000-0003)
```

User project (after init):
```
user-project/
├── config/
│   ├── SOUL.md, JOB_PLANNING.md, CRONS.json, TRIGGERS.json
├── skills/active/
├── .github/workflows/            # Managed: run-job.yml, auto-merge.yml
├── docker/                       # Pi/Claude agent Docker images
├── data/thepopebot.sqlite
└── .env
```

## Core Architecture

### Layer 1: Event Handler (Next.js, always running)
- Telegram webhooks, GitHub webhooks, external API calls
- Cron jobs from CRONS.json
- Webhook triggers from TRIGGERS.json
- Web chat UI (streaming via Vercel AI SDK)
- SQLite persistence

### Layer 2: Docker Agent (ephemeral, GitHub Actions)
- Spawned by creating `job/uuid` branch via GitHub API
- `run-job.yml` detects branch, runs agent container
- Creates PR with results, may auto-merge
- Completion triggers webhook back to event handler

### Action Dispatch (shared by crons and triggers)
- type agent: createJob() via GitHub API branch
- type command: shell command
- type webhook: HTTP POST to URL

## LLM Integration — LangGraph

### Agent Creation (lib/ai/agent.js)
Job Agent (singleton): createReactAgent with SqliteSaver checkpointer.
Tools: create_job, get_job_status, get_system_technical_specs, etc.

Code Agent (per-chat): createReactAgent with workspace-bound tools.
Tools: start_coding, get_repository_details, web_search.

### Model Factory
Providers: anthropic (default), openai, google, custom.
Defaults: Claude Sonnet 4, GPT-4o, Gemini 2.5 Pro.

### Chat Paths
- chat() — non-streaming for Telegram, agent.invoke()
- chatStream() — async generator for web, agent.stream()
- summarizeJob() — one-shot, no memory
- addToThread() — injects messages into LangGraph checkpoint

## Persistence — SqliteSaver

Critical: SqliteSaver makes LangGraph state survive restarts.
thread_id (= chatId) connects conversations across sessions.

Two SQLite uses in same file:
1. Drizzle ORM for app data (users, chats, messages, notifications)
2. LangGraph SqliteSaver for agent state per thread

## Database Schema (Drizzle ORM)

| Table | Purpose |
|-------|---------|
| users | Auth accounts (bcrypt, first user = admin) |
| chats | Conversation threads (web + Telegram) |
| messages | Message history for web UI display |
| notifications | Job completion/failure notifications |
| subscriptions | Notification distribution targets |
| code_workspaces | Docker coding workspace state |
| settings | KV store: API keys (SHA-256 hashed), version check |

## Tool System

Job Agent: create_job, get_job_status, get_system_technical_specs, get_skill_building_guide, get_skill_details, web_search
Code Agent: start_coding, get_repository_details, web_search

## Telegram Integration

- grammY bot with hydrateReply
- Secret validation, chat ID filtering
- Voice/audio via OpenAI Whisper transcription
- Photos/documents as attachments
- Custom markdown to Telegram HTML conversion with smart splitting (4096 char limit)
- Typing indicator with random jitter (5.5-8s) to appear human
- Thumbs-up reaction for acknowledgment

## GitHub Actions (mandatory)

### createJob() flow
1. Generate UUID, branch job/uuid
2. LLM generates title
3. Create git tree with logs/jobId/job.config.json
4. Create commit + branch ref, triggers run-job.yml

### Workflows
- run-job.yml — runs Docker agent container
- auto-merge.yml — squash merge if AUTO_MERGE + ALLOWED_PATHS
- notify-pr-complete.yml — POST completion to event handler
- notify-job-failed.yml — POST failure notification

## Web UI

- React + Vercel AI SDK v5 (useChat, createUIMessageStream)
- Streamdown for streaming markdown rendering
- ToolCall components with auto-redirect for start_coding
- xterm.js terminal for code workspaces via WebSocket proxy to ttyd
- NextAuth v5 with Credentials provider

## Key Files

| File | Purpose |
|------|---------|
| api/index.js | All route handlers, central auth gate |
| lib/ai/agent.js | createReactAgent + SqliteSaver setup |
| lib/ai/index.js | chat(), chatStream(), summarizeJob() |
| lib/ai/model.js | Multi-provider LLM factory |
| lib/ai/tools.js | All LangChain tool definitions |
| lib/channels/telegram.js | Full Telegram webhook handling |
| lib/tools/create-job.js | Core job dispatch via GitHub API |
| lib/db/schema.js | Drizzle schema for all tables |
| lib/chat/api.js | Streaming bridge to Vercel AI SDK |
| lib/cron.js | Cron scheduler |
| lib/actions.js | Shared action dispatcher |

## Key Observations for v2

**Worth adopting:**
1. Clean ChannelAdapter base class — right abstraction for multi-channel
2. Single SQLite for both app data and LangGraph checkpoints
3. render_md() template system with include, datetime, skills, web_search
4. Action type dispatch (agent|command|webhook) shared between crons/triggers
5. createJob() via GitHub branch — clever, no job queue infra needed

**Why NOT to fork:**
- GitHub Actions is MANDATORY — cannot run jobs locally
- No memory system (only LangGraph checkpoints)
- No plugin system, tools hardcoded
- JavaScript only (not TypeScript)
- No multi-channel beyond Telegram
