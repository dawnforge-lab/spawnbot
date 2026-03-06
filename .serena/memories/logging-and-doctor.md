# Logging Infrastructure & Doctor Command

## Logger Module (`lib/logger.js`)
- Zero-dependency tagged logger with file output
- Levels: error=0, warn=1, info=2, debug=3 (default: info)
- `LOG_LEVEL` env var controls filtering
- `initLogFile(path)` — opens append-mode write stream
- `closeLogFile()` — closes stream
- `createLogger(tag)` — returns `{ error, warn, info, debug }`
- TTY detection: skips console when `!process.stdout.isTTY && _stream`
- Dual output: file stream + console (when TTY or no file stream)

## Migrated Files (15 total)
All `console.log/error/warn` calls in lib/ replaced with tagged logger, except:
- `lib/setup/*.js` — user-facing UI (chalk, ora, inquirer)
- `lib/wire/display.js` — real-time streaming display
- `lib/mcp/*.js` — MCP servers (stdout is JSON-RPC)
- `lib/logger.js` — the logger itself

Tags used: DAEMON, TURN, ROUTER, QUEUE, TG-LISTEN, CRON, AUTONOMY, POLLER, WIRE, HTTP, NGROK, DB, CONFIG, MCP-CONFIG, PERSONALITY

## Doctor Command (`lib/doctor.js`)
- `spawnbot doctor` — runs diagnostic checks
- Checks: Framework (Node.js, Kimi CLI), Agent Config, MCP Servers, Database, Telegram, Daemon, Logs
- Uses `section()`, `step()`, `c` from `lib/setup/util.js` for formatted output
- Uses `readPidFile()`, `isProcessRunning()` from `lib/daemon/pid.js`
- Verifies Telegram bot token via getMe API
- Opens SQLite read-only to check tables
- Exit code 1 if any failures
