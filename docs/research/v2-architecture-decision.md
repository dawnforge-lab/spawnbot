# Spawnbot v2 Architecture Decision

## Decision: Fork OpenClaw into new repo

Decided 2026-03-04 after deep analysis of spawnbot v1, OpenClaw, and thepopebot codebases.

## Why OpenClaw
- 80% infrastructure for free (channels, plugins, web UI, config, multi-agent)
- TypeScript, production-grade plugin system
- Pi SDK embedded (no subprocess management)
- Hybrid memory search infra (BM25 + vector + sqlite-vec)
- Problems are fixable design choices, not architectural constraints

## Why NOT thepopebot
- GitHub Actions is mandatory (can't run jobs locally)
- No memory system, no plugins, no multi-channel
- JavaScript only

## Why NOT fresh project
- Reinventing channels, plugins, web UI, config is waste of time

## What to add from spawnbot v1
- Priority Input Queue (critical > high > normal > low)
- Source-Attributed Router ([telegram/Eugen], [cron/daily-review])
- Structured Cron Prompts (replace heartbeat gimmick)
- Autonomy Loop (directed check-ins)
- SQLite memory with categories/importance (replace md files)
- Poller Manager for integrations
- Context Director (token-budgeted loading)

## Key files in OpenClaw
- `src/infra/heartbeat-runner.ts` — replace with structured prompting
- `src/memory/manager.ts` — replace md-based with SQLite-first
- `src/cron/service.ts` — enhance with directed cron prompts
- `src/agents/pi-embedded-runner/run.ts` — LLM orchestration
- `src/plugins/` — plugin system to build integrations on
- `ui/` — Lit web components for web UI

## OpenClaw local path
/home/eugen-dev/Workflows/openclaw

## Thepopebot local path
/home/eugen-dev/Workflows/thepopebot

## Plan file
/home/eugen-dev/.claude/plans/shiny-inventing-lagoon.md
