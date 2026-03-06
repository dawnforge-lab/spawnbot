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
- **Phase 1 (Fork & Strip):** Verify all Kilo telemetry removed, CLI works under `spawnbot` name
- **Phase 2 (SOUL):** Verify SOUL.yaml loads and renders into system prompt
- **Phase 3 (Memory):** Verify FTS5 search works, decay runs, context director injects memories
- **Phase 4 (Telegram):** Verify end-to-end: Telegram message -> queue -> agent -> response in Telegram
