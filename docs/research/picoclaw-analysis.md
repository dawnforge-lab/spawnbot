# PicoClaw Codebase Analysis

Analyzed 2026-03-05 as a potential alternative to OpenClaw fork.

## Overview

PicoClaw is an ultra-lightweight AI agent framework written in **Go**. 307 source files, <10MB RAM, <1s startup. Produces static cross-platform binaries (Linux x86/arm64/armv7/riscv64, macOS, Windows).

## Architecture

```
Channels (13 native: Telegram, Discord, Slack, QQ, WeChat, Line, WhatsApp, etc.)
    ↓ InboundMessage
Message Bus (pub/sub)
    ↓
Agent Loop (pkg/agent/loop.go)
    ├── Session lookup (JSONL files)
    ├── Context builder (SOUL.md + IDENTITY.md + skills + memory)
    ├── System prompt assembly
    ├── LLM call (via provider)
    ├── Tool execution loop (0-N iterations)
    └── Response routing back to bus
    ↑ OutboundMessage
Channels send to users
```

## Key Characteristics

| Aspect | Detail |
|--------|--------|
| Language | Go 1.25+ |
| Binary size | Single static executable |
| RAM | <10MB claimed |
| Startup | <1s |
| Channels | 13 hardcoded (no dynamic loading) |
| Providers | 8+ (Anthropic, OpenAI, Gemini, Ollama, DeepSeek, etc.) |
| Tools | 25+ built-in (exec, shell, read/write, web search, MCP) |
| Memory | JSONL-based, no semantic search |
| Config | JSON (strict), no hot-reload |
| Plugin system | None |
| Hook system | None |
| Web UI | None |
| Skills | External marketplace (find_skills + install_skill tools) |
| Cron | gronx-based scheduler |
| Tests | 112 test files |

## What It Does Well

1. **Ultra-lightweight** — designed for embedded/edge (Raspberry Pi Zero, RISC-V)
2. **13 channels** out of the box (more than OpenClaw)
3. **Extended thinking** support for Anthropic models
4. **MCP support** (experimental)
5. **Skills marketplace** — discover and install external skills
6. **Cross-platform** — 8 architecture targets
7. **Simple architecture** — easy to understand core loop
8. **Auto-summarization** — truncates + summarizes when history grows

## What It Lacks

1. **No plugin system** — channels, tools, providers all hardcoded. Adding anything = code change + rebuild
2. **No web UI** — CLI-only
3. **No semantic memory** — JSONL storage, no FTS5, no vector search, no importance decay
4. **No hot-reload** — config changes require restart
5. **No hook system** — can't inject logic at LLM pipeline stages
6. **No priority queue** — messages processed FIFO
7. **No source attribution** — no routing metadata on inputs
8. **No autonomy loop** — cron only, no idle escalation
9. **No LLM-assisted onboarding** — basic Q&A wizard
10. **Basic error handling** — no circuit breakers, no retry with backoff

## System Prompt / Personality

Uses workspace bootstrap files (same names as OpenClaw):
- `IDENTITY.md`, `SOUL.md`, `GOALS.md`, `PLAYBOOK.md`
- System prompt built by `pkg/agent/context.go` — hardcoded intro + reads bootstrap files + skill index + conversation summary
- Cached in memory with mtime-based invalidation

## Memory System

- JSONL store: `~/.picoclaw/workspace/sessions/{sessionKey}`
- Operations: AddMessage, GetHistory, GetSummary, SetSummary, TruncateHistory
- Auto-summarization when messages exceed threshold or tokens exceed % of context window
- `memory/MEMORY.md` for long-term notes (manual, not auto-recalled)
- No FTS5, no vector search, no temporal decay

## Config Structure

```json
{
  "agents": { "defaults": {...}, "list": [...] },
  "model_list": [{ "model_name", "model", "api_key", "api_base" }],
  "channels": { "telegram": {...}, "discord": {...}, ... },
  "gateway": { "port", "host" },
  "tools": { "enabled_tools", "web": {...} },
  "heartbeat": { "enabled", "cron_expression", "deliver", "on_trigger" }
}
```

## Verdict for Spawnbot v2

**Not suitable as a base.** Reasons:
1. Go, not TypeScript — can't reuse any existing code or designs
2. No extensibility (no plugins, no hooks) — we'd need to add everything
3. Basic memory — would need a complete rewrite for FTS5 + decay
4. Missing core innovations — no priority queue, no source attribution, no autonomy loop
5. v0.1.1 — very immature

**Lessons to steal:**
- Simplicity as a design goal (small codebase, fast startup)
- Skills marketplace pattern (discover + install)
- System prompt caching with mtime invalidation
- Auto-summarization for long conversations
