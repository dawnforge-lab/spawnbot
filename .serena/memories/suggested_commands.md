# Suggested Commands

## Running the Project
```bash
# Start daemon in foreground (dev mode with interactive CLI chat)
npm run dev
# or: node bin/spawnbot.js start --foreground

# Start daemon (background)
npm start
# or: node bin/spawnbot.js start

# Other CLI commands
node bin/spawnbot.js stop       # Stop the daemon (waits for clean exit)
node bin/spawnbot.js restart    # Stop + start the daemon
node bin/spawnbot.js status     # Check daemon status
node bin/spawnbot.js setup      # Interactive setup wizard
node bin/spawnbot.js config     # View/edit config
node bin/spawnbot.js update     # Pull latest code + regenerate configs + restart
node bin/spawnbot.js upgrade    # Check for and install Kimi CLI updates
```

## Database
```bash
# Generate new migration after schema changes
npm run db:generate
# or: npx drizzle-kit generate

# Apply migrations
npm run db:migrate
# or: npx drizzle-kit migrate
```

## MCP Servers (run standalone for testing)
```bash
node bin/mcp-telegram.js        # Telegram MCP server
node bin/mcp-core.js            # Core agent tools MCP server
```

## Installation
```bash
# Install framework + run setup automatically
curl -fsSL https://raw.githubusercontent.com/dawnforge-lab/spawnbot/main/install.sh | bash

# Re-run setup if needed
spawnbot setup
```

## Deployment
```bash
# systemd service file at deploy/spawnbot.service
# logrotate config at deploy/logrotate.conf
```

## Git & System
```bash
git status          # Check working tree
git log --oneline   # Recent commits
git diff            # View changes
ls                  # List files
```

## Notes
- No test framework configured (no test command in package.json)
- No linter/formatter configured
- No build step needed — plain JS, runs directly
