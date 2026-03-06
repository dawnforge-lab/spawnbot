# Task Completion Checklist

When completing a task in the spawnbot codebase:

## Before Committing
1. **Verify the code runs** — test with `node bin/spawnbot.js start --foreground` if touching daemon code
2. **Check imports** — ensure all new imports use ES Module syntax (`import`/`export`)
3. **Follow naming conventions** — camelCase for vars/methods, PascalCase for classes, kebab-case for files
4. **No fallbacks** — errors must be transparent, never hidden
5. **Check DB schema** — if schema.js was modified, run `npm run db:generate` for a new migration

## No Automated Checks Available
- No linter configured
- No test suite configured
- No build/compile step
- Manual verification is the primary quality gate

## After Committing
- Update relevant serena memories if the commit introduces new patterns, conventions, or architectural changes
