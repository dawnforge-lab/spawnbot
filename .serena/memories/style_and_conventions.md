# Code Style and Conventions

## Target (Post-Fork)
- **TypeScript** (strict mode)
- **Bun** runtime (not Node.js)
- **ES Modules** (`import`/`export`, `"type": "module"`)

## Kilo Code Conventions (to follow)
- **Namespaces** for module organization (`export namespace Agent {}`, `export namespace LLM {}`)
- **Zod** for schema validation
- **Drizzle ORM** for database
- Uses `remeda` for functional utilities (pipe, mergeDeep, sortBy, etc.)
- Tagged logger: `Log.create({ service: "name" })`
- Instance state pattern: `Instance.state(async () => { ... })` for lazy-init singletons
- Bus/event system for cross-module communication
- `.txt` files for prompt templates (imported as strings)

## Naming
- **camelCase** for variables, functions, methods, properties
- **PascalCase** for classes, namespaces, types
- **kebab-case** for file names
- **snake_case** for SQL columns

## Error Handling
- **CRITICAL: No fallbacks** — transparent errors that can be fixed, not hidden
- Named errors via `NamedError.create()` pattern from Kilo Code

## Bun-Specific APIs Used
- `Bun.serve()` — HTTP server
- `Bun.file()` / `Bun.write()` — file I/O
- `Bun.which()` — binary lookup
- `Bun.spawn()` / `Bun.spawnSync()` — process execution
- `Bun.stdin.text()` — stdin reading
- `Bun.sleep()` — async sleep
- `bun-pty` — PTY for bash tool
