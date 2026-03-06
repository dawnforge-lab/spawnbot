/**
 * Personality Loader - Bridge SOUL.yaml to JavaScript
 *
 * Loads agent identity, personality traits, and behavior rules
 * from SOUL.yaml for use by the decision engine.
 */

import { parse } from 'yaml';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('PERSONALITY');

// Cache for personality data
let _personalityCache = null;
let _soulPath = null;

/**
 * Load and parse SOUL.yaml
 */
export function loadPersonality(soulPath = null) {
  if (_personalityCache && !soulPath) {
    return _personalityCache;
  }

  const configPath = soulPath || join(process.cwd(), 'config', 'SOUL.yaml');

  try {
    const content = readFileSync(configPath, 'utf8');
    const soul = parse(content);

    _personalityCache = soul;
    _soulPath = configPath;

    log.info(`Loaded SOUL: ${soul.identity?.name || 'Unknown'}`);
    return soul;
  } catch (err) {
    log.error('Failed to load SOUL.yaml', err);
    return getDefaultPersonality();
  }
}

/**
 * Default personality if SOUL.yaml fails to load
 */
function getDefaultPersonality() {
  return {
    identity: {
      name: 'Agent',
      tagline: '',
      description: 'Autonomous AI Agent',
    },
    personality: {
      traits: {
        analytical: 5,
        creative: 5,
        assertive: 5,
        thorough: 5,
        patient: 5,
      },
    },
    voice: {
      style: 'professional',
      tone: 'neutral',
      emojis: false,
      vocabulary: { prefer: [], avoid: [] },
    },
    safety: {
      stop_phrase: 'emergency-stop',
      hard_limits: [],
      behavior_rules: [],
    },
  };
}

/**
 * Personality accessor class
 */
export class Personality {
  constructor(soulData = null) {
    this.soul = soulData || loadPersonality();
  }

  get identity() {
    return this.soul.identity;
  }

  /**
   * Get a personality trait (1-10 scale)
   */
  getTrait(trait) {
    return this.soul.personality?.traits?.[trait] || 5;
  }

  get traits() {
    return this.soul.personality?.traits || {};
  }

  get voice() {
    return this.soul.voice || {};
  }

  get rules() {
    return this.soul.safety?.behavior_rules || [];
  }

  get limits() {
    return this.soul.safety?.hard_limits || [];
  }

  get stopPhrase() {
    return this.soul.safety?.stop_phrase || 'emergency-stop';
  }

  /**
   * Reload personality from disk
   */
  reload() {
    _personalityCache = null;
    this.soul = loadPersonality(_soulPath);
    return this;
  }

  /**
   * Export personality as context for LLM
   */
  toContext() {
    return {
      identity: this.identity,
      traits: this.traits,
      voice: this.voice,
      rules: this.rules,
    };
  }
}

// Singleton instance
let _personalityInstance = null;

export function getPersonality() {
  if (!_personalityInstance) {
    _personalityInstance = new Personality();
  }
  return _personalityInstance;
}

export function resetPersonality() {
  _personalityCache = null;
  _personalityInstance = null;
}

export default {
  loadPersonality,
  getPersonality,
  resetPersonality,
  Personality
};
