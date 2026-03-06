# Codebase Structure

## Top-Level
```
bin/                    # CLI entry points
  spawnbot.js           # Main CLI: start, stop, restart, status, setup, config + foreground slash commands
  mcp-telegram.js       # Telegram MCP server (core)
  mcp-core.js           # Agent Tools MCP server (core)

lib/                    # Core library
  daemon/               # Daemon lifecycle, health, state
    index.js            # Daemon class (start, stop, health check, signal handling, config file watcher, restart mutex, MCP pre-flight validation)
    pid.js              # PID file management
  wire/                 # Wire protocol client (JSON-RPC over stdio)
    client.js           # WireClient class (spawn, prompt, steer, cancel)
    handler.js          # Event handler for wire messages
    display.js          # Interactive wire display (tool calls, thinking, content streaming, turn headers/footers)
  input/                # Input processing
    queue.js            # InputQueue class (priority-based)
    router.js           # Input routing
    telegram-listener.js # Telegram message listener
    cron.js             # Cron scheduler (supports workspace: true for branch-based jobs)
    autonomy.js         # Autonomous operation loop
    poller-manager.js   # Generic poller for integrations
  mcp/                  # MCP server framework
    base-server.js      # McpServer base class
    tool.js             # Tool definition helpers
    telegram/           # Telegram MCP (tg_send, tg_photo, tg_react)
      server.js
      bot.js
    core/               # Agent tools MCP (memory, tasks, state)
      server.js
      playbook.js
  db/                   # Database layer
    schema.js           # Drizzle schema (memories, conversations, tasks, etc.)
    index.js            # DB initialization
    memory.js           # Memory operations
  config/               # Configuration
    index.js            # Config loader
    validate.js         # Config validator
  personality/          # SOUL.yaml handling
    loader.js           # Personality/SOUL loader
  persona/              # System prompt assembly
    prompt-builder.js   # Build system prompt from SOUL + config
    mcp-config.js       # Generate MCP config for Kimi CLI
  flow/                 # Flow engine
    parser.js           # Flow DSL parser
    runner.js           # Flow executor
    loader.js           # Flow file loader
  http/                 # HTTP server
    server.js           # Webhook/API server (includes /webhook/github with HMAC validation)
    ngrok.js            # ngrok tunnel support
  setup/                # Interactive setup wizard
    index.js            # Setup orchestrator (7 phases)
    util.js             # Setup utilities
    setup-prompt.md     # LLM prompt for setup
    steps/              # Individual setup steps
      workspace.js      # Git/GitHub workspace setup
    skill-templates/    # Templates for skill creation
      github-workspace.md # Git workspace skill
  service/              # Service utilities
  telegram/             # Telegram helpers

skills/                 # Flow skills and prompt modules
  tool-creation/SKILL.md
  skill-creation/SKILL.md

deploy/                 # Deployment files
  install.sh
  spawnbot.service      # systemd service
  logrotate.conf

drizzle/                # Generated DB migrations
```

## v2 Extension Structure (in openclaw fork)
```
extensions/
  agent-memory/          # Epic 2: Structured memory (SQLite, FTS5, decay)
    db/                  # Schema, init, CRUD operations
    tools/               # memory_store, memory_recall, memory_browse, memory_delete
    hooks/               # conversation-logger, context-director
    services/            # decay-service
  autonomy-engine/       # Epic 3: Autonomy engine
    hooks/               # source-attribution
    services/            # autonomy-loop, poller-manager
    types.ts             # Shared types (PollerModule, PollEvent, Priority)
```

## Database Tables (SQLite via Drizzle)
| Table | Purpose |
|-------|---------|
| memories | Long-term memory (content, category, importance) |
| conversations | Interaction log (source, input, output, tools) |
| tasks | Task assignments (status, deadlines, proof) |
| revenue | Income records |
| state | Key-value store (daemon state, poller state) |
| events | Audit log |
