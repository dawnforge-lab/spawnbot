/**
 * Setup Wizard — interactive CLI for configuring spawnbot.
 *
 * Phases:
 *   1. Prerequisites: check Node.js, Kimi CLI, LLM provider
 *   2. Co-creation: conversational LLM chat to define agent identity
 *   3. Skills & Integrations
 *   4. Credentials & Scheduling
 *   5. Workspace: git/GitHub version control
 *   6. Generate: write config files, validate, smoke test
 *   7. System service (optional)
 */

import { banner } from './util.js';
import { checkPrerequisites } from './steps/prerequisites.js';
import { setupProvider } from './steps/provider.js';
import { cocreate } from './steps/cocreate.js';
import { selectIntegrations } from './steps/integrations.js';
import { collectCredentials } from './steps/credentials.js';
import { setupCrons } from './steps/crons.js';
import { setupWorkspace } from './steps/workspace.js';
import { generate } from './steps/generate.js';
import { chooseServiceMode, installServiceStep } from './steps/service.js';

export async function runSetupWizard({ projectRoot }) {
  banner();

  // Phase 1: Prerequisites + run mode
  const prereqs = await checkPrerequisites();
  await setupProvider(prereqs);
  const serviceMode = await chooseServiceMode();

  // Phase 2: Conversational Co-creation
  const agentConfig = await cocreate(projectRoot);

  // Phase 3: Skills & Integrations
  const { skills } = await selectIntegrations();

  // Phase 4: Credentials & Scheduling
  const credentials = await collectCredentials();
  const crons = await setupCrons();

  // Phase 5: Workspace
  const workspace = await setupWorkspace(agentConfig.identity?.name);

  // Phase 6: Generate & Test
  await generate(projectRoot, { agentConfig, credentials, crons, skills, workspace });

  // Phase 7: Install system service (if opted in)
  if (serviceMode === 'service') {
    await installServiceStep(projectRoot);
  }
}
