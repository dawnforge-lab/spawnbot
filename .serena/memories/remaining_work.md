# Remaining Work (as of 2026-03-07)

## 7. Mom-Friendly CLI — DONE (2026-03-07)
- `bin/spawnbot` rewritten as bash wrapper with friendly commands:
  - `spawnbot start` — daemon in background with PID file
  - `spawnbot stop` — graceful shutdown with 10s timeout + force kill
  - `spawnbot restart`, `status`, `logs [-f]`, `reset`
  - All other commands pass through to the TypeScript CLI
- `install.sh` — one-liner installer (`curl ... | bash`)
  - Installs bun if missing, clones to `~/.spawnbot`, deps, PATH, launches setup
- README.md rewritten with simplified install + command reference

## 1. `src/kilocode/` Cleanup
- 29 files in `src/kilocode/` directory
- 46 files across `src/` still import from it — cannot delete without updating all imports
- Strategy: audit each import, replace with spawnbot equivalents or inline, then delete

## 2. `src/kilo-sessions/` Cleanup
- 2 files: `kilo-sessions.ts`, `ingest-queue.ts`
- Referenced by 4 files: `import.ts`, `session/index.ts`, `project/bootstrap.ts`, `kilo-sessions.ts`
- Dead without Kilo cloud credentials — functional but unused
- Strategy: stub or remove, update references

## 3. Session Rotation (daemon longevity) — DONE
- Rotates to a fresh session after 5 compactions (`COMPACTIONS_BEFORE_ROTATION`)
- Memory system carries context forward (context director injects relevant memories)
- Implemented in `src/daemon/index.ts` via `rotateSession()` + compaction counter

## 4. End-to-End Testing
- Needs real Telegram token + LLM provider API key
- Verify: daemon boots → Telegram connects → messages route → LLM responds → reply sent
- Cannot be automated without credentials

## 5. Poller Plugins — DONE (RSS demo + skill)
- RSS poller built-in: `src/autonomy/pollers/rss.ts` (factory function `createRssPoller`)
- Declarative config via `POLLERS.yaml` (same pattern as CRONS.yaml)
- `create-poller` skill teaches agent to write custom pollers at runtime
- Agent can create pollers in `.spawnbot/pollers/` and register them

## 6. Comprehensive Audit Fixes — DONE (2026-03-07)
14 issues fixed in one commit (7ba4b73):
- Config parse errors throw (no-fallbacks)
- Daemon pre-flight validation (SOUL.md, API key, Telegram)
- Handler errors deliver error response to user
- Queue overflow notifies user via Telegram
- File download failures notify user
- Telegram send retry with exponential backoff
- Poller state save error logging
- Memory recall error isolation
- Compaction flush: raw text fallback + h1-h3 regex
- Configurable idle thresholds via env vars
- Doctor validates YAML syntax, SOUL.md content, API keys
- Coder subagent prompt created

## Completed (removed from this list)
- Phase A-B (type safety): 0 TS errors
- Phase D (build): `script/build.ts` works
- Phase E partial: CRONS.yaml error handling, dry-run mode done
- Onboarding: 10-step wizard complete
