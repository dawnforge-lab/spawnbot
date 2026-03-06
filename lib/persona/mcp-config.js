/**
 * MCP Config Generator — creates data/mcp.json for Kimi CLI.
 *
 * Includes core MCP servers (Telegram, agent-tools) and any enabled
 * integrations from config/integrations.yaml.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { createLogger } from '../logger.js';

const log = createLogger('MCP-CONFIG');

// Framework root — where bin/, lib/, integrations/ live (e.g. ~/.spawnbot)
const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = resolve(__dirname, '..', '..');

/**
 * Resolve ${ENV_VAR} references in an env map.
 */
function resolveEnv(envMap) {
  if (!envMap) return {};
  const resolved = {};
  for (const [key, value] of Object.entries(envMap)) {
    resolved[key] = String(value).replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] || '');
  }
  return resolved;
}

/**
 * Generate data/mcp.json from core servers + integrations.yaml.
 * @param {string} projectRoot
 * @returns {string} Path to generated mcp.json
 */
export function generateMcpConfig(projectRoot) {
  const root = projectRoot || process.cwd();

  const mcpServers = {};

  // --- Core servers ---

  // Telegram MCP — only if bot token is configured
  if (process.env.TELEGRAM_BOT_TOKEN) {
    mcpServers['telegram'] = {
      command: 'node',
      args: [resolve(FRAMEWORK_ROOT, 'bin', 'mcp-telegram.js')],
      env: {
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
      },
    };
  }

  // Core MCP — always enabled (memory, state, events, tasks, playbook)
  const playbookPath = resolve(root, 'config', 'PLAYBOOK.yaml');
  mcpServers['agent-tools'] = {
    command: 'node',
    args: [resolve(FRAMEWORK_ROOT, 'bin', 'mcp-core.js')],
    env: {
      DATABASE_PATH: process.env.DATABASE_PATH || resolve(root, 'data', 'agent.sqlite'),
      PLAYBOOK_PATH: existsSync(playbookPath) ? playbookPath : '',
      PROJECT_ROOT: root,
    },
  };

  // --- Dynamic integrations from integrations.yaml ---

  const integrationsPath = resolve(root, 'config', 'integrations.yaml');
  if (existsSync(integrationsPath)) {
    try {
      const intConfig = parse(readFileSync(integrationsPath, 'utf8'));

      for (const [name, config] of Object.entries(intConfig.integrations || {})) {
        if (!config.enabled) continue;

        const env = resolveEnv(config.env);

        if (config.command) {
          // Community/external MCP server — use command directly
          mcpServers[name] = {
            command: config.command,
            args: config.args || [],
            env,
          };
        } else {
          // Local integration — look in framework and agent dir
          const mcpServerPath = existsSync(resolve(root, 'integrations', name, 'mcp-server.js'))
            ? resolve(root, 'integrations', name, 'mcp-server.js')
            : resolve(FRAMEWORK_ROOT, 'integrations', name, 'mcp-server.js');
          if (!existsSync(mcpServerPath)) {
            log.warn(`Integration ${name} enabled but ${mcpServerPath} not found, skipping`);
            continue;
          }
          mcpServers[name] = {
            command: 'node',
            args: [mcpServerPath],
            env,
          };
        }
      }
    } catch (err) {
      log.error('Failed to load integrations.yaml', err);
    }
  }

  // Inject SPAWNBOT_FRAMEWORK_ROOT into every server's env
  for (const entry of Object.values(mcpServers)) {
    entry.env = entry.env || {};
    entry.env.SPAWNBOT_FRAMEWORK_ROOT = FRAMEWORK_ROOT;
  }

  // --- Write mcp.json ---

  const config = { mcpServers };
  const outputPath = resolve(root, 'data', 'mcp.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(outputPath, JSON.stringify(config, null, 2), 'utf8');

  return outputPath;
}

/**
 * Read the generated mcp.json.
 */
export function readMcpConfig(projectRoot) {
  const root = projectRoot || process.cwd();
  const path = resolve(root, 'data', 'mcp.json');

  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
