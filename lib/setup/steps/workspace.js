/**
 * Step: Workspace — set up git version control for agent config.
 */

import { select, input } from '@inquirer/prompts';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { section, c } from '../util.js';

/**
 * Check if a CLI command is available.
 */
function hasCommand(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if gh CLI is authenticated.
 */
function isGhAuthenticated() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kebab-case a string for use as a repo name.
 */
function kebabCase(str) {
  return (str || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Set up workspace version control.
 * @param {string} agentName - Agent name (used as default repo name)
 * @returns {{ mode: 'github'|'git'|'none', repoName?: string, visibility?: string }}
 */
export async function setupWorkspace(agentName) {
  section('Workspace');

  console.log(c.dim('  Version-control your agent\'s config in a git repository.'));
  console.log(c.dim('  Config files and skills are tracked. Runtime data and credentials are gitignored.'));
  console.log();

  const mode = await select({
    message: 'Set up a workspace?',
    choices: [
      {
        name: 'Create a GitHub repository',
        value: 'github',
        description: 'Requires gh CLI — creates a repo and pushes config',
      },
      {
        name: 'Initialize local git only',
        value: 'git',
        description: 'Version-control locally, push to remote later',
      },
      {
        name: 'Skip (no version control)',
        value: 'none',
      },
    ],
  });

  if (mode === 'none') {
    console.log();
    return { mode: 'none' };
  }

  if (mode === 'git') {
    console.log(c.success('  Local git will be initialized after config generation.'));
    console.log();
    return { mode: 'git' };
  }

  // GitHub mode — validate gh CLI
  if (!hasCommand('gh')) {
    throw new Error(
      'gh CLI not found. Install it from https://cli.github.com/ and run "gh auth login" first.'
    );
  }

  if (!isGhAuthenticated()) {
    throw new Error(
      'gh CLI is not authenticated. Run "gh auth login" first.'
    );
  }

  const defaultName = kebabCase(agentName);

  const repoName = await input({
    message: 'Repository name:',
    default: defaultName,
  });

  const visibility = await select({
    message: 'Visibility:',
    choices: [
      { name: 'Private', value: 'private' },
      { name: 'Public', value: 'public' },
    ],
  });

  const webhookSecret = randomBytes(32).toString('hex');

  console.log(c.success(`  GitHub repo "${repoName}" (${visibility}) will be created after config generation.`));
  console.log();

  return { mode: 'github', repoName, visibility, webhookSecret };
}
