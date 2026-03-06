/**
 * Setup wizard utilities — banner, spinner, colors, file writers.
 */

import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

// ── Colors ──────────────────────────────────────────────

export const c = {
  title: chalk.bold.cyan,
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
  accent: chalk.magenta,
  label: chalk.bold.white,
  value: chalk.cyan,
};

export const sym = {
  pass: c.success('✓'),
  fail: c.error('✗'),
  warn: c.warn('!'),
  arrow: c.dim('→'),
  bullet: c.dim('•'),
};

// ── Banner ──────────────────────────────────────────────

export function banner() {
  console.log();
  console.log(c.title('╭───────────────────────────────╮'));
  console.log(c.title('│  spawnbot setup wizard  v0.1  │'));
  console.log(c.title('╰───────────────────────────────╯'));
  console.log();
}

// ── Spinner ─────────────────────────────────────────────

export function spinner(text) {
  return ora({ text, color: 'cyan' });
}

// ── Section headers ─────────────────────────────────────

export function section(title) {
  console.log();
  console.log(c.bold(title));
  console.log(c.dim('─'.repeat(title.length)));
  console.log();
}

export function step(label, status, detail) {
  const icon = status === 'pass' ? sym.pass
    : status === 'fail' ? sym.fail
    : status === 'warn' ? sym.warn
    : c.dim('○');
  const detailStr = detail ? ` ${c.dim(detail)}` : '';
  console.log(`  ${icon} ${label}${detailStr}`);
}

// ── File writers ────────────────────────────────────────

/**
 * Write a YAML config file. If merge=true and file exists,
 * deep-merge new data into existing (preserving extra keys).
 */
export function writeYamlFile(filePath, data, { header = '', merge = false } = {}) {
  ensureDir(filePath);

  let output = data;
  if (merge && existsSync(filePath)) {
    try {
      const existing = yamlParse(readFileSync(filePath, 'utf8'));
      if (existing && typeof existing === 'object') {
        output = deepMerge(existing, data);
      }
    } catch {
      // Parse failed, overwrite
    }
  }

  let content = '';
  if (header) content += header + '\n';
  content += yamlStringify(output, { lineWidth: 120 });

  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Write or update a .env file. Preserves existing keys and comments.
 * Only adds/updates keys present in `vars`.
 */
export function writeEnvFile(filePath, vars) {
  ensureDir(filePath);

  let lines = [];
  const existingKeys = new Set();

  if (existsSync(filePath)) {
    lines = readFileSync(filePath, 'utf8').split('\n');
    // Update existing keys in-place
    lines = lines.map(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match && match[1] in vars) {
        existingKeys.add(match[1]);
        return `${match[1]}=${vars[match[1]]}`;
      }
      return line;
    });
  }

  // Append new keys not already in file
  for (const [key, value] of Object.entries(vars)) {
    if (!existingKeys.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  // Remove trailing empty lines, add one final newline
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  lines.push('');

  writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

/**
 * Write a plain text file (system prompt, etc.)
 */
export function writeTextFile(filePath, content) {
  ensureDir(filePath);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── Helpers ─────────────────────────────────────────────

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
        && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Read an existing YAML config file for defaults.
 */
export function readYamlFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return yamlParse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}
