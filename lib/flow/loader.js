/**
 * Flow Skill Loader — loads flow skills from SKILL.md files.
 *
 * A flow skill is a SKILL.md with `type: flow` in its frontmatter
 * and a fenced ```mermaid code block containing the flowchart.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { parseMermaid, FlowParseError } from './parser.js';

/**
 * Load a single flow skill from a SKILL.md file.
 * @param {string} skillPath — path to SKILL.md
 * @returns {{ name: string, description: string, flow: Flow, raw: string } | null}
 */
export function loadFlowSkill(skillPath) {
  if (!existsSync(skillPath)) return null;

  const content = readFileSync(skillPath, 'utf8');

  // Parse frontmatter (simple YAML between --- delimiters)
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter || frontmatter.type !== 'flow') return null;

  // Extract mermaid code block
  const mermaidSource = extractMermaid(content);
  if (!mermaidSource) return null;

  // Parse the flowchart
  const flow = parseMermaid(mermaidSource);

  return {
    name: frontmatter.name || 'unnamed',
    description: frontmatter.description || '',
    flow,
    raw: content,
  };
}

/**
 * List all flow skills in a skills directory.
 * @param {string} skillsDir — path to skills/ directory
 * @returns {Array<{ name: string, description: string }>}
 */
export function listFlowSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];

  const flows = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillPath = resolve(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    const content = readFileSync(skillPath, 'utf8');
    const frontmatter = parseFrontmatter(content);

    if (frontmatter?.type === 'flow') {
      flows.push({
        name: frontmatter.name || entry.name,
        description: frontmatter.description || '',
      });
    }
  }

  return flows;
}

/**
 * Parse simple YAML frontmatter from markdown.
 * Returns key-value object or null if no frontmatter.
 */
function parseFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return null;

  const lines = match[1].split('\n');
  const result = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

/**
 * Extract the first ```mermaid fenced code block from markdown.
 * @param {string} content — full markdown content
 * @returns {string|null} — mermaid source or null
 */
function extractMermaid(content) {
  const match = /```mermaid\s*\n([\s\S]*?)\n```/.exec(content);
  return match ? match[1] : null;
}
