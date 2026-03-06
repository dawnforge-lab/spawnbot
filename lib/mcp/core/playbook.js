/**
 * Playbook — loads and queries PLAYBOOK.yaml for action templates.
 * No external dependencies beyond yaml + fs.
 */

import { parse } from 'yaml';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

let _cache = null;

/**
 * Load PLAYBOOK.yaml (cached).
 */
export function loadPlaybook(playbookPath) {
  if (_cache) return _cache;

  const path = playbookPath || resolve(process.cwd(), 'config', 'PLAYBOOK.yaml');
  if (!existsSync(path)) return { categories: {} };
  const content = readFileSync(path, 'utf8');
  _cache = parse(content) || { categories: {} };
  return _cache;
}

/**
 * Reset cache (for config reloads).
 */
export function resetPlaybookCache() {
  _cache = null;
}

/**
 * Search actions across all playbook categories.
 * Filters by category and keyword.
 */
export function searchPlaybook(playbookPath, { category, keyword, limit = 20 } = {}) {
  const db = loadPlaybook(playbookPath);
  const results = [];

  for (const [catName, catData] of Object.entries(db.categories || {})) {
    if (category && catName !== category) continue;

    for (const action of catData.tasks || catData.actions || []) {
      // Keyword filter (search in name, description, id)
      if (keyword) {
        const kw = keyword.toLowerCase();
        const searchable = [action.id, action.name, action.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(kw)) continue;
      }

      results.push({
        id: action.id,
        category: catName,
        name: action.name || action.description,
        description: action.description,
        duration: action.duration,
      });

      if (results.length >= limit) return results;
    }
  }

  return results;
}

/**
 * Get all category names with action counts.
 */
export function getPlaybookCategories(playbookPath) {
  const db = loadPlaybook(playbookPath);
  const cats = [];

  for (const [name, data] of Object.entries(db.categories || {})) {
    cats.push({
      name,
      description: data.description || name,
      actionCount: (data.tasks || data.actions || []).length,
    });
  }

  return cats;
}

/**
 * Select a random action from a playbook category.
 */
export function selectRandomAction(playbookPath, { category, exclude = [] } = {}) {
  const db = loadPlaybook(playbookPath);
  const catData = db.categories?.[category];
  if (!catData) return null;

  const excludeSet = new Set(exclude);
  const actions = (catData.tasks || catData.actions || []);
  const eligible = actions.filter(a => !excludeSet.has(a.id));

  if (eligible.length === 0) return null;

  const action = eligible[Math.floor(Math.random() * eligible.length)];
  return {
    id: action.id,
    category,
    name: action.name || action.description,
    description: action.description,
    duration: action.duration,
  };
}
