#!/usr/bin/env node

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const DEFAULT_AGENT_DIR = resolve(homedir(), '.spawnbot', 'agent');

// Resolve agent directory: use CWD if it looks like an agent dir, else default
function resolveAgentDir() {
  const cwd = process.cwd();
  const hasConfig = existsSync(resolve(cwd, 'config'));
  const hasEnv = existsSync(resolve(cwd, '.env'));
  if (hasConfig || hasEnv) return cwd;
  return DEFAULT_AGENT_DIR;
}

const PROJECT_ROOT = resolveAgentDir();

const [,, command, ...args] = process.argv;

// ── Foreground slash commands ────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const slashCommands = {
  help: {
    desc: 'Show available commands',
    run() {
      console.log('');
      console.log(chalk.bold('  Commands'));
      console.log(chalk.dim('  ─────────────────────────────'));
      for (const [name, cmd] of Object.entries(slashCommands)) {
        console.log(`  ${chalk.cyan('/' + name.padEnd(16))} ${chalk.dim(cmd.desc)}`);
      }
      console.log('');
      console.log(chalk.dim('  Anything else is sent to the agent as a message.'));
      console.log('');
    },
  },
  status: {
    desc: 'Daemon state, uptime, queue',
    run(daemon) {
      const s = daemon.getStatus();
      console.log('');
      console.log(`  ${chalk.dim('State:')}    ${s.state === 'running' ? chalk.green(s.state) : chalk.yellow(s.state)}`);
      console.log(`  ${chalk.dim('Uptime:')}   ${formatUptime(s.uptime)}`);
      console.log(`  ${chalk.dim('Wire:')}     ${s.wireConnected ? chalk.green('connected') : chalk.yellow('disconnected')}`);
      console.log(`  ${chalk.dim('Queue:')}    ${s.queue?.depth ?? 0} items`);
      console.log(`  ${chalk.dim('Restarts:')} ${s.restartCount}`);
      if (s.http?.publicUrl) {
        console.log(`  ${chalk.dim('URL:')}      ${s.http.publicUrl}`);
      }
      console.log('');
    },
  },
  queue: {
    desc: 'Show queue depth and state',
    run(daemon) {
      const stats = daemon.queue?.stats() || { depth: 0, byPriority: {} };
      const routerState = daemon.router?.getState() || {};
      console.log('');
      console.log(`  ${chalk.dim('Depth:')}       ${stats.depth}`);
      console.log(`  ${chalk.dim('Turn:')}        ${routerState.turnInProgress ? chalk.cyan('active') : 'idle'}`);
      if (routerState.currentSource) {
        console.log(`  ${chalk.dim('Source:')}      ${routerState.currentSource}`);
      }
      if (stats.depth > 0) {
        const parts = Object.entries(stats.byPriority).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`);
        console.log(`  ${chalk.dim('Priority:')}   ${parts.join(', ')}`);
      }
      console.log('');
    },
  },
  logs: {
    desc: 'Show last 20 log lines',
    run(daemon) {
      const logPath = resolve(daemon.config.paths.logs, 'spawnbot.log');
      if (!existsSync(logPath)) {
        console.log(chalk.yellow('  No log file found'));
        return;
      }
      const lines = readFileSync(logPath, 'utf-8').split('\n');
      const tail = lines.slice(-21, -1); // last 20 non-empty
      console.log('');
      for (const line of tail) {
        console.log(chalk.dim(`  ${line}`));
      }
      console.log('');
    },
  },
  clear: {
    desc: 'Clear terminal',
    run() {
      process.stdout.write('\x1Bc');
    },
  },
  'config': {
    desc: 'Reload config (hot-reload)',
    async run(daemon) {
      const { resetConfig, getConfig } = await import('../lib/config/index.js');
      resetConfig();
      daemon.config = await getConfig(daemon.projectRoot);
      daemon.emit('config-reloaded');
      console.log(chalk.green('  ✓ Config reloaded'));
    },
  },
  stop: {
    desc: 'Stop the daemon and exit',
    async run(daemon) {
      console.log(chalk.dim('  Shutting down...'));
      await daemon.stop();
      process.exit(0);
    },
  },
  quit: {
    desc: 'Same as /stop',
    async run(daemon) {
      await slashCommands.stop.run(daemon);
    },
  },
};

async function handleSlashCommand(input, daemon) {
  const cmdName = input.slice(1).split(/\s+/)[0].toLowerCase();
  const handler = slashCommands[cmdName];
  if (!handler) {
    console.log(chalk.yellow(`  Unknown command: /${cmdName}`) + chalk.dim('  — type /help for commands'));
    return;
  }
  await handler.run(daemon);
}

const commands = {
  async start() {
    // Check for stale process from a previous run
    const { readPidFile, isProcessRunning, removePidFile } = await import('../lib/daemon/pid.js');
    const existingPid = readPidFile(PROJECT_ROOT);
    if (existingPid) {
      if (isProcessRunning(existingPid)) {
        console.log(`Agent is already running (PID: ${existingPid}). Use "spawnbot restart" to restart.`);
        process.exit(1);
      }
      // Stale PID — clean up
      removePidFile(PROJECT_ROOT);
    }

    const foreground = args.includes('--foreground') || args.includes('-f');
    if (foreground) {
      const { Daemon } = await import('../lib/daemon/index.js');
      const { attachDisplay, printTurnHeader, printTurnFooter } = await import('../lib/wire/display.js');
      const daemon = new Daemon({ projectRoot: PROJECT_ROOT });
      await daemon.start();

      // Attach live wire display — streams thinking, tool calls, content in real time
      let detachDisplay = daemon.wire ? attachDisplay(daemon.wire) : () => {};

      // Re-attach display when wire restarts (MCP config change, crash recovery)
      daemon.on('wire_ready', (wire) => {
        detachDisplay();
        detachDisplay = attachDisplay(wire);
      });

      // Show turn boundaries for ALL turns (telegram, cron, cli, autonomy)
      daemon.router.on('turn_start', (item) => {
        printTurnHeader(item.source, item.senderName);
      });
      daemon.router.on('turn_end', ({ durationMs }) => {
        printTurnFooter(durationMs);
      });

      // Interactive CLI chat — read stdin, handle slash commands, enqueue prompts
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      console.log(chalk.dim('  Type /help for commands\n'));

      rl.on('line', async (line) => {
        const text = line.trim();
        if (!text) return;

        if (text.startsWith('/')) {
          await handleSlashCommand(text, daemon);
          return;
        }

        daemon.queue.enqueue({
          source: 'cli',
          senderId: 'operator',
          senderName: 'Operator',
          content: text,
          priority: 'high',
          metadata: { via: 'foreground-cli' },
        });
      });
    } else {
      const { fork } = await import('child_process');
      const child = fork(fileURLToPath(import.meta.url), ['start', '--foreground'], {
        detached: true,
        stdio: 'ignore',
        cwd: PROJECT_ROOT,
      });
      child.unref();
      console.log(`Agent daemon started (PID: ${child.pid})`);
      process.exit(0);
    }
  },

  async stop() {
    const { readPidFile, sendSignal, isProcessRunning, removePidFile } = await import('../lib/daemon/pid.js');
    const pid = readPidFile(PROJECT_ROOT);
    if (!pid) {
      console.log('Agent is not running (no PID file)');
      process.exit(1);
    }
    if (!isProcessRunning(pid)) {
      console.log(`Agent process ${pid} not found (stale PID file) — cleaning up`);
      removePidFile(PROJECT_ROOT);
      process.exit(0);
    }
    sendSignal(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to agent (PID: ${pid})`);

    // Wait for process to exit (up to 10s)
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && isProcessRunning(pid)) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (isProcessRunning(pid)) {
      console.log(`Process ${pid} did not exit — sending SIGKILL`);
      sendSignal(pid, 'SIGKILL');
      await new Promise(r => setTimeout(r, 500));
    }
    removePidFile(PROJECT_ROOT);
    console.log('Agent stopped');
  },

  async restart() {
    const { readPidFile, sendSignal, isProcessRunning, removePidFile } = await import('../lib/daemon/pid.js');
    const pid = readPidFile(PROJECT_ROOT);
    if (pid && isProcessRunning(pid)) {
      sendSignal(pid, 'SIGTERM');
      console.log(`Stopping agent (PID: ${pid})...`);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && isProcessRunning(pid)) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (isProcessRunning(pid)) {
        console.log('Force killing...');
        sendSignal(pid, 'SIGKILL');
        await new Promise(r => setTimeout(r, 500));
      }
      removePidFile(PROJECT_ROOT);
    } else if (pid) {
      removePidFile(PROJECT_ROOT);
    }
    // Start fresh
    await commands.start();
  },

  async status() {
    const { readPidFile, isProcessRunning } = await import('../lib/daemon/pid.js');
    const pid = readPidFile(PROJECT_ROOT);
    if (!pid) {
      console.log('Agent is not running');
      process.exit(1);
    }
    if (!isProcessRunning(pid)) {
      console.log(`Agent is not running (stale PID file for ${pid})`);
      process.exit(1);
    }

    console.log(`Agent is running (PID: ${pid})`);

    // Try to read rich status from SQLite
    try {
      const { initDatabase, getSqlite, closeDatabase } = await import('../lib/db/index.js');
      initDatabase(resolve(PROJECT_ROOT, 'data', 'agent.sqlite'));
      const sqlite = getSqlite();

      // Uptime from state
      const uptimeRow = sqlite.prepare("SELECT value FROM state WHERE key = 'daemon_started_at'").get();
      if (uptimeRow) {
        const startedAt = JSON.parse(uptimeRow.value);
        const uptimeMin = Math.round((Date.now() - startedAt) / 60000);
        console.log(`  Uptime: ${uptimeMin} minutes`);
      }

      // Active tasks
      const activeTasks = sqlite.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'active'").get();
      const overdueTasks = sqlite.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'active' AND deadline_at < ?").get(Date.now());
      console.log(`  Tasks: ${activeTasks.c} active, ${overdueTasks.c} overdue`);

      // Memory count
      const mem = sqlite.prepare('SELECT COUNT(*) as c FROM memories').get();
      console.log(`  Memories: ${mem.c}`);

      // Public URL
      const urlRow = sqlite.prepare("SELECT value FROM state WHERE key = 'public_url'").get();
      if (urlRow) {
        console.log(`  Public URL: ${urlRow.value}`);
      }

      // Kimi CLI version
      const versionRow = sqlite.prepare("SELECT value FROM state WHERE key = 'kimi_version'").get();
      if (versionRow) {
        console.log(`  Kimi CLI: ${versionRow.value}`);
      }

      // Recent events
      const recent = sqlite.prepare('SELECT type, summary FROM events ORDER BY created_at DESC LIMIT 3').all();
      if (recent.length > 0) {
        console.log('  Recent events:');
        for (const e of recent) {
          console.log(`    [${e.type}] ${e.summary || '(no summary)'}`);
        }
      }

      closeDatabase();
    } catch {
      // DB may not exist yet, that's fine
    }
  },

  async prompt() {
    // Parse flags from args
    const textParts = [];
    let model = null;
    let thinking = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--model' && args[i + 1]) {
        model = args[++i];
      } else if (args[i] === '--thinking') {
        thinking = 'true';
      } else if (args[i] === '--no-thinking') {
        thinking = 'false';
      } else {
        textParts.push(args[i]);
      }
    }

    const input = textParts.join(' ');
    if (!input) {
      console.error('Usage: spawnbot prompt "your message" [--model <name>] [--thinking|--no-thinking]');
      process.exit(1);
    }
    const { WireClient } = await import('../lib/wire/client.js');
    const { getConfig } = await import('../lib/config/index.js');
    const { buildSystemPrompt } = await import('../lib/persona/prompt-builder.js');
    const { generateMcpConfig } = await import('../lib/persona/mcp-config.js');
    const { initDatabase } = await import('../lib/db/index.js');
    const { resolve } = await import('path');

    const config = await getConfig(PROJECT_ROOT);

    // Apply CLI flag overrides for this prompt only
    if (model) config.kimi.model = model;
    if (thinking) config.kimi.thinking = thinking;

    buildSystemPrompt(PROJECT_ROOT);
    generateMcpConfig(PROJECT_ROOT);
    initDatabase(resolve(PROJECT_ROOT, 'data', 'agent.sqlite'));

    const { attachDisplay } = await import('../lib/wire/display.js');

    const wire = new WireClient(config);
    let responseText = '';

    // Attach interactive display — streams content + shows thinking/tools
    const detach = attachDisplay(wire, {
      showContent: true,
      onContent: ({ text }) => { responseText += text; },
    });

    try {
      await wire.spawn();
      await wire.initialize();
      await wire.prompt(input);
      console.log(); // newline after streamed content
      if (!responseText) console.log('(no response)');
    } finally {
      detach();
      wire.kill();
    }
  },

  async setup() {
    const { existsSync, mkdirSync } = await import('fs');

    // Ensure directories exist in the project root (CWD)
    for (const dir of ['config', 'config/agent', 'data', 'data/logs', 'skills', 'integrations']) {
      const p = resolve(PROJECT_ROOT, dir);
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }

    const { runSetupWizard } = await import('../lib/setup/index.js');
    await runSetupWizard({ projectRoot: PROJECT_ROOT });
  },

  async init() {
    const { mkdirSync, existsSync, writeFileSync, readFileSync } = await import('fs');
    const hasSoul = existsSync(resolve(PROJECT_ROOT, 'config', 'SOUL.yaml'));

    if (hasSoul) {
      // Clone scenario — config exists, need runtime + credentials
      const { parse: yamlParse } = await import('yaml');
      const soul = yamlParse(readFileSync(resolve(PROJECT_ROOT, 'config', 'SOUL.yaml'), 'utf8'));
      const agentName = soul?.identity?.name || 'Agent';
      console.log(chalk.cyan(`Agent: ${agentName}`));
      console.log('Setting up runtime environment...\n');

      // Create data directories
      for (const dir of ['data', 'data/logs']) {
        const p = resolve(PROJECT_ROOT, dir);
        if (!existsSync(p)) {
          mkdirSync(p, { recursive: true });
          console.log(`  Created ${dir}/`);
        }
      }

      // Collect credentials
      const { collectCredentials } = await import('../lib/setup/steps/credentials.js');
      const credentials = await collectCredentials();

      // Write .env
      const { writeEnvFile } = await import('../lib/setup/util.js');
      const envVars = {};
      if (credentials.telegram?.enabled) {
        envVars.TELEGRAM_BOT_TOKEN = credentials.telegram.botToken;
        envVars.TELEGRAM_CHAT_ID = credentials.telegram.chatId;
      }
      if (credentials.ngrok?.authtoken) {
        envVars.NGROK_AUTHTOKEN = credentials.ngrok.authtoken;
        if (credentials.ngrok.domain) envVars.NGROK_DOMAIN = credentials.ngrok.domain;
      }
      if (credentials.openai?.apiKey) {
        envVars.OPENAI_API_KEY = credentials.openai.apiKey;
      }
      // Add integration env vars
      if (credentials.integrations) {
        for (const [, config] of Object.entries(credentials.integrations)) {
          if (config.env) {
            for (const [k, v] of Object.entries(config.env)) {
              if (v) envVars[k] = v;
            }
          }
        }
      }
      writeEnvFile(resolve(PROJECT_ROOT, '.env'), envVars);
      console.log('  Written .env');

      // Load .env into process.env so prompt builder + MCP config can use it
      const { config: loadDotenv } = await import('dotenv');
      loadDotenv({ path: resolve(PROJECT_ROOT, '.env') });

      // Generate rendered-system.md + mcp.json
      const { buildSystemPrompt } = await import('../lib/persona/prompt-builder.js');
      const { generateMcpConfig } = await import('../lib/persona/mcp-config.js');
      buildSystemPrompt(PROJECT_ROOT);
      console.log('  Generated rendered-system.md');
      generateMcpConfig(PROJECT_ROOT);
      console.log('  Generated mcp.json');

      console.log(chalk.green('\nReady! Run "spawnbot start" to launch.'));
    } else {
      // Fresh scaffold — create empty directory structure
      const dirs = ['config', 'config/agent', 'data', 'data/logs', 'skills', 'integrations'];
      for (const dir of dirs) {
        const p = resolve(PROJECT_ROOT, dir);
        if (!existsSync(p)) {
          mkdirSync(p, { recursive: true });
          console.log(`Created ${dir}/`);
        }
      }
      const envPath = resolve(PROJECT_ROOT, '.env');
      if (!existsSync(envPath)) {
        writeFileSync(envPath, [
          '# SpawnBot Configuration',
          '# TELEGRAM_BOT_TOKEN=',
          '# TELEGRAM_CHAT_ID=',
          '',
        ].join('\n'));
        console.log('Created .env (edit with your credentials)');
      }
      console.log('Initialized. Run "spawnbot setup" for full configuration.');
    }
  },

  async logs() {
    const { existsSync } = await import('fs');
    const { spawn } = await import('child_process');

    const filter = args[0]; // --wire, --events, or none
    const follow = args.includes('--follow') || args.includes('-f');

    let logFile;
    if (filter === '--wire') {
      logFile = resolve(PROJECT_ROOT, 'data', 'logs', 'wire.jsonl');
    } else {
      logFile = resolve(PROJECT_ROOT, 'data', 'logs', 'spawnbot.log');
    }

    if (!existsSync(logFile)) {
      console.log(`No log file found at ${logFile}`);
      process.exit(1);
    }

    // Use tail to show logs
    const tailArgs = follow ? ['-f', '-n', '50', logFile] : ['-n', '100', logFile];
    const tail = spawn('tail', tailArgs, { stdio: 'inherit' });
    tail.on('exit', (code) => process.exit(code || 0));
  },

  async service() {
    const sub = args[0];
    const {
      isSystemdAvailable,
      isServiceInstalled,
      installService,
      uninstallService,
      getServiceStatus,
      hasPasswordlessSudo,
      setupPasswordlessSudo,
    } = await import('../lib/service/index.js');

    if (!isSystemdAvailable()) {
      console.error('systemd is not available on this machine');
      process.exit(1);
    }

    if (sub === 'install') {
      if (isServiceInstalled()) {
        console.log('Service is already installed');
        console.log(getServiceStatus());
        // Still check passwordless sudo
        if (!hasPasswordlessSudo()) {
          console.log('Setting up passwordless sudo...');
          try { setupPasswordlessSudo(); console.log('Passwordless sudo configured'); } catch (err) { console.error('Passwordless sudo setup failed:', err.message); }
        }
        process.exit(0);
      }
      console.log('Installing systemd service...');
      installService(PROJECT_ROOT);
      console.log('Service installed and started');
      // Set up passwordless sudo — agent needs it for autonomous operation
      if (!hasPasswordlessSudo()) {
        try { setupPasswordlessSudo(); console.log('Passwordless sudo configured'); } catch (err) { console.error('Passwordless sudo setup failed:', err.message); }
      }
    } else if (sub === 'uninstall') {
      if (!isServiceInstalled()) {
        console.log('Service is not installed');
        process.exit(0);
      }
      console.log('Removing systemd service...');
      uninstallService();
      console.log('Service removed');
    } else if (sub === 'status') {
      console.log(getServiceStatus());
    } else {
      console.log(`Usage:
  spawnbot service install     Install systemd service (auto-start on boot)
  spawnbot service uninstall   Remove systemd service
  spawnbot service status      Show service status`);
    }
  },

  async upgrade() {
    const { execSync } = await import('child_process');
    const { readPidFile, isProcessRunning } = await import('../lib/daemon/pid.js');

    // Current version
    let current;
    try {
      current = execSync('kimi --version', { encoding: 'utf8' }).trim();
      console.log(`Current: ${current}`);
    } catch {
      console.error('Kimi CLI not found. Install: uv tool install kimi-cli');
      process.exit(1);
    }

    // Upgrade via uv
    console.log('Checking for updates...');
    try {
      const result = execSync('uv tool upgrade kimi-cli 2>&1', { encoding: 'utf8' });
      console.log(result.trim());
    } catch (err) {
      const stderr = err.stderr?.toString() || err.message;
      if (stderr.includes('Nothing to upgrade')) {
        console.log('Already up to date.');
      } else {
        console.error(`Upgrade failed: ${stderr}`);
        console.error('Try manually: uv tool upgrade kimi-cli');
        process.exit(1);
      }
    }

    // Verify new version
    try {
      const updated = execSync('kimi --version', { encoding: 'utf8' }).trim();
      if (updated !== current) {
        console.log(`Updated: ${updated}`);

        // If daemon is running, suggest restart
        const pid = readPidFile(PROJECT_ROOT);
        if (pid && isProcessRunning(pid)) {
          console.log('Daemon is running — restart to use new version:');
          console.log('  spawnbot stop && spawnbot start');
        }
      }
    } catch {}
  },

  async update() {
    const { execSync } = await import('child_process');
    const { readPidFile, isProcessRunning } = await import('../lib/daemon/pid.js');
    const { readFileSync, existsSync } = await import('fs');
    const { parse: yamlParse } = await import('yaml');

    const wasDaemonRunning = (() => {
      const pid = readPidFile(PROJECT_ROOT);
      return pid && isProcessRunning(pid);
    })();

    // 1. Pull latest framework code
    console.log('Pulling latest spawnbot...');
    try {
      const result = execSync('git pull', { cwd: PACKAGE_ROOT, encoding: 'utf8' });
      console.log(result.trim());
    } catch (err) {
      console.error(`git pull failed: ${err.message}`);
      process.exit(1);
    }

    // 2. Install dependencies if needed
    try {
      execSync('npm install --omit=dev', { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: 'pipe' });
    } catch {
      // Non-critical — deps may already be current
    }

    // 3. Regenerate framework files (agent.yaml, sub.yaml, system.md)
    console.log('Regenerating framework configs...');

    // Read agent name from SOUL.yaml
    const soulPath = resolve(PROJECT_ROOT, 'config', 'SOUL.yaml');
    let agentName = 'Agent';
    if (existsSync(soulPath)) {
      try {
        const soul = yamlParse(readFileSync(soulPath, 'utf8'));
        agentName = soul?.identity?.name || 'Agent';
      } catch {}
    }

    const { writeYamlFile, writeTextFile } = await import('../lib/setup/util.js');
    const { buildGenericSystemPrompt } = await import('../lib/setup/steps/generate.js');

    // agent.yaml
    const agentYaml = {
      version: 1,
      agent: {
        extend: 'default',
        name: agentName,
        system_prompt_path: '../../data/rendered-system.md',
        system_prompt_args: {
          ROLE_ADDITIONAL: 'You are the primary agent. You receive and respond to inputs from all sources — Telegram users, scheduled cron jobs, integration pollers, and autonomy check-ins. You manage the full conversation lifecycle and can delegate work to subagents.',
        },
        subagents: {
          worker: {
            path: './sub.yaml',
            description: `A ${agentName} subagent for isolated tasks — research, file operations, focused work.`,
          },
        },
      },
    };
    writeYamlFile(
      resolve(PROJECT_ROOT, 'config', 'agent', 'agent.yaml'),
      agentYaml,
      { header: `# ${agentName} — Kimi CLI Agent Definition\n# Generated by spawnbot update` }
    );
    console.log('  ✓ agent.yaml');

    // sub.yaml
    const subYaml = {
      version: 1,
      agent: {
        extend: './agent.yaml',
        system_prompt_args: {
          ROLE_ADDITIONAL: [
            'You are running as a subagent. Messages come from the main agent, not the user.',
            'The main agent cannot see your context — only your final message.',
            'Provide a comprehensive summary of what you did and learned.',
            'If you modified files, list them in your summary.',
          ].join('\n'),
        },
        exclude_tools: [
          'kimi_cli.tools.multiagent:Task',
          'kimi_cli.tools.multiagent:CreateSubagent',
          'kimi_cli.tools.todo:SetTodoList',
        ],
        subagents: null,
      },
    };
    writeYamlFile(
      resolve(PROJECT_ROOT, 'config', 'agent', 'sub.yaml'),
      subYaml,
      { header: `# ${agentName} — Subagent Definition\n# Extends agent.yaml with isolated context` }
    );
    console.log('  ✓ sub.yaml');

    // system.md template
    const systemPrompt = buildGenericSystemPrompt();
    writeTextFile(resolve(PROJECT_ROOT, 'config', 'agent', 'system.md'), systemPrompt);
    console.log('  ✓ system.md');

    // 4. Regenerate rendered-system.md + mcp.json
    const { generateMcpConfig } = await import('../lib/persona/mcp-config.js');
    const { buildSystemPrompt } = await import('../lib/persona/prompt-builder.js');
    buildSystemPrompt(PROJECT_ROOT);
    console.log('  ✓ rendered-system.md');
    generateMcpConfig(PROJECT_ROOT);
    console.log('  ✓ mcp.json');

    // 5. Restart daemon if it was running
    if (wasDaemonRunning) {
      console.log('Restarting daemon...');
      await commands.restart();
    } else {
      console.log('Done. Run "spawnbot start" to launch.');
    }
  },

  async doctor() {
    const { runDoctor } = await import('../lib/doctor.js');
    const { failed } = await runDoctor(PROJECT_ROOT);
    if (failed > 0) process.exit(1);
  },

  async config() {
    const sub = args[0];
    const { getConfig } = await import('../lib/config/index.js');

    if (sub === 'validate') {
      const { validateConfig } = await import('../lib/config/validate.js');
      const config = await getConfig(PROJECT_ROOT);
      const result = validateConfig(config);
      if (result.errors.length) {
        console.log('Errors:');
        result.errors.forEach(e => console.log(`  x ${e}`));
      }
      if (result.warnings.length) {
        console.log('Warnings:');
        result.warnings.forEach(w => console.log(`  ! ${w}`));
      }
      if (result.valid) {
        console.log('Configuration is valid');
      } else {
        process.exit(1);
      }
    } else if (sub === 'reload') {
      const { readPidFile, sendSignal } = await import('../lib/daemon/pid.js');
      const pid = readPidFile(PROJECT_ROOT);
      if (pid && sendSignal(pid, 'SIGHUP')) {
        console.log(`Sent SIGHUP to agent (PID: ${pid}) — config reloading`);
      } else {
        console.log('Agent is not running');
        process.exit(1);
      }
    } else if (sub === 'generate') {
      const { generateMcpConfig } = await import('../lib/persona/mcp-config.js');
      const { buildSystemPrompt } = await import('../lib/persona/prompt-builder.js');
      const mcpPath = generateMcpConfig(PROJECT_ROOT);
      const promptPath = buildSystemPrompt(PROJECT_ROOT);
      console.log(`MCP config: ${mcpPath}`);
      console.log(`System prompt: ${promptPath}`);
    } else {
      const config = await getConfig(PROJECT_ROOT);
      console.log(JSON.stringify(config, null, 2));
    }
  },
};

if (!command || command === '--help' || command === '-h') {
  console.log(`
spawnbot — Autonomous AI Agent Framework

Agent directory: ${PROJECT_ROOT}

Usage:
  spawnbot setup                       Interactive setup wizard (start here)
  spawnbot start [-f|--foreground]     Start the daemon (-f for interactive CLI)
  spawnbot stop                        Stop the daemon (waits for clean exit)
  spawnbot restart                     Stop + start the daemon
  spawnbot status                      Daemon status + metrics
  spawnbot prompt "message" [flags]    Send a one-shot prompt (testing)
    --model <name>                       Override LLM model for this prompt
    --thinking / --no-thinking           Override thinking mode
  spawnbot doctor                      Run diagnostic checks
  spawnbot update                      Pull latest code + regenerate configs
  spawnbot upgrade                     Check for and install Kimi CLI updates
  spawnbot logs [--wire] [-f|--follow] Tail log files
  spawnbot service install|uninstall|status  Manage systemd service
  spawnbot config                      Show full config
  spawnbot config validate             Validate configuration
  spawnbot config reload               Send SIGHUP to reload config
  spawnbot config generate             Regenerate MCP config + system prompt
  spawnbot init                        Initialize: scaffold new project or set up a cloned repo
`);
  process.exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.error('Run "spawnbot --help" for usage');
  process.exit(1);
}

commands[command]().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
