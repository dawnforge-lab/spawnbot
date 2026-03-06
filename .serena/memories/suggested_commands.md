# Suggested Commands

## Current Phase (pre-fork, docs only)
```bash
# View the plan
cat docs/plan-v3-kilocode-fork.md

# Git
git status
git log --oneline
```

## Kilo Code Reference (at /home/eugen-dev/Workflows/kilocode)
```bash
# Run Kilo Code in dev mode
cd /home/eugen-dev/Workflows/kilocode
bun run --cwd packages/opencode --conditions=browser src/index.ts

# Build
bun run --cwd packages/opencode script/build.ts

# Tests
cd packages/opencode && bun test --timeout 30000
```

## After Fork (All phases complete)
```bash
bun install           # Install dependencies
bun run dev           # Start in dev mode (TUI)
bun run dev -- --help # Show CLI help
bun run dev -- doctor # Run diagnostics
bun run dev -- daemon # Start autonomous daemon
bun run typecheck     # Must pass with 0 errors
bun test              # 60 tests, all must pass
bun run build         # Compile to native binary → dist/spawnbot-*/bin/spawnbot
```
