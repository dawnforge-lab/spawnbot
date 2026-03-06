import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';
import { createLogger } from '../logger.js';

const log = createLogger('CONFIG');

let _config = null;

export async function getConfig(projectRoot) {
  if (_config) return _config;

  // Load .env
  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }

  // Load YAML configs
  const soul = loadYaml(resolve(projectRoot, 'config/SOUL.yaml'));
  const crons = loadYaml(resolve(projectRoot, 'config/CRONS.yaml'));
  const integrations = loadYaml(resolve(projectRoot, 'config/integrations.yaml'));

  _config = {
    projectRoot,

    // Paths
    paths: {
      data: resolve(projectRoot, 'data'),
      database: resolve(projectRoot, process.env.DATABASE_PATH || 'data/agent.sqlite'),
      logs: resolve(projectRoot, 'data/logs'),
      pid: resolve(projectRoot, 'data/agent.pid'),
      mcpConfig: resolve(projectRoot, 'data/mcp.json'),
      renderedPrompt: resolve(projectRoot, 'data/rendered-system.md'),
      agentConfig: resolve(projectRoot, 'config/agent/agent.yaml'),
      systemPrompt: resolve(projectRoot, 'config/agent/system.md'),
      soulYaml: resolve(projectRoot, 'config/SOUL.yaml'),
      playbook: resolve(projectRoot, 'config/PLAYBOOK.yaml'),
      integrations: resolve(projectRoot, 'integrations'),
      skills: resolve(projectRoot, 'skills'),
    },

    // Kimi CLI
    kimi: {
      command: process.env.KIMI_CLI_PATH || 'kimi',
      agentFile: resolve(projectRoot, 'config/agent/agent.yaml'),
      model: process.env.KIMI_MODEL || '',
      thinking: process.env.KIMI_THINKING || '',        // 'true', 'false', or '' (use Kimi default)
      maxStepsPerTurn: parseInt(process.env.KIMI_MAX_STEPS || '0', 10) || 0,
      verbose: process.env.KIMI_VERBOSE === 'true',
    },

    // Telegram (core)
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
    },

    // HTTP server
    http: {
      port: parseInt(process.env.HTTP_PORT || '31415', 10),
      apiKey: process.env.API_KEY || '',
    },

    // ngrok tunnel (optional)
    ngrok: {
      authtoken: process.env.NGROK_AUTHTOKEN || '',
      domain: process.env.NGROK_DOMAIN || '',
    },

    // Public URL (for VPS deployments without ngrok)
    publicUrl: process.env.PUBLIC_URL || '',

    // Daemon
    daemon: {
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10),
      maxRestartBackoff: parseInt(process.env.MAX_RESTART_BACKOFF || '30000', 10),
    },

    // Autonomy
    autonomy: {
      checkInInterval: parseInt(process.env.AUTONOMY_CHECKIN_INTERVAL || '1800000', 10), // 30min
      idleEscalateAfter: parseInt(process.env.AUTONOMY_IDLE_ESCALATE || '7200000', 10), // 2h
    },

    // Identity
    soul,

    // Scheduling
    crons: crons?.jobs || [],

    // Integrations
    integrations: integrations?.integrations || {},

    // Safety
    safeword: soul?.safety?.stop_phrase || 'emergency-stop',
  };

  return _config;
}

export function resetConfig() {
  _config = null;
}

function loadYaml(path) {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf-8');
    return parseYaml(content);
  } catch (err) {
    log.warn(`Failed to parse ${path}: ${err.message}`);
    return null;
  }
}
