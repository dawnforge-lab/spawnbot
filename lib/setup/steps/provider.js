/**
 * Step 2: LLM Provider — help user configure Kimi CLI if needed.
 */

import { spawn } from 'child_process';
import { select } from '@inquirer/prompts';
import { section, c } from '../util.js';

export async function setupProvider(prereqs) {
  if (prereqs.providerOk) return true;

  section('LLM Provider Setup');

  console.log(c.dim('  Kimi CLI needs an LLM provider to power your agent.'));
  console.log(c.dim('  Supported: Anthropic (Claude), OpenAI, DeepSeek, Kimi, Gemini, Ollama'));
  console.log();

  const choice = await select({
    message: 'Set up your LLM provider now?',
    choices: [
      { name: 'Run kimi login (interactive)', value: 'login' },
      { name: "I'll configure it manually later", value: 'skip' },
    ],
  });

  if (choice === 'skip') {
    console.log();
    console.log(c.warn('  Warning: Agent cannot run without an LLM provider.'));
    console.log(c.dim('  Run "kimi login" or "kimi /login" later to configure.'));
    console.log();
    return false;
  }

  // Spawn kimi login interactively
  console.log();
  console.log(c.dim('  Starting Kimi CLI login...'));
  console.log();

  return new Promise((resolve) => {
    const child = spawn('kimi', ['login'], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', (err) => {
      console.log(c.error(`  Failed to run kimi login: ${err.message}`));
      resolve(false);
    });

    child.on('exit', (code) => {
      console.log();
      if (code === 0) {
        console.log(c.success('  LLM provider configured successfully.'));
        resolve(true);
      } else {
        console.log(c.warn('  Login did not complete. You can run "kimi login" later.'));
        resolve(false);
      }
    });
  });
}
