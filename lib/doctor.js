/**
 * Doctor — diagnostic checks for spawnbot installation and configuration.
 *
 * Checks framework prerequisites, agent config, MCP servers, database,
 * Telegram connectivity, daemon status, and log files.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { section, step, c } from './setup/util.js';
import { readPidFile, isProcessRunning } from './daemon/pid.js';
import { hasPasswordlessSudo } from './service/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = resolve(__dirname, '..');

/**
 * Run all diagnostic checks.
 * @param {string} projectRoot — agent directory
 * @returns {Promise<{ passed: number, failed: number, warned: number }>}
 */
export async function runDoctor(projectRoot) {
  let passed = 0;
  let failed = 0;
  let warned = 0;

  const pass = (label, detail) => { passed++; step(label, 'pass', detail); };
  const fail = (label, detail) => { failed++; step(label, 'fail', detail); };
  const warn = (label, detail) => { warned++; step(label, 'warn', detail); };

  // ── Framework ─────────────────────────────────────

  section('Framework');

  // Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  if (nodeMajor >= 20) {
    pass('Node.js', nodeVersion);
  } else {
    fail('Node.js', `${nodeVersion} — requires 20+`);
  }

  // Kimi CLI
  try {
    const kimiVersion = execFileSync('kimi', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    pass('Kimi CLI', kimiVersion);
  } catch {
    fail('Kimi CLI', 'not found — install: uv tool install kimi-cli');
  }

  // Framework directory
  if (existsSync(resolve(FRAMEWORK_ROOT, 'bin', 'spawnbot.js'))) {
    pass('Framework', FRAMEWORK_ROOT);
  } else {
    fail('Framework', `not found at ${FRAMEWORK_ROOT}`);
  }

  // ── Agent Config ──────────────────────────────────

  section('Agent Configuration');

  const configDir = resolve(projectRoot, 'config');
  if (existsSync(configDir)) {
    pass('config/ directory');
  } else {
    fail('config/ directory', 'missing — run: spawnbot setup');
  }

  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) {
    pass('.env file');
  } else {
    warn('.env file', 'missing — credentials not configured');
  }

  const requiredConfigs = [
    ['SOUL.yaml', 'config/SOUL.yaml'],
    ['CRONS.yaml', 'config/CRONS.yaml'],
    ['agent.yaml', 'config/agent/agent.yaml'],
    ['system.md', 'config/agent/system.md'],
  ];

  for (const [label, relPath] of requiredConfigs) {
    if (existsSync(resolve(projectRoot, relPath))) {
      pass(label);
    } else {
      fail(label, `missing at ${relPath}`);
    }
  }

  // ── MCP Servers ───────────────────────────────────

  section('MCP Servers');

  const mcpPath = resolve(projectRoot, 'data', 'mcp.json');
  if (existsSync(mcpPath)) {
    pass('mcp.json', mcpPath);

    try {
      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf8'));
      const servers = mcpConfig.mcpServers || {};

      for (const [name, server] of Object.entries(servers)) {
        const binary = server.args?.[0];
        if (binary && existsSync(binary)) {
          pass(`${name} server`, binary);
        } else if (binary) {
          fail(`${name} server`, `binary not found: ${binary}`);
        } else {
          warn(`${name} server`, 'no binary path in config');
        }
      }

      if (Object.keys(servers).length === 0) {
        warn('MCP servers', 'none configured');
      }
    } catch (err) {
      fail('mcp.json', `parse error: ${err.message}`);
    }
  } else {
    warn('mcp.json', 'not generated yet — run: spawnbot config generate');
  }

  // ── Database ──────────────────────────────────────

  section('Database');

  const dbPath = resolve(projectRoot, 'data', 'agent.sqlite');
  if (existsSync(dbPath)) {
    const sizeKB = Math.round(statSync(dbPath).size / 1024);
    pass('agent.sqlite', `${sizeKB}KB`);

    // Try to open read-only and check tables
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
      const expectedTables = ['memories', 'conversations', 'tasks', 'state', 'events', 'revenue'];

      for (const table of expectedTables) {
        if (tables.includes(table)) {
          const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
          pass(`table: ${table}`, `${count.c} rows`);
        } else {
          warn(`table: ${table}`, 'missing');
        }
      }

      db.close();
    } catch (err) {
      fail('Database read', err.message);
    }
  } else {
    warn('agent.sqlite', 'not created yet — starts on first daemon run');
  }

  // ── Telegram ──────────────────────────────────────

  section('Telegram');

  // Load .env for token check
  let telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  let telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramToken && existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    const tokenMatch = envContent.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    const chatIdMatch = envContent.match(/^TELEGRAM_CHAT_ID=(.+)$/m);
    if (tokenMatch) telegramToken = tokenMatch[1].trim();
    if (chatIdMatch) telegramChatId = chatIdMatch[1].trim();
  }

  if (telegramToken) {
    pass('TELEGRAM_BOT_TOKEN', 'set');

    // Verify token with getMe API
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`);
      const data = await res.json();
      if (data.ok) {
        pass('Bot API', `@${data.result.username}`);
      } else {
        fail('Bot API', data.description || 'invalid token');
      }
    } catch (err) {
      fail('Bot API', `connection failed: ${err.message}`);
    }
  } else {
    warn('TELEGRAM_BOT_TOKEN', 'not set — Telegram disabled');
  }

  if (telegramChatId) {
    pass('TELEGRAM_CHAT_ID', telegramChatId);
  } else if (telegramToken) {
    warn('TELEGRAM_CHAT_ID', 'not set — bot won\'t know where to send messages');
  }

  // ── Daemon ────────────────────────────────────────

  section('Daemon');

  const pid = readPidFile(projectRoot);
  if (pid) {
    if (isProcessRunning(pid)) {
      pass('Daemon process', `running (PID: ${pid})`);
    } else {
      warn('Daemon process', `stale PID file (${pid} not running)`);
    }
  } else {
    step('Daemon process', null, 'not running');
  }

  if (hasPasswordlessSudo()) {
    pass('Passwordless sudo');
  } else {
    warn('Passwordless sudo', 'not configured — agent may hang on sudo commands. Fix: spawnbot service install');
  }

  // ── Logs ──────────────────────────────────────────

  section('Logs');

  const logsDir = resolve(projectRoot, 'data', 'logs');
  if (existsSync(logsDir)) {
    pass('data/logs/ directory');
  } else {
    warn('data/logs/ directory', 'missing — created on first daemon run');
  }

  const logFile = resolve(logsDir, 'spawnbot.log');
  if (existsSync(logFile)) {
    const sizeKB = Math.round(statSync(logFile).size / 1024);
    pass('spawnbot.log', `${sizeKB}KB`);

    // Count recent errors
    try {
      const content = readFileSync(logFile, 'utf8');
      const lines = content.split('\n');
      const recentErrors = lines.filter(l => l.includes('[ERROR]')).slice(-5);
      if (recentErrors.length > 0) {
        warn('Recent errors', `${recentErrors.length} in log`);
        for (const line of recentErrors.slice(-3)) {
          console.log(c.dim(`    ${line.slice(0, 120)}`));
        }
      } else {
        pass('Recent errors', 'none');
      }
    } catch {
      // Can't read log, that's fine
    }
  } else {
    step('spawnbot.log', null, 'no log file yet');
  }

  const wireLog = resolve(logsDir, 'wire.jsonl');
  if (existsSync(wireLog)) {
    const sizeKB = Math.round(statSync(wireLog).size / 1024);
    pass('wire.jsonl', `${sizeKB}KB`);
  } else {
    step('wire.jsonl', null, 'no wire log yet');
  }

  // ── Summary ───────────────────────────────────────

  console.log();
  const total = passed + failed + warned;
  const summary = [
    c.success(`${passed} passed`),
    failed > 0 ? c.error(`${failed} failed`) : null,
    warned > 0 ? c.warn(`${warned} warnings`) : null,
  ].filter(Boolean).join(', ');

  console.log(`  ${summary} (${total} checks)`);
  console.log();

  return { passed, failed, warned };
}
