/**
 * Systemd Service — early opt-in + deferred install.
 *
 * Two phases:
 *   1. chooseServiceMode() — at start of setup, asks if user wants auto-start.
 *      If yes, prompts for sudo immediately so credentials are cached.
 *   2. installServiceStep() — at end of setup, performs the actual install
 *      using the cached sudo session (no second password prompt).
 */

import { execSync } from 'child_process';
import { select } from '@inquirer/prompts';
import { section, step, c } from '../util.js';
import {
  isSystemdAvailable,
  isServiceInstalled,
  installService,
  getServiceStatus,
  hasPasswordlessSudo,
  setupPasswordlessSudo,
} from '../../service/index.js';

/**
 * Phase 1: Ask the user how they want to run the agent.
 * Called early in setup. If they choose system service, sudo is cached now.
 * Returns 'service' | 'manual'.
 */
export async function chooseServiceMode() {
  section('Run Mode');

  // No systemd — skip silently, always manual
  if (!isSystemdAvailable()) {
    console.log(c.dim('  systemd not detected — agent will run manually.'));
    console.log(c.dim('  Start with: spawnbot start'));
    return 'manual';
  }

  // Already installed — just check passwordless sudo
  if (isServiceInstalled()) {
    step('System service already installed', 'pass');
    if (!hasPasswordlessSudo()) {
      console.log(c.dim('  Passwordless sudo not configured — authenticating to set it up...'));
      try {
        execSync('sudo -v', { stdio: 'inherit' });
        setupPasswordlessSudo();
        step('Passwordless sudo configured', 'pass');
      } catch {
        step('Passwordless sudo', 'warn', 'setup failed — agent may hang on sudo commands');
      }
    }
    return 'service';
  }

  const mode = await select({
    message: 'How should the agent run?',
    choices: [
      {
        name: 'System service (auto-start on boot)',
        value: 'service',
        description: 'Installs a systemd service — requires sudo',
      },
      {
        name: 'Manual (start/stop yourself)',
        value: 'manual',
        description: 'Run with "spawnbot start" when you need it',
      },
    ],
  });

  if (mode === 'service') {
    // Cache sudo credentials now so the install at the end doesn't prompt
    console.log();
    console.log(c.dim('  Authenticating sudo (needed for service install + passwordless sudo)...'));
    try {
      execSync('sudo -v', { stdio: 'inherit' });
      step('sudo authenticated', 'pass');
    } catch {
      step('sudo authentication failed', 'fail');
      console.log(c.dim('  Falling back to manual mode. You can install later with: spawnbot service install'));
      return 'manual';
    }

    // Set up passwordless sudo — the agent runs autonomously and needs sudo without a terminal
    if (!hasPasswordlessSudo()) {
      try {
        setupPasswordlessSudo();
        step('Passwordless sudo configured', 'pass');
      } catch (err) {
        step('Passwordless sudo failed', 'warn', err.message);
        console.log(c.dim('  The agent may hang if it runs sudo commands. Fix manually:'));
        console.log(c.dim(`  echo '${process.env.USER} ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/spawnbot-${process.env.USER}`));
      }
    } else {
      step('Passwordless sudo already configured', 'pass');
    }
  }

  return mode;
}

/**
 * Phase 2: Actually install the service.
 * Called at end of setup, only if mode === 'service'.
 * Sudo should already be cached from chooseServiceMode().
 */
export async function installServiceStep(projectRoot) {
  section('System Service');

  if (isServiceInstalled()) {
    step('Service already installed', 'pass');
    return;
  }

  try {
    installService(projectRoot);
    console.log();
    step('Systemd service installed and started', 'pass');

    // Show brief status
    const status = getServiceStatus();
    const activeLine = status.split('\n').find(l => l.includes('Active:'));
    if (activeLine) {
      console.log(c.dim(`  ${activeLine.trim()}`));
    }
  } catch (err) {
    step('Service install failed', 'fail', err.message);
    console.log(c.dim('  You can retry later with: spawnbot service install'));
  }
}
