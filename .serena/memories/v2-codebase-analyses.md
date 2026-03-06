# v2 Codebase Analyses Summary

## Decision: Fork OpenClaw into new repo

### OpenClaw (at /home/eugen-dev/Workflows/openclaw)
- TypeScript, Pi SDK embedded (createAgentSession), grammY Telegram
- 25+ hook plugin system via jiti, tool factories, channel/provider plugins
- Hybrid memory search (BM25 + vector + sqlite-vec + temporal decay + MMR)
- Web UI: Vite + Lit 3, WebSocket with device auth
- Config: JSON5, AJV + Zod validation, hot-reload via chokidar
- NO application DB (JSONL transcripts, sessions.json, memory.db only)
- Heartbeat is a gimmick — reads HEARTBEAT.md, not directed prompting
- Key files: src/gateway/server.impl.ts, src/agents/pi-embedded-runner/run/attempt.ts, src/plugins/loader.ts, src/memory/hybrid.ts

### thepopebot (at /home/eugen-dev/Workflows/thepopebot)
- JavaScript/Next.js, LangGraph createReactAgent, SqliteSaver persistence
- GitHub Actions MANDATORY for job execution (can't run locally)
- Vercel AI SDK v5 streaming, Drizzle ORM
- No plugin system, no memory beyond LangGraph checkpoints
- Key innovation: ChannelAdapter base class, render_md() templates

### spawnbot v1 Innovations to Keep
1. Priority Input Queue (4 levels with blocking dequeue)
2. Source-Attributed Router ([SOURCE from SENDER])
3. Structured Cron Prompts (workspace:, flow:, prompt:)
4. Autonomy Loop (idle escalation 30min→15min→warning)
5. SQLite Memory FTS5 + importance decay
6. Poller Manager (poll(lastState) → {events, newState})
7. Flow Engine (Mermaid DSL)
8. MCP Pre-flight Validation

### spawnbot v1 Bugs Found
- Wire spawn readiness is timer, not real signal
- Dual conversation logging (daemon + convo_log tool)
- flow_start HTTP loopback has no timeout
- _fixLogPermissions deletes unwritable logs
- _attemptRecovery doesn't emit wire_ready
- fs.watch recursive unreliable on Linux

Full analyses saved in Claude Code memory files:
- openclaw-analysis.md
- thepopebot-analysis.md
- spawnbot-v1-audit.md
