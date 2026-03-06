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

## After Fork (Phase 1 complete)
```bash
bun install           # Install dependencies
bun run dev           # Start in dev mode
bun run build         # Build for production
spawnbot run "hello"  # Headless mode
spawnbot              # Interactive TUI
```
