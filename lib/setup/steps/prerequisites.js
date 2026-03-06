/**
 * Step 1: Prerequisites — check Node.js, Kimi CLI, provider status.
 */

import { execSync } from 'child_process';
import { section, step, c } from '../util.js';

export async function checkPrerequisites() {
  section('Checking prerequisites');

  const results = { nodeOk: false, kimiOk: false, kimiVersion: null, providerOk: false };

  // Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (nodeMajor >= 20) {
    step(`Node.js ${nodeVersion}`, 'pass');
    results.nodeOk = true;
  } else {
    step(`Node.js ${nodeVersion}`, 'fail', '>= 20 required');
    console.log();
    console.log(c.error('  Node.js 20+ is required. Install from https://nodejs.org'));
    process.exit(1);
  }

  // Kimi CLI
  try {
    const kimiVersion = execSync('kimi --version 2>&1', { encoding: 'utf8' }).trim();
    // Extract version number (e.g. "Kimi Code CLI v1.14.0" or just "1.14.0")
    const vMatch = kimiVersion.match(/(\d+\.\d+\.\d+)/);
    results.kimiVersion = vMatch ? vMatch[1] : kimiVersion;
    step(`Kimi CLI v${results.kimiVersion}`, 'pass');
    results.kimiOk = true;
  } catch {
    step('Kimi CLI', 'fail', 'not found');
    console.log();
    console.log(c.error('  Kimi CLI is required. Install:'));
    console.log(c.dim('    pip install kimi-cli'));
    console.log(c.dim('    # or: uv tool install kimi-cli'));
    process.exit(1);
  }

  // LLM provider configured — check ~/.kimi/config.toml for a default_model
  try {
    const { existsSync, readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const { homedir } = await import('os');

    const configPath = resolve(homedir(), '.kimi', 'config.toml');
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      if (content.includes('default_model') && content.includes('provider')) {
        // Extract model name for display
        const modelMatch = content.match(/default_model\s*=\s*"([^"]+)"/);
        const modelName = modelMatch ? modelMatch[1] : 'configured';
        step(`LLM provider (${modelName})`, 'pass');
        results.providerOk = true;
      } else {
        step('LLM provider', 'warn', 'no model configured');
      }
    } else {
      step('LLM provider', 'warn', 'not configured (~/.kimi/config.toml missing)');
    }
  } catch {
    step('LLM provider', 'warn', 'could not check');
  }

  console.log();
  return results;
}
