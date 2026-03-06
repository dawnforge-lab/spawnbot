/**
 * Step 3: Conversational Co-creation — use the LLM to help define the agent.
 *
 * Spawns Kimi CLI with a setup-assistant system prompt, then runs a chat loop
 * where the user and LLM collaborate to define personality, voice, safety, etc.
 * The LLM outputs structured YAML between markers when done.
 */

import { createInterface } from 'readline';
import { input } from '@inquirer/prompts';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parse as yamlParse } from 'yaml';
import { WireClient } from '../../wire/client.js';
import { attachDisplay } from '../../wire/display.js';
import { section, c, spinner, readYamlFile } from '../util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETUP_PROMPT_PATH = resolve(__dirname, '..', 'setup-prompt.md');

const CONFIG_BEGIN = '---BEGIN_CONFIG---';
const CONFIG_END = '---END_CONFIG---';

export async function cocreate(projectRoot) {
  section('Agent Co-creation');

  // Get basic info from user
  const agentName = await input({
    message: 'Agent name:',
    required: true,
  });

  const agentPurpose = await input({
    message: 'What does this agent do? (1-2 sentences):',
    required: true,
  });

  // Load existing config for context (if re-running)
  const existingSoul = readYamlFile(resolve(projectRoot, 'config', 'SOUL.yaml'));
  const existingContext = existingSoul
    ? `\n\nExisting configuration (user is re-running setup):\n${JSON.stringify(existingSoul, null, 2)}`
    : '';

  // Build the setup assistant system prompt
  let setupPrompt = readFileSync(SETUP_PROMPT_PATH, 'utf8');
  setupPrompt = setupPrompt
    .replace('${NAME}', agentName)
    .replace('${PURPOSE}', agentPurpose)
    .replace('${EXISTING_CONFIG}', existingContext);

  // Write temporary system prompt and agent file for the setup assistant
  const { writeFileSync, mkdirSync } = await import('fs');
  const tmpDir = resolve(projectRoot, 'data');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const tmpPromptPath = resolve(tmpDir, 'setup-system.md');
  writeFileSync(tmpPromptPath, setupPrompt, 'utf8');

  const tmpAgentPath = resolve(tmpDir, 'setup-agent.yaml');
  const { stringify: yamlStringify } = await import('yaml');
  writeFileSync(tmpAgentPath, yamlStringify({
    version: 1,
    agent: {
      extend: 'default',
      name: 'Setup Assistant',
      system_prompt_path: './setup-system.md',
    },
  }), 'utf8');

  // Spawn Kimi CLI with the setup agent
  const s = spinner('Connecting to LLM for co-creation...');
  s.start();

  const wireConfig = {
    projectRoot,
    kimi: { command: 'kimi', agentFile: tmpAgentPath },
    paths: { logs: resolve(projectRoot, 'data', 'logs') },
    safeword: '__disabled__', // Don't trigger safeword during setup
  };

  const wire = new WireClient(wireConfig);
  let allContent = '';

  // Attach interactive display — shows thinking, tool calls, and streams content
  const detachDisplay = attachDisplay(wire, {
    showContent: true,
    onContent: ({ text }) => { allContent += text; },
  });

  try {
    await wire.spawn();
    await wire.initialize();
    s.stop();

    console.log();
    console.log(c.dim('─── Chat with your agent\'s creator ───────────────────────'));
    console.log();

    // First prompt: kick off the conversation (system prompt has full context)
    const firstPrompt = `Let's start. Help me define ${agentName}'s personality — suggest specific trait ratings based on its purpose.`;

    allContent = '';
    await wire.prompt(firstPrompt);
    console.log('\n');

    // Chat loop
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let config = null;

    while (!config) {
      const userInput = await new Promise((resolve) => {
        rl.question(c.accent('You: '), (answer) => resolve(answer));
      });

      if (!userInput.trim()) continue;

      // Check for exit commands
      if (['quit', 'exit', 'cancel'].includes(userInput.trim().toLowerCase())) {
        rl.close();
        wire.kill();
        console.log(c.warn('\nSetup cancelled.'));
        process.exit(0);
      }

      allContent = '';
      console.log();
      await wire.prompt(userInput);
      console.log('\n');

      // Check if the LLM output contains the config block
      config = extractConfig(allContent);
    }

    rl.close();
    detachDisplay();
    wire.kill();

    console.log(c.dim('───────────────────────────────────────────────────────────'));
    console.log();
    console.log(c.success('  Agent configuration captured.'));
    console.log();

    // Ensure the agent name is set
    if (!config.identity) config.identity = {};
    if (!config.identity.name) config.identity.name = agentName;
    if (!config.identity.description && agentPurpose) {
      config.identity.description = agentPurpose;
    }

    return config;

  } catch (err) {
    s.stop();
    detachDisplay();
    wire.kill();
    console.log(c.error(`\n  LLM connection failed: ${err.message}`));
    console.log(c.dim('  Falling back to manual configuration...'));
    console.log();

    // Return minimal config so the wizard can continue
    return {
      identity: { name: agentName, tagline: '', description: agentPurpose },
      personality: { traits: { analytical: 5, creative: 5, assertive: 5, thorough: 5, patient: 5, humorous: 5 } },
      voice: { style: 'professional', tone: 'neutral', emojis: false },
      safety: { stop_phrase: 'emergency-stop', hard_limits: ['Never share credentials'], behavior_rules: [] },
    };
  }
}

/**
 * Extract the YAML config block from LLM output.
 * Returns parsed object or null if not found.
 */
function extractConfig(text) {
  const beginIdx = text.indexOf(CONFIG_BEGIN);
  const endIdx = text.indexOf(CONFIG_END);

  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    return null;
  }

  const yamlStr = text.slice(beginIdx + CONFIG_BEGIN.length, endIdx).trim();

  try {
    const parsed = yamlParse(yamlStr);
    if (parsed && typeof parsed === 'object' && parsed.identity) {
      return parsed;
    }
  } catch (err) {
    console.log(c.warn(`  Warning: Could not parse config YAML: ${err.message}`));
  }

  return null;
}
