# Task Completion Checklist

## Before Committing
1. **TypeScript compiles** — `bun run typecheck` must pass with 0 errors
2. **Tests pass** — `bun test --timeout 30000` (60 tests)
3. **Build succeeds** — `bun run build` produces `dist/spawnbot-*/bin/spawnbot`
4. **Follow Kilo Code conventions** — namespaces, Zod schemas, tagged logger
5. **No fallbacks** — errors must be transparent, never hidden
6. **Check imports** — ES Module syntax, no circular dependencies
7. **Bun-compatible** — use Bun APIs where Kilo Code does
8. **Stub completeness** — if adding Kilo-originated calls, ensure stubs in `src/stubs/` cover them

## After Committing
- Update relevant Serena memories if the commit introduces new patterns or architectural changes
- Push to remote if appropriate

## Phase-Specific
- **Phase 1 (Fork & Strip):** DONE — Kilo telemetry removed, CLI works as `spawnbot`, kilocode remnants cleaned
- **Phase 2 (SOUL):** DONE — SOUL.md loads and renders into system prompt
- **Phase 3 (Memory):** DONE — Hybrid FTS5 + OpenAI embedding vector search, decay runs, context director injects memories. Memory.store/recall are async.
- **Phase 4 (Telegram):** File attachments done (photos/docs/voice/video download to inbox, FilePart passed for multimodal). Verify end-to-end with real Telegram token.

## Comprehensive Audit Status (2026-03-06)
- TypeScript: 0 errors in src/ (54 fixed), remaining errors only in packages/ examples
- Tests: 60/60 passing
- Build: script/build.ts created, compiles to native Bun binary
- Kilo cleanup: HTTP headers rebranded, dead TUI components stubbed, tips fixed, review prompts rebranded
- Daemon: dry-run mode added, CRONS.yaml error handling added
- Remaining: kilo-sessions/ (cloud sharing), github.ts (GitHub agent) still reference Kilo cloud APIs — functional but dead without Kilo credentials
