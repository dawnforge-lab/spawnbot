# Codebase Analyses & Fork Decision

## Decision History
1. **spawnbot v1** — JS daemon wrapping Kimi CLI via Wire protocol. Hit prompt conflict, Wire abstraction issues.
2. **OpenClaw fork** — Abandoned after 3 epics. Fork cost exceeded building from scratch.
3. **spawnbot v2 plan** — Fresh TypeScript rewrite with Vercel AI SDK. Never started.
4. **spawnbot v3 (current)** — Fork Kilo Code CLI. Best of both worlds: mature CLI tools + our additions on top.

## Why Kilo Code Fork
- MIT license, TypeScript/Bun, 51k lines of battle-tested agentic code
- 20+ LLM providers via Vercel AI SDK (already our planned stack)
- Mature tools: bash (PTY), file ops, glob, grep (ripgrep), web fetch/search, LSP
- First-class MCP support (stdio + remote + OAuth)
- Session management with compaction
- Agent/subagent architecture
- TUI, headless mode, permission system
- Internal Hono HTTP server + SDK client = daemon-ready architecture
- Bun-specific APIs in only ~43 call sites (manageable if Node.js needed later)

## Kilo-Specific Code to Strip
- `@kilocode/kilo-telemetry` — PostHog telemetry
- `@kilocode/kilo-gateway` — Auth gateway
- `kilocode/` directory — branding, migrations, config migrators
- Kilo OAuth flow (keep provider API key auth)
- `// kilocode_change` comments mark all Kilo modifications from OpenCode base

## Alternatives Considered
| Tool | License | Why Not |
|------|---------|---------|
| Claude Code | All rights reserved | Not open source |
| Goose (Block) | Apache-2.0 | Rust core, can't modify internals from TS |
| Codex CLI | Apache-2.0 | OpenAI-centric, Rust, limited multi-provider |
| Aider | Apache-2.0 | No MCP, no bash tool, Python |
| Cline | Apache-2.0 | IDE-only, no headless |
| Gemini CLI | Apache-2.0 | Google-centric provider support |
| Crush | FSL-1.1-MIT | Not truly open source |

## Innovation Inventory (from all sources, to port)
1. Priority Input Queue — spawnbot v1 (~100 lines)
2. Source Attribution — spawnbot v1 + OC Epic 3 (~30 lines)
3. Autonomy Loop — spawnbot v1 + OC Epic 3 (~150 lines)
4. Poller Manager — spawnbot v1 + OC Epic 3 (~150 lines)
5. SQLite Memory FTS5 + decay — spawnbot v1 + OC Epic 2 (~300 lines)
6. Context Director — OC Epic 2 (~200 lines)
7. LLM Co-Creation Onboarding — spawnbot v1 (~400 lines)
8. SOUL.yaml Personality — spawnbot v1 (~50 lines)
