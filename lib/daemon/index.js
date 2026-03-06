import { EventEmitter } from 'events';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, watch } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { execSync, execFileSync } from 'child_process';
import { writePidFile, removePidFile } from './pid.js';
import { getConfig } from '../config/index.js';
import { WireClient } from '../wire/client.js';
import { InputQueue } from '../input/queue.js';
import { InputRouter } from '../input/router.js';
import { TelegramListener } from '../input/telegram-listener.js';
import { CronScheduler } from '../input/cron.js';
import { AutonomyLoop } from '../input/autonomy.js';
import { PollerManager } from '../input/poller-manager.js';
import { HttpServer } from '../http/server.js';
import { NgrokTunnel } from '../http/ngrok.js';
import { initDatabase, getSqlite, closeDatabase } from '../db/index.js';
import { buildSystemPrompt } from '../persona/prompt-builder.js';
import { generateMcpConfig } from '../persona/mcp-config.js';
import { sendMessage, startTypingIndicator } from '../telegram/bot.js';
import { createLogger, initLogFile, closeLogFile } from '../logger.js';

const log = createLogger('DAEMON');
const turnLog = createLogger('TURN');

const STATES = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
};

export class Daemon extends EventEmitter {
  constructor({ projectRoot }) {
    super();
    this.projectRoot = projectRoot;
    this.state = STATES.STOPPED;
    this.wire = null;
    this.config = null;
    this.startedAt = null;
    this.restartCount = 0;
    this.restartBackoff = 1000;
    this.restartTimer = null;
    this.healthTimer = null;
    this.subsystems = [];
    this.queue = null;
    this.router = null;
    this.httpServer = null;
    this.ngrokTunnel = null;
    this.telegramListener = null;
    this.cronScheduler = null;
    this.autonomyLoop = null;
    this.pollerManager = null;
    this.typingIndicators = new Map(); // chatId → stopFn
    this.configWatcher = null;
    this._restarting = false;
  }

  async start() {
    if (this.state === STATES.RUNNING || this.state === STATES.STARTING) {
      log.warn('Daemon is already running');
      return;
    }

    this.state = STATES.STARTING;

    // Ensure data directories exist
    this.config = await getConfig(this.projectRoot);
    for (const dir of [this.config.paths.data, this.config.paths.logs]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Initialize file logging
    initLogFile(resolve(this.config.paths.logs, 'spawnbot.log'));
    log.info('Agent daemon starting...');

    // Write PID
    writePidFile(this.projectRoot, process.pid);

    // Setup signal handlers
    this._setupSignals();

    // Initialize database
    const dbPath = resolve(this.config.paths.data, 'agent.sqlite');
    initDatabase(dbPath);

    // Generate system prompt and MCP config
    buildSystemPrompt(this.projectRoot);
    generateMcpConfig(this.projectRoot);
    log.info('Persona and MCP config generated');

    // Create input queue
    this.queue = new InputQueue();

    // Validate MCP servers before starting Wire
    this._failedMcpServers = this._validateMcpServers();

    // Start Wire client (Kimi CLI)
    await this._startWire();
    this._trackMcpConfigMtime();
    this._storeKimiVersion();

    // Create input router
    this.router = new InputRouter({ queue: this.queue, wireClient: this.wire });
    this.router.on('turn_start', (item) => {
      turnLog.info(`${item.source}/${item.senderName}: ${(item.content || '').slice(0, 80)}`);

      // Auto-start typing indicator for Telegram-sourced items
      if (item.source === 'telegram' && item.metadata?.chatId) {
        const chatId = item.metadata.chatId;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          const existing = this.typingIndicators.get(chatId);
          if (existing) existing();
          const stop = startTypingIndicator(token, chatId);
          this.typingIndicators.set(chatId, stop);
        }
      }
    });
    this.router.on('turn_end', ({ item, response, durationMs }) => {
      turnLog.info(`Completed in ${durationMs}ms`);
      this.autonomyLoop?.recordActivity();
      this._checkMcpConfigChanged().catch(err => log.error('MCP config check failed', err));

      // Auto-log conversation turn
      try {
        const sqlite = getSqlite();
        sqlite.prepare(`
          INSERT INTO conversations (id, source, sender_id, sender_name, input_text, output_text, tools_used, turn_duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), item.source, item.senderId || null, item.senderName || null, item.content, response || null, null, durationMs, Date.now());
      } catch (err) {
        log.error('Failed to log conversation turn', err);
      }

      // Stop typing indicator if active
      if (item.source === 'telegram' && item.metadata?.chatId) {
        const stop = this.typingIndicators.get(item.metadata.chatId);
        if (stop) {
          stop();
          this.typingIndicators.delete(item.metadata.chatId);
        }
      }

      // Auto-route response to Telegram (all sources except CLI)
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = item.metadata?.chatId || process.env.TELEGRAM_CHAT_ID;
      if (token && chatId && response && item.source !== 'cli') {
        sendMessage(token, chatId, response).catch((err) => {
          log.error('Failed to send Telegram response', err);
        });
      }
    });
    this.router.on('turn_error', ({ item, error }) => {
      turnLog.error('Turn error', error);

      if (item.source === 'telegram' && item.metadata?.chatId) {
        const chatId = item.metadata.chatId;

        // Stop typing indicator
        const stop = this.typingIndicators.get(chatId);
        if (stop) {
          stop();
          this.typingIndicators.delete(chatId);
        }

        // Notify user about the error
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          sendMessage(token, chatId, `Error processing your message: ${error.message}`).catch((err) => {
            log.error('Failed to send error notification', err);
          });
        }
      }
    });
    this.registerSubsystem({ name: 'router', stop: () => this.router.stop() });

    // Start HTTP server
    const httpPort = this.config.http?.port || 31415;
    const webhookSecret = process.env.WEBHOOK_SECRET || randomUUID();
    this.httpServer = new HttpServer({
      port: httpPort,
      daemon: this,
      apiKey: this.config.http?.apiKey || '',
      webhookSecret,
      githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    });
    await this.httpServer.start();
    this.registerSubsystem({ name: 'http', stop: () => this.httpServer.stop() });

    // Start ngrok tunnel (optional)
    const ngrokAuthtoken = this.config.ngrok?.authtoken;
    if (ngrokAuthtoken) {
      this.ngrokTunnel = new NgrokTunnel({
        authtoken: ngrokAuthtoken,
        domain: this.config.ngrok?.domain || null,
        port: httpPort,
      });

      this.ngrokTunnel.on('connected', (url) => {
        this.httpServer.publicUrl = url;
        log.info(`Public URL: ${url}`);
        // Store in SQLite for `spawnbot status` to read
        try {
          const sqlite = getSqlite();
          const now = Date.now();
          sqlite.prepare(
            "INSERT INTO state (key, value, updated_at) VALUES ('public_url', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?"
          ).run(url, now, url, now);
        } catch {}
        // Switch Telegram to webhook mode if available
        if (this.telegramListener?.running) {
          this.telegramListener.switchToWebhook(`${url}/webhook/telegram`).catch((err) => {
            log.error('Failed to switch Telegram to webhook', err);
          });
        }
      });

      this.ngrokTunnel.on('disconnected', () => {
        this.httpServer.publicUrl = null;
        // Switch Telegram back to polling
        if (this.telegramListener?.running) {
          this.telegramListener.switchToPolling().catch((err) => {
            log.error('Failed to switch Telegram to polling', err);
          });
        }
      });

      await this.ngrokTunnel.start();
      this.registerSubsystem({ name: 'ngrok', stop: () => this.ngrokTunnel.stop() });
    }

    // Support PUBLIC_URL for VPS deployments (no ngrok needed)
    if (!this.httpServer.publicUrl && this.config.publicUrl) {
      this.httpServer.publicUrl = this.config.publicUrl;
    }

    // Start Telegram listener (core)
    const webhookUrl = this.httpServer.publicUrl
      ? `${this.httpServer.publicUrl}/webhook/telegram`
      : null;
    this.telegramListener = new TelegramListener({
      queue: this.queue,
      token: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      safeword: this.config.safeword,
      httpServer: this.httpServer,
      webhookUrl,
      webhookSecret,
      projectRoot: this.projectRoot,
    });
    this.telegramListener.on('safeword', () => {
      log.error('SAFEWORD — EMERGENCY SHUTDOWN');
      this.stop().then(() => process.exit(1));
    });
    this.registerSubsystem({ name: 'telegram-listener', stop: () => this.telegramListener.stop() });

    // Start cron scheduler
    this.cronScheduler = new CronScheduler({ queue: this.queue, projectRoot: this.projectRoot });
    this.registerSubsystem({ name: 'cron', stop: () => this.cronScheduler.stop() });

    // Start autonomy loop
    const agentName = this.config.soul?.identity?.name || 'Agent';
    this.autonomyLoop = new AutonomyLoop({ queue: this.queue, agentName });
    this.registerSubsystem({ name: 'autonomy', stop: () => this.autonomyLoop.stop() });

    // Start poller manager (for add-on integrations)
    this.pollerManager = new PollerManager({
      queue: this.queue,
      config: this.config.integrations ? { integrations: this.config.integrations } : {},
      projectRoot: this.projectRoot,
    });
    // Wire poller state persistence to SQLite
    const sqlite = getSqlite();
    this.pollerManager.setStateStore({
      get: (key) => {
        const row = sqlite.prepare('SELECT value FROM state WHERE key = ?').get(key);
        return row?.value || null;
      },
      set: (key, value) => {
        const now = Date.now();
        sqlite.prepare(
          'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
        ).run(key, value, now, value, now);
      },
    });
    this.registerSubsystem({ name: 'poller-manager', stop: () => this.pollerManager.stop() });

    // Start all subsystems
    await this.telegramListener.start();
    this.cronScheduler.start();
    this.autonomyLoop.start();
    await this.pollerManager.start();
    await this.router.start();

    // Watch config files for live reload
    this._watchConfigFiles();

    // Start health check loop
    this._startHealthCheck();

    this.state = STATES.RUNNING;
    this.startedAt = Date.now();
    log.info('Agent daemon running');
    this.emit('started');
  }

  async stop() {
    if (this.state === STATES.STOPPED || this.state === STATES.STOPPING) return;

    this.state = STATES.STOPPING;
    log.info('Agent daemon stopping...');

    // Clear timers
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);

    // Stop all typing indicators
    for (const [, stop] of this.typingIndicators) {
      stop();
    }
    this.typingIndicators.clear();

    // Stop subsystems in reverse order
    for (const sub of [...this.subsystems].reverse()) {
      try {
        await sub.stop?.();
      } catch (err) {
        log.error(`Error stopping ${sub.name}`, err);
      }
    }
    this.subsystems = [];

    // Kill Wire client
    if (this.wire) {
      this.wire.kill();
      this.wire = null;
    }

    // Close database
    closeDatabase();

    // Cleanup
    removePidFile(this.projectRoot);
    this.state = STATES.STOPPED;
    log.info('Agent daemon stopped');
    closeLogFile();
    this.emit('stopped');
  }

  getStatus() {
    return {
      state: this.state,
      pid: process.pid,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      restartCount: this.restartCount,
      wireConnected: this.wire?.isConnected() || false,
      queue: this.queue?.stats() || null,
      router: this.router?.getState() || null,
      http: this.httpServer ? {
        port: this.httpServer.port,
        publicUrl: this.httpServer.publicUrl,
      } : null,
      ngrok: this.ngrokTunnel ? {
        connected: !!this.ngrokTunnel.url,
        url: this.ngrokTunnel.url,
      } : null,
      cron: this.cronScheduler?.getStatus() || null,
      autonomy: this.autonomyLoop?.getStatus() || null,
      pollers: this.pollerManager?.getStatus() || null,
    };
  }

  registerSubsystem(subsystem) {
    this.subsystems.push(subsystem);
  }

  async _startWire() {
    this.wire = new WireClient(this.config);

    this.wire.on('disconnected', (code) => {
      log.error(`Kimi CLI exited with code ${code}`);
      if (this.state === STATES.RUNNING) {
        this._scheduleRestart();
      }
    });

    this.wire.on('error', (err) => {
      log.error('Wire error', err);
    });

    try {
      await this.wire.spawn();
      await this.wire.initialize();
      this.restartBackoff = 1000; // Reset backoff on successful start
      this.restartCount = 0;
      log.info('Kimi CLI connected via Wire protocol');
      this.emit('wire_ready', this.wire);

      // Self-orientation: agent loads its own context using tools
      try {
        log.info('Running startup orientation...');
        let orientationPrompt =
          '[SYSTEM from daemon]: You just started a new session. Quick orientation — use `memory_search` to recall recent context, ' +
          'then reply with a one-line summary. Do NOT read config files or do anything else during orientation.';

        // Notify about failed MCP servers
        if (this._failedMcpServers?.length > 0) {
          const failures = this._failedMcpServers
            .map(f => `- ${f.name}: ${f.reason}`)
            .join('\n');
          orientationPrompt +=
            '\n\nWARNING: The following MCP servers failed pre-flight validation and were removed from your config:\n' +
            failures +
            '\nInvestigate and fix the issue. After updating data/mcp.json, I will reload automatically.';
          this._failedMcpServers = [];
        }

        await this.wire.prompt(orientationPrompt, { timeout: 60000 });
        log.info('Startup orientation complete');
      } catch (err) {
        log.warn(`Startup orientation failed: ${err.message}`);
      }
    } catch (err) {
      log.error('Failed to start Kimi CLI', err);
      if (this.state === STATES.RUNNING) {
        this._scheduleRestart();
      }
    }
  }

  _scheduleRestart() {
    if (this.state !== STATES.RUNNING) return;
    if (this._restarting) return;

    // After 3 failures, attempt recovery instead of retrying blindly
    const MAX_RESTARTS = 3;
    if (this.restartCount >= MAX_RESTARTS) {
      log.warn(`${MAX_RESTARTS} restart attempts failed — attempting recovery...`);
      // Cancel any pending timer and attempt recovery
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this._attemptRecovery().catch(err => log.error('Recovery failed', err));
      return;
    }

    this.restartCount++;
    const delay = Math.min(this.restartBackoff, this.config.daemon.maxRestartBackoff);
    log.warn(`Restarting Kimi CLI in ${delay}ms (attempt ${this.restartCount})...`);

    // Cancel any existing timer before scheduling a new one
    if (this.restartTimer) clearTimeout(this.restartTimer);

    this.restartTimer = setTimeout(async () => {
      await this._restartWire();
    }, delay);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
    this.restartBackoff = Math.min(this.restartBackoff * 2, this.config.daemon.maxRestartBackoff);
  }

  _startHealthCheck() {
    this.healthTimer = setInterval(() => {
      if (this.state !== STATES.RUNNING) return;

      const status = this.getStatus();
      if (!status.wireConnected) {
        log.warn('Health check: Wire client disconnected');
      }

      // Memory check
      const mem = process.memoryUsage();
      if (mem.heapUsed > 512 * 1024 * 1024) {
        log.warn(`Health check: High memory usage (${Math.round(mem.heapUsed / 1024 / 1024)}MB)`);
      }
    }, this.config.daemon.healthCheckInterval);
  }

  _setupSignals() {
    const shutdown = async (signal) => {
      log.info(`Received ${signal}`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGHUP', async () => {
      log.info('Received SIGHUP — reloading all config');
      try {
        const { resetConfig } = await import('../config/index.js');
        resetConfig();
        this.config = await getConfig(this.projectRoot);
        buildSystemPrompt(this.projectRoot);
        generateMcpConfig(this.projectRoot);
        this.cronScheduler?.reload();
        await this._restartWire();
        log.info('Config reload complete');
        this.emit('config-reloaded');
      } catch (err) {
        log.error('Config reload failed', err);
      }
    });

    process.on('uncaughtException', (err) => {
      log.error('Uncaught exception', err);
      // Don't crash — log and continue
    });

    process.on('unhandledRejection', (err) => {
      log.error('Unhandled rejection', err);
    });
  }

  /**
   * Store Kimi CLI version in state table for `spawnbot status` to read.
   */
  _storeKimiVersion() {
    try {
      const version = execSync('kimi --version', { encoding: 'utf8' }).trim();
      const sqlite = getSqlite();
      const now = Date.now();
      sqlite.prepare(
        "INSERT INTO state (key, value, updated_at) VALUES ('kimi_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?"
      ).run(version, now, version, now);
      log.info(`Kimi CLI: ${version}`);
    } catch {}
  }

  /**
   * Track mcp.json mtime so we can detect when tool management tools modify it.
   */
  _trackMcpConfigMtime() {
    try {
      const mcpPath = this.config.paths.mcpConfig;
      this.mcpConfigMtime = existsSync(mcpPath) ? statSync(mcpPath).mtimeMs : 0;
    } catch {
      this.mcpConfigMtime = 0;
    }
  }

  /**
   * After each turn, check if mcp.json was modified (by tool_create, etc.).
   * If so, restart Wire so Kimi CLI picks up the new tools.
   */
  async _checkMcpConfigChanged() {
    try {
      const mcpPath = this.config.paths.mcpConfig;
      if (!existsSync(mcpPath)) return;
      const currentMtime = statSync(mcpPath).mtimeMs;
      if (currentMtime > this.mcpConfigMtime) {
        log.info('MCP config changed — restarting Wire client for new tools');
        this.mcpConfigMtime = currentMtime;
        await this._restartWire();
      }
    } catch (err) {
      log.error('Error checking MCP config', err);
    }
  }

  /**
   * Validate MCP servers in mcp.json before starting Kimi CLI.
   * Checks that command binaries exist and node script files are present.
   * Removes invalid entries and rewrites mcp.json. Returns array of failures.
   */
  _validateMcpServers() {
    const mcpPath = this.config.paths?.mcpConfig;
    if (!mcpPath || !existsSync(mcpPath)) return [];

    let mcpConfig;
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf8'));
    } catch {
      log.warn('Could not parse mcp.json for validation');
      return [];
    }

    const servers = mcpConfig.mcpServers || {};
    const coreServers = ['telegram', 'agent-tools'];
    const failed = [];

    for (const [name, entry] of Object.entries(servers)) {
      if (coreServers.includes(name)) continue; // Skip core servers

      const cmd = entry.command;
      if (!cmd) {
        failed.push({ name, reason: 'no command specified' });
        delete servers[name];
        continue;
      }

      // Check if command binary exists
      try {
        execFileSync('which', [cmd], { encoding: 'utf8', stdio: 'pipe' });
      } catch {
        failed.push({ name, reason: `command not found: ${cmd}` });
        delete servers[name];
        continue;
      }

      // For node commands, check if the script exists and has valid syntax
      if (cmd === 'node') {
        const scriptArg = (entry.args || []).find(a => !a.startsWith('-') && a.includes('/'));
        if (scriptArg && !existsSync(scriptArg)) {
          failed.push({ name, reason: `script not found: ${scriptArg}` });
          delete servers[name];
          continue;
        }
        if (scriptArg) {
          try {
            execFileSync('node', ['--check', scriptArg], {
              encoding: 'utf8',
              stdio: 'pipe',
              env: { ...process.env, ...entry.env },
              timeout: 5000,
            });
          } catch (err) {
            const msg = (err.stderr || err.message || '').split('\n').slice(0, 3).join(' ').trim();
            failed.push({ name, reason: `syntax/import error: ${msg}` });
            delete servers[name];
            continue;
          }
        }
      }
    }

    if (failed.length > 0) {
      log.warn(`Removed ${failed.length} invalid MCP server(s): ${failed.map(f => f.name).join(', ')}`);
      writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    }

    return failed;
  }

  /**
   * Restart Wire client and update router's reference.
   */
  async _restartWire() {
    if (this._restarting) return;
    this._restarting = true;
    try {
      if (this.wire) {
        this.wire.kill();
        this.wire = null;
      }
      this._failedMcpServers = this._validateMcpServers();
      await this._startWire();
      this._trackMcpConfigMtime();
      if (this.router) {
        this.router.wire = this.wire;
      }
    } finally {
      this._restarting = false;
    }
  }

  /**
   * Recovery: diagnose why Kimi CLI keeps crashing, start in safe mode,
   * and prompt the agent to fix the issue.
   */
  async _attemptRecovery() {
    if (this._restarting) return;
    this._restarting = true;

    try {
      // 1. Diagnose — check what's in mcp.json vs what generateMcpConfig would produce
      const mcpPath = this.config.paths.mcpConfig;
      let removedServers = [];
      let diagnosis = '';

      if (existsSync(mcpPath)) {
        try {
          const currentConfig = JSON.parse(readFileSync(mcpPath, 'utf8'));
          const currentServers = Object.keys(currentConfig.mcpServers || {});
          const coreServers = ['telegram', 'agent-tools'];
          removedServers = currentServers.filter(s => !coreServers.includes(s));

          if (removedServers.length > 0) {
            diagnosis = `Kimi CLI crashed 3 times. The likely cause is a bad MCP server configuration. ` +
              `Non-core servers found in mcp.json: ${removedServers.join(', ')}. ` +
              `I regenerated mcp.json with only core servers so you can start. ` +
              `Investigate the removed servers and re-add them if they work.`;
          } else {
            diagnosis = `Kimi CLI crashed 3 times. All MCP servers are core (telegram, agent-tools), ` +
              `so the issue may be with Kimi CLI itself, the LLM provider, or the system prompt. ` +
              `Check config/agent/agent.yaml, data/rendered-system.md, and try "kimi --wire" manually.`;
          }
        } catch (err) {
          diagnosis = `Kimi CLI crashed 3 times. Could not parse mcp.json: ${err.message}. ` +
            `I regenerated it from scratch. Check data/mcp.json for issues.`;
        }
      } else {
        diagnosis = `Kimi CLI crashed 3 times. No mcp.json found — regenerating from integrations.yaml.`;
      }

      log.info(`Recovery diagnosis: ${diagnosis}`);

      // 2. Regenerate clean mcp.json from integrations.yaml (core servers only + valid integrations)
      generateMcpConfig(this.projectRoot);
      log.info('Regenerated clean mcp.json');

      // 3. Try starting in safe mode
      if (this.wire) {
        this.wire.kill();
        this.wire = null;
      }

      this.wire = new WireClient(this.config);
      this.wire.on('disconnected', (code) => {
        log.error(`Kimi CLI exited with code ${code}`);
        if (this.state === STATES.RUNNING) {
          this._scheduleRestart();
        }
      });
      this.wire.on('error', (err) => {
        log.error('Wire error', err);
      });

      await this.wire.spawn();
      await this.wire.initialize();
      this.restartBackoff = 1000;
      this.restartCount = 0;
      log.info('Recovery: Kimi CLI started in safe mode');

      this._trackMcpConfigMtime();
      if (this.router) {
        this.router.wire = this.wire;
      }

      // 4. Prompt the agent with the diagnosis
      try {
        await this.wire.prompt(
          `[SYSTEM from daemon]: RECOVERY MODE — ${diagnosis}\n\n` +
          `You are running with a regenerated MCP config. Some tools may be missing. ` +
          `Read data/mcp.json to see what's currently available, investigate the issue, and fix it. ` +
          `After fixing, the daemon will detect the mcp.json change and reload automatically.`
        );
        log.info('Recovery: agent prompted with diagnosis');
      } catch (err) {
        log.warn(`Recovery: failed to prompt agent: ${err.message}`);
      }

    } catch (err) {
      // Safe mode also failed — notify via Telegram and give up
      log.error('Recovery failed — could not start Kimi CLI even in safe mode', err);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (token && chatId) {
        sendMessage(token, chatId,
          `Kimi CLI crashed 3 times and recovery failed. Could not start even with core-only MCP config. ` +
          `Error: ${err.message}. Run "spawnbot doctor" to diagnose, then "spawnbot restart".`
        ).catch(() => {});
      }
    } finally {
      this._restarting = false;
    }
  }

  /**
   * Watch config/ directory for changes and auto-reload.
   */
  _watchConfigFiles() {
    const configDir = resolve(this.projectRoot, 'config');
    if (!existsSync(configDir)) return;

    const debounceTimers = new Map();

    this.configWatcher = watch(configDir, { recursive: true }, (eventType, filename) => {
      if (!filename || this.state !== STATES.RUNNING) return;

      // Debounce — editors fire multiple events per save
      if (debounceTimers.has(filename)) clearTimeout(debounceTimers.get(filename));
      debounceTimers.set(filename, setTimeout(() => {
        debounceTimers.delete(filename);
        this._handleConfigChange(filename);
      }, 1000));
    });

    this.registerSubsystem({
      name: 'config-watcher',
      stop: () => {
        this.configWatcher?.close();
        this.configWatcher = null;
      },
    });

    log.info('Watching config/ for changes');
  }

  /**
   * Handle a config file change — route to the appropriate reload action.
   */
  async _handleConfigChange(filename) {
    // Normalize path separators
    const base = filename.replace(/\\/g, '/');
    log.info(`Config changed: ${base}`);

    try {
      if (base === 'SOUL.yaml' || base.endsWith('system.md')) {
        log.info('Regenerating system prompt and restarting Wire...');
        buildSystemPrompt(this.projectRoot);
        await this._restartWire();

      } else if (base === 'CRONS.yaml') {
        log.info('Reloading cron schedules...');
        this.cronScheduler.reload();

      } else if (base === 'integrations.yaml') {
        log.info('Regenerating MCP config and restarting Wire...');
        generateMcpConfig(this.projectRoot);
        await this._restartWire();

      } else if (base === 'PLAYBOOK.yaml' || base === 'GOALS.yaml') {
        log.info(`${base} updated (agent reads on demand, no reload needed)`);
      }
    } catch (err) {
      log.error(`Failed to reload after ${base} change: ${err.message}`);
    }
  }
}
