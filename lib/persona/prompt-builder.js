/**
 * Prompt Builder — renders system.md template with SOUL.yaml values.
 * Output written to data/rendered-system.md for Kimi CLI's agent-file to reference.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { execFileSync } from 'child_process';
import { parse } from 'yaml';

/**
 * Build the rendered system prompt from template + config.
 * @param {string} projectRoot - Project root directory
 * @returns {string} Path to rendered system prompt
 */
export function buildSystemPrompt(projectRoot) {
  const root = projectRoot || process.cwd();

  // Load template
  const templatePath = resolve(root, 'config', 'agent', 'system.md');
  if (!existsSync(templatePath)) {
    throw new Error(`System prompt template not found: ${templatePath}\nRun "spawnbot setup" to generate config files.`);
  }
  let template = readFileSync(templatePath, 'utf8');

  // Load SOUL.yaml
  const soulPath = resolve(root, 'config', 'SOUL.yaml');
  if (!existsSync(soulPath)) {
    throw new Error(`SOUL.yaml not found: ${soulPath}\nRun "spawnbot setup" to generate config files.`);
  }
  const soul = parse(readFileSync(soulPath, 'utf8'));

  // Load MCP config for tool list (if available)
  const mcpPath = resolve(root, 'data', 'mcp.json');
  let mcpConfig = null;
  if (existsSync(mcpPath)) {
    try { mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf8')); } catch {}
  }

  // Scan installed skills
  const skillsDir = resolve(root, 'skills');
  let skillNames = [];
  if (existsSync(skillsDir)) {
    try {
      skillNames = readdirSync(skillsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && existsSync(resolve(skillsDir, e.name, 'SKILL.md')))
        .map(e => e.name);
    } catch {}
  }

  // Build variable map
  const vars = buildVars(root, soul, mcpConfig, skillNames);

  // Render template — replace ${KEY} placeholders
  for (const [key, value] of Object.entries(vars)) {
    template = template.replaceAll(`\${${key}}`, String(value));
  }

  // Write rendered prompt
  const outputPath = resolve(root, 'data', 'rendered-system.md');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(outputPath, template, 'utf8');
  return outputPath;
}

/**
 * Build template variables from SOUL.yaml.
 */
function buildVars(projectRoot, soul, mcpConfig, skillNames = []) {
  const traits = soul.personality?.traits || {};
  const traitLines = Object.entries(traits)
    .map(([name, value]) => `- ${name}: ${value}/10`)
    .join('\n');

  const hardLimits = (soul.safety?.hard_limits || [])
    .map(l => `- ${l}`)
    .join('\n');

  const behaviorRules = (soul.safety?.behavior_rules || [])
    .map(r => `- ${r}`)
    .join('\n');

  const vocabPrefer = (soul.voice?.vocabulary?.prefer || []).join(', ');
  const vocabAvoid = (soul.voice?.vocabulary?.avoid || []).join(', ');

  return {
    IDENTITY_NAME: soul.identity?.name || 'Agent',
    IDENTITY_TITLE: soul.identity?.tagline || '',
    IDENTITY_CREATURE: soul.identity?.description || 'Autonomous AI Agent',
    PERSONALITY_TRAITS: traitLines || 'Balanced across all traits.',
    VOICE_STYLE: soul.voice?.style || 'professional',
    VOICE_TONE: soul.voice?.tone || 'neutral',
    VOICE_EMOJIS: soul.voice?.emojis ? 'Yes' : 'No',
    VOICE_PREFER: vocabPrefer,
    VOICE_AVOID: vocabAvoid,
    BEHAVIOR_RULES: behaviorRules || '- Use good judgment.',
    HARD_LIMITS: hardLimits || '- No hard limits configured.',
    SAFEWORD: soul.safety?.stop_phrase || 'emergency-stop',
    MCP_TOOL_LIST: buildToolList(mcpConfig),
    SKILLS_LIST: skillNames.length > 0
      ? skillNames.map(s => `- ${s}`).join('\n')
      : 'No skills installed. Use `skill_list` to check.',
    WORKSPACE_SECTION: buildWorkspaceSection(projectRoot),
  };
}

/**
 * Build workspace awareness section based on git state.
 */
function buildWorkspaceSection(projectRoot) {
  const gitDir = resolve(projectRoot, '.git');
  if (!existsSync(gitDir)) {
    return 'Your workspace is local-only. No version control is configured.';
  }

  let section = `Your workspace is a git repository. Your config files and skills are version-controlled.\nRuntime data (data/) and credentials (.env) are gitignored.\n\nWhen you modify config files (SOUL.yaml, CRONS.yaml, skills), commit the changes with a clear message.\nRead the "github-workspace" skill for detailed git workflow instructions.\n\nFor workspace jobs (workspace: true in CRONS.yaml), you receive branch instructions in the prompt. Follow the branch workflow: create branch, do work, commit, create PR, return to main.`;

  // Check for GitHub remote
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (remote.includes('github.com')) {
      section += `\n\nYour GitHub repo: ${remote}\nYou can use the \`gh\` CLI for issues, PRs, and releases.`;
    }
  } catch {
    // No remote configured
  }

  return section;
}

/**
 * Generate MCP tool list description for the system prompt.
 */
export function buildToolList(mcpConfig) {
  if (!mcpConfig?.mcpServers) return 'No MCP tools configured.';

  const serverNames = Object.keys(mcpConfig.mcpServers);
  if (serverNames.length === 0) return 'No MCP tools configured.';

  return `MCP servers: ${serverNames.join(', ')}\n\nUse tools/list to see all available tool names and descriptions.`;
}
