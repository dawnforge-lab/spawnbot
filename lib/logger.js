/**
 * Lightweight tagged logger with file output.
 *
 * Usage:
 *   import { createLogger, initLogFile, closeLogFile } from './logger.js';
 *   const log = createLogger('DAEMON');
 *   log.info('Started');
 *   log.error('Failed', err);
 */

import { createWriteStream, existsSync, mkdirSync, accessSync, unlinkSync, constants, readdirSync } from 'fs';
import { dirname, resolve } from 'path';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_NAMES = ['ERROR', 'WARN ', 'INFO ', 'DEBUG'];

let _stream = null;
let _level = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;
const _isTTY = process.stdout.isTTY === true;

/**
 * Initialize file logging. Call once during daemon startup.
 * @param {string} logPath — absolute path to spawnbot.log
 */
export function initLogFile(logPath) {
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Remove unwritable log files (e.g. owned by root from sudo/systemd)
  _fixLogPermissions(dir);

  _stream = createWriteStream(logPath, { flags: 'a' });
  _stream.on('error', (err) => {
    console.error(`[LOGGER] File write error: ${err.message}`);
    _stream = null;
  });
}

/**
 * Remove unwritable log files so they get recreated with correct ownership.
 * Handles the case where a previous sudo/systemd run created root-owned files.
 */
function _fixLogPermissions(dir) {
  try {
    for (const file of readdirSync(dir)) {
      const filePath = resolve(dir, file);
      try {
        accessSync(filePath, constants.W_OK);
      } catch {
        try { unlinkSync(filePath); } catch {}
      }
    }
  } catch {
    // Best effort — logger will fall back to console if files can't be fixed
  }
}

/**
 * Close the log file stream.
 */
export function closeLogFile() {
  if (_stream) {
    _stream.end();
    _stream = null;
  }
}

/**
 * Update the log level at runtime.
 * @param {string} level — 'error', 'warn', 'info', or 'debug'
 */
export function setLogLevel(level) {
  const num = LEVELS[level?.toLowerCase()];
  if (num !== undefined) _level = num;
}

function formatLine(levelIdx, tag, message, extra) {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${LEVEL_NAMES[levelIdx]}] [${tag}] ${message}`;
  if (extra instanceof Error) {
    line += `: ${extra.message}`;
  } else if (extra !== undefined) {
    line += ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  }
  return line;
}

function writeLog(levelIdx, tag, message, extra) {
  if (levelIdx > _level) return;

  const line = formatLine(levelIdx, tag, message, extra);

  // Write to file stream if available
  if (_stream) {
    _stream.write(line + '\n');
  }

  // Write to console: always if interactive (TTY) or if file logging not yet initialized
  if (_isTTY || !_stream) {
    const fn = levelIdx === 0 ? console.error
      : levelIdx === 1 ? console.warn
      : console.log;
    fn(line);
  }
}

/**
 * Create a tagged logger instance.
 * @param {string} tag — module tag, e.g. 'DAEMON', 'ROUTER'
 * @returns {{ error, warn, info, debug }}
 */
export function createLogger(tag) {
  return {
    error: (msg, extra) => writeLog(0, tag, msg, extra),
    warn:  (msg, extra) => writeLog(1, tag, msg, extra),
    info:  (msg, extra) => writeLog(2, tag, msg, extra),
    debug: (msg, extra) => writeLog(3, tag, msg, extra),
  };
}
