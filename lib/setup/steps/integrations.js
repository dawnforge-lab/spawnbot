/**
 * Step: Integrations — select skills to install.
 *
 * Skills are on-demand knowledge documents the agent reads before performing
 * specific work. Built-in skills are always installed. Optional skills
 * (like X/Twitter) are presented as choices during setup.
 */

import { checkbox } from '@inquirer/prompts';
import { section, c } from '../util.js';

/**
 * Skill catalog — all available skills.
 * builtin skills are always installed and not shown in the picker.
 */
export const SKILL_CATALOG = [
  // Built-in (always installed)
  { name: 'tool-creation', builtin: true },
  { name: 'skill-creation', builtin: true },
  { name: 'flow-skills', builtin: true },
  { name: 'github-workspace', builtin: true },

  // Optional (user selects)
  {
    name: 'x-bot',
    label: 'X/Twitter',
    description: 'Post tweets, check mentions, DMs, timeline, engagement',
  },
  {
    name: 'fal-image',
    label: 'Fal.ai Image Generation',
    description: 'Generate images from text prompts using Flux models, with optional LoRA support',
  },
  {
    name: 'reddit-bot',
    label: 'Reddit',
    description: 'Post, comment, search, browse subreddits, and monitor engagement',
  },
  {
    name: 'moltbook',
    label: 'Moltbook',
    description: 'Social network for AI agents — post, comment, vote, DM, and join communities',
  },
  {
    name: 'google-email',
    label: 'Google Email & Calendar',
    description: 'Gmail read/send via IMAP/SMTP and Google Calendar via CalDAV — no OAuth, no Cloud Console',
  },
  {
    name: 'cartesia-tts',
    label: 'Cartesia TTS',
    description: 'Text-to-speech with emotions, multiple voices, speed/volume control, and 42 languages',
  },
];

/**
 * Get built-in skill names (always installed).
 */
export function getBuiltinSkills() {
  return SKILL_CATALOG.filter(s => s.builtin).map(s => s.name);
}

/**
 * Get optional skill choices for the picker.
 */
function getOptionalChoices() {
  return SKILL_CATALOG
    .filter(s => !s.builtin)
    .map(s => ({
      name: `${s.label} — ${s.description}`,
      value: s.name,
    }));
}

/**
 * Present skill selection to the user.
 * Returns list of selected skill names (does NOT include builtins).
 */
export async function selectIntegrations() {
  section('Skills & Integrations');

  const choices = getOptionalChoices();

  if (choices.length === 0) {
    console.log(c.dim('  No optional skills available yet.'));
    console.log();
    return { skills: [] };
  }

  console.log(c.dim('  Skills teach your agent how to use specific platforms and APIs.'));
  console.log(c.dim('  The agent will create its own tools based on the skills you install.'));
  console.log();

  const selected = await checkbox({
    message: 'Install skills:',
    choices,
  });

  if (selected.length > 0) {
    console.log(c.success(`  ${selected.length} skill${selected.length > 1 ? 's' : ''} selected.`));
  } else {
    console.log(c.dim('  No optional skills selected. You can add them later with skill_create.'));
  }

  console.log();
  return { skills: selected };
}
