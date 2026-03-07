# Kilocode Module Audit

## Summary
Audited all 17 imported kilocode modules. Categories:
- **KEEP (real functionality)**: 7 modules
- **STUB (dead Kilo features)**: 8 modules  
- **INLINE (small utilities)**: 2 modules

---

## 1. `src/kilocode/const.ts` — KEEP

**What it does:**
- Defines HTTP headers for Kilo branding (User-Agent, HTTP-Referer, X-Title)
- Used to identify requests as coming from Kilo Code CLI
- Uses Installation.VERSION to set version number

**Who imports it:**
- `src/session/llm.ts` — Uses DEFAULT_HEADERS in LLM request setup
- `src/provider/provider.ts` — Uses DEFAULT_HEADERS in multiple provider configs

**Assessment: KEEP**
- These headers are essential for API tracking and Kilo gateway integration
- Removing them would break Kilo Gateway compatibility
- Currently spawnbot is NOT using Kilo Gateway but inherits this from fork
- Decision: **Keep for now** (Kilo Gateway may be added later), but mark for removal if not needed

---

## 2. `src/kilocode/dispose.ts` — KEEP

**What it does:**
- Debounced `Instance.disposeAll()` wrapper
- Coalesces rapid dispose requests into a single call (300ms window)
- Prevents disposal/recreation churn during bulk auth operations

**Who imports it:**
- `src/server/server.ts` — Calls scheduleDisposeAll() on auth delete
- `src/provider/auth.ts` — Imports but usage unclear (need context)

**Assessment: KEEP**
- Solves real performance problem during auth migrations
- 300ms debounce is intentional (prevents thrashing)
- Needed for stable provider lifecycle management

---

## 3. `src/kilocode/editor-context.ts` — INLINE

**What it does:**
- Builds editor context environment lines (date, timezone, active file, open tabs, shell)
- Used in system prompt to give LLM awareness of user's VS Code state
- Functions: `editorContextEnvLines()`, `formatDate()`

**Who imports it:**
- `src/session/system.ts` — Calls editorContextEnvLines() once to build system prompt

**Assessment: INLINE**
- Only 42 lines, single function call site
- High cohesion with system prompt generation
- Could be moved into session/system.ts or deleted (not spawnbot feature)
- **Recommendation**: INLINE into session/system.ts since it's VS Code-specific (spawnbot has no VS Code context)

---

## 4. `src/kilocode/enhance-prompt.ts` — STUB

**What it does:**
- LLM-powered prompt enhancement (polishing user input)
- Uses "compaction" agent to rewrite prompts with 0.7 temperature
- Returns cleaned text without code fences or quotes

**Who imports it:**
- `src/server/routes/enhance-prompt.ts` — Single POST endpoint

**Assessment: STUB (dead feature)
- Endpoint exists but likely unused in spawnbot
- Kilocode feature (polishing user input before sending to LLM)
- Spawnbot doesn't do this (no auto-enhance use case)
- **Recommendation**: STUB — Replace with 204 No Content or remove endpoint

---

## 5. `src/kilocode/ignore-migrator.ts` — KEEP

**What it does:**
- Migrates .kilocodeignore files to opencode permission config
- Parses gitignore-style patterns
- Converts to glob patterns for opencode's permission system
- Reads from global ~/.kilocode/ and project .kilocodeignore

**Who imports it:**
- `src/config/config.ts` — Calls IgnoreMigrator.loadIgnoreConfig() during config load

**Assessment: KEEP**
- Needed for backwards compatibility with Kilocode projects
- Real functionality (permission rule generation)
- spawnbot users may have .kilocodeignore from previous Kilo Code CLI usage
- Essential for migration path

---

## 6. `src/kilocode/kilo-commands.tsx` — STUB

**What it does:**
- Registers /profile and /teams commands for Kilo Gateway
- Only visible when connected to kilo provider
- Fetches profile, displays teams, allows org switching

**Who imports it:**
- `src/cli/cmd/tui/app.tsx` — Calls registerKiloCommands(useSDK)

**Assessment: STUB (Kilo Gateway feature)
- Requires active Kilo Gateway connection (spawnbot has no Kilo Gateway)
- TUI-only feature
- Would need stub to prevent errors
- **Recommendation**: STUB — Create no-op version or condition on Kilo Gateway availability

---

## 7. `src/kilocode/mcp-migrator.ts` — KEEP

**What it does:**
- Migrates Kilocode MCP server configs to opencode format
- Reads from:
  - VSCode global storage (.kilocode/mcp.json)
  - Project .kilocode/mcp.json
- Converts local/remote server specs to opencode Config.Mcp format

**Who imports it:**
- `src/config/config.ts` — Calls McpMigrator.loadMcpConfig() during config load

**Assessment: KEEP**
- Real functionality (MCP server migration)
- Essential for users upgrading from Kilocode with custom MCP servers
- Handles both global and project-level configs

---

## 8. `src/kilocode/modes-migrator.ts` — KEEP

**What it does:**
- Migrates Kilocode "modes" (custom agents) to opencode agents
- Reads from:
  - VSCode extension storage
  - ~/.kilocode/cli/global/settings/custom_modes.yaml
  - ~/.kilocodemodes (legacy)
  - Project .kilocodemodes
- Converts KilocodeMode to Config.Agent (with permission mapping)
- Skips default modes (code, build, architect, ask, debug, orchestrator)

**Who imports it:**
- `src/config/config.ts` — Calls ModesMigrator.migrate() during config load

**Assessment: KEEP**
- Real functionality (custom agent migration)
- Complex permission mapping logic (groups → permissions)
- Essential for users with custom Kilo modes

---

## 9. `src/kilocode/paths.ts` — KEEP

**What it does:**
- Provides paths to Kilocode directories:
  - vscodeGlobalStorage() — Platform-specific VS Code extension storage
  - globalDir() — ~/.kilocode
  - skillDirectories() — Discover .kilocode/skills recursively
- Used for skill discovery and migration source paths

**Who imports it:**
- `src/skill/skill.ts` — Calls KilocodePaths.skillDirectories() for skill discovery
- `src/kilocode/mcp-migrator.ts` — Uses vscodeGlobalStorage()
- `src/kilocode/modes-migrator.ts` — Uses vscodeGlobalStorage()
- `src/kilocode/workflows-migrator.ts` — Uses vscodeGlobalStorage()

**Assessment: KEEP**
- Essential utility for finding legacy Kilo files
- Used by skill discovery (spawnbot feature)
- Platform-specific path logic (macOS/Windows/Linux)

---

## 10. `src/kilocode/plan-followup.ts` — STUB

**What it does:**
- Handles handoff from planning sessions to implementation sessions
- Generates "handover" summary from planning messages
- Offers user choice: continue in same session or start new implementation session
- Used in TUI prompt loop (plan agent)

**Who imports it:**
- `src/session/prompt.ts` — Calls PlanFollowup.ask() in SessionPrompt.loop

**Assessment: STUB (Kilo Code workflow)
- Part of Kilo's "plan → implement" workflow
- Spawnbot doesn't use plan mode this way (no structured plan output)
- User choice is specific to Kilo's session/agent architecture
- **Recommendation**: STUB — Keep as-is (no-op when plan mode unused) or remove if plan mode not used

---

## 11. `src/kilocode/project-id.ts` — KEEP

**What it does:**
- Resolves project ID from two sources (priority order):
  1. .kilocode/config.json
  2. git origin URL
- Normalizes git URLs (extracts repo name, truncates to 100 chars)
- Cached per-project using Instance.state()
- Used as HTTP header value for Kilo Gateway tracking

**Who imports it:**
- `src/session/llm.ts` — Calls getKiloProjectId() to get project identifier for requests

**Assessment: KEEP**
- Needed for Kilo Gateway integration (X-Project-ID header)
- Real git/config parsing logic
- Essential if Kilo Gateway used; safe if not (returns undefined)

---

## 12. `src/kilocode/review/command.ts` — STUB

**What it does:**
- Creates two command templates:
  - localReviewUncommittedCommand() → /local-review-uncommitted
  - localReviewCommand() → /local-review
- Delegates to Review.buildReviewPrompt*() for prompt generation

**Who imports it:**
- `src/command/index.ts` — Registers both commands in command registry

**Assessment: STUB (if review.ts is unused)
- Depends on review/review.ts implementation
- See review.ts assessment below

---

## 13. `src/kilocode/review/review.ts` — KEEP (but optional)

**What it does:**
- Code review system for git changes
- Scopes: uncommitted changes, branch diff vs base
- Parses unified diff output into structured DiffFile/DiffHunk
- Generates review prompts with file lists, tools available, confidence guidelines
- Git operations: git diff, git log, git blame

**Who imports it:**
- `src/server/routes/experimental.ts` — Uses Review for experimental review endpoint
- `src/kilocode/review/command.ts` — Calls Review.buildReviewPrompt*()

**Assessment: KEEP (optional feature)
- Real code review functionality (NOT Kilo-specific, general purpose)
- Can be used without Kilo Gateway
- Experimental routes suggest low priority
- **Decision**: KEEP but mark as optional (can be removed if not using review commands)

---

## 14. `src/kilocode/rules-migrator.ts` — KEEP

**What it does:**
- Discovers and migrates instruction rules from multiple sources:
  - ~/.kilocode/rules/*.md (global)
  - .kilocode/rules/*.md (project)
  - .kilocoderules (legacy)
  - .kilocode/rules-{mode}/*.md (mode-specific)
  - .kilocoderules-{mode} (legacy mode-specific)
- Returns list of rule files for system prompt injection

**Who imports it:**
- `src/config/config.ts` — Calls RulesMigrator.migrate() during config load

**Assessment: KEEP**
- Real functionality (rule discovery and migration)
- Essential for users upgrading from Kilo Code with custom rules
- Spawnbot uses instructions (similar concept to rules)

---

## 15. `src/kilocode/workflows-migrator.ts` — KEEP

**What it does:**
- Migrates Kilocode workflows to opencode commands
- Reads from:
  - VSCode extension storage (.kilocode/workflows)
  - ~/.kilocode/workflows (global)
  - .kilocode/workflows (project)
- Extracts workflow name and description
- Converts to Config.Command format

**Who imports it:**
- `src/config/config.ts` — Calls WorkflowsMigrator.migrate() during config load

**Assessment: KEEP**
- Real functionality (workflow → command migration)
- Essential for users with custom workflows

---

## 16. `src/kilocode/components/dialog-kilo-auto-method.tsx` — STUB

**What it does:**
- OAuth dialog for Kilo Gateway device auth flow
- Polls for OAuth completion
- Fetches user profile
- Shows organization selection if user has teams
- Fallback: uses personal account if profile fetch fails

**Who imports it:**
- `src/cli/cmd/tui/component/dialog-provider.tsx` — Used as custom auth dialog

**Assessment: STUB (Kilo Gateway feature)
- Tightly coupled to Kilo Gateway OAuth flow
- Spawnbot has no Kilo Gateway integration
- TUI-only component
- **Recommendation**: STUB — Replace with generic auth dialog or no-op

---

## 17. `src/kilocode/components/kilo-news.tsx` — STUB

**What it does:**
- Fetches and displays Kilo news/notifications
- Shows banner on home screen
- Clicking opens dialog with all notifications
- Only visible when connected to "kilo" provider

**Who imports it:**
- `src/cli/cmd/tui/routes/home.tsx` — Renders KiloNews component

**Assessment: STUB (Kilo Gateway feature)
- Depends on Kilo Gateway notifications API
- TUI-only component
- Empty when not connected to kilo provider
- **Recommendation**: STUB — Safe to keep (no-op when kilo not connected), but can be removed

---

## 18. `src/kilocode/components/tips.tsx` — INLINE/DELETE

**What it does:**
- Displays random tips from hardcoded TIPS array
- Parses markup (e.g., {highlight}...{/highlight})
- 52 Kilo-branded tips (mostly CLI commands, some generic)

**Who imports it:**
- `src/cli/cmd/tui/component/tips.tsx` — Exports directly (re-export)

**Assessment: INLINE/DELETE
- Could be deleted (tips are Kilo branding)
- Or inline tips into component/tips.tsx
- Tips are stale (reference Kilo-specific commands not in spawnbot)
- **Recommendation**: DELETE or replace with spawnbot-specific tips

---

## Summary Table

| Module | Category | Reason |
|--------|----------|--------|
| const.ts | KEEP | Kilo Gateway headers (optional but safe) |
| dispose.ts | KEEP | Performance optimization (real need) |
| editor-context.ts | INLINE | VS Code-specific, single call site |
| enhance-prompt.ts | STUB | Dead Kilo feature, unused endpoint |
| ignore-migrator.ts | KEEP | Migration compatibility |
| kilo-commands.tsx | STUB | Kilo Gateway only, dead in spawnbot |
| mcp-migrator.ts | KEEP | Real MCP migration functionality |
| modes-migrator.ts | KEEP | Real agent migration functionality |
| paths.ts | KEEP | Needed for skill discovery and migration |
| plan-followup.ts | STUB | Plan mode workflow (optional) |
| project-id.ts | KEEP | Kilo Gateway tracking (safe if unused) |
| review/command.ts | STUB | Depends on review.ts usage |
| review/review.ts | KEEP | General code review (optional feature) |
| rules-migrator.ts | KEEP | Rule discovery and migration |
| workflows-migrator.ts | KEEP | Workflow → command migration |
| dialog-kilo-auto-method.tsx | STUB | Kilo Gateway OAuth only |
| kilo-news.tsx | STUB | Kilo Gateway notifications only |
| components/tips.tsx | DELETE | Stale Kilo tips, not spawnbot-relevant |
