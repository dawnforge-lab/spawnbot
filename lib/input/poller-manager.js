/**
 * Poller Manager — generic polling system for integration add-ons.
 *
 * Loads integrations.yaml, discovers enabled integrations, imports each
 * integration's poller.js, and runs poll() at the configured interval.
 * Events are pushed to the InputQueue with configured priority.
 *
 * Poller contract:
 *   export default {
 *     name: 'my-integration',
 *     defaultInterval: 60,
 *     async poll(lastState) → { events: [...], newState: {...} }
 *   }
 *
 * Each event: { type, content, sender, metadata, priority? }
 */

import { EventEmitter } from 'events';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { createLogger } from '../logger.js';

const log = createLogger('POLLER');

export class PollerManager extends EventEmitter {
  constructor({ queue, config, projectRoot }) {
    super();
    this.queue = queue;
    this.config = config; // parsed integrations.yaml
    this.projectRoot = projectRoot || process.cwd();
    this.pollers = new Map(); // name → { poller, interval, timer, lastState }
    this.running = false;
    this.stateStore = null; // injected: (key) => get, (key, value) => set
  }

  /**
   * Set state persistence functions.
   * Used to persist per-integration poll state in SQLite.
   */
  setStateStore({ get, set }) {
    this.stateStore = { get, set };
  }

  /**
   * Start all enabled pollers.
   */
  async start() {
    if (this.running) return;
    this.running = true;

    const integrations = this.config?.integrations || {};

    for (const [name, intConfig] of Object.entries(integrations)) {
      if (!intConfig.enabled) continue;

      try {
        await this._startPoller(name, intConfig);
      } catch (err) {
        log.error(`Failed to start ${name}:`, err.message);
      }
    }

    log.info(`Started ${this.pollers.size} pollers`);
  }

  /**
   * Stop all pollers.
   */
  stop() {
    this.running = false;
    for (const [name, entry] of this.pollers) {
      if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
      }
      log.info(`Stopped: ${name}`);
    }
    this.pollers.clear();
  }

  /**
   * Start a single integration poller.
   */
  async _startPoller(name, intConfig) {
    const pollerPath = resolve(this.projectRoot, 'integrations', name, 'poller.js');

    if (!existsSync(pollerPath)) {
      log.warn(`${name}: poller.js not found at ${pollerPath}, skipping`);
      return;
    }

    const pollerModule = await import(pollerPath);
    const poller = pollerModule.default || pollerModule;

    if (typeof poller.poll !== 'function') {
      log.error(`${name}: poller.js does not export a poll() function`);
      return;
    }

    const intervalSec = intConfig.poll_interval || poller.defaultInterval || 60;
    const priority = intConfig.priority || 'normal';

    // Restore last state
    let lastState = null;
    if (this.stateStore) {
      try {
        const stored = this.stateStore.get(`poller_state_${name}`);
        if (stored) lastState = JSON.parse(stored);
      } catch { /* ignore */ }
    }

    const entry = { poller, interval: intervalSec, timer: null, lastState, priority };
    this.pollers.set(name, entry);

    // Run first poll immediately
    this._runPoll(name, entry);

    // Schedule recurring polls
    entry.timer = setInterval(() => this._runPoll(name, entry), intervalSec * 1000);

    log.info(`Started: ${name} (every ${intervalSec}s, priority: ${priority})`);
  }

  /**
   * Execute a single poll cycle for an integration.
   */
  async _runPoll(name, entry) {
    if (!this.running) return;

    try {
      const result = await entry.poller.poll(entry.lastState);

      if (!result) return;

      const events = result.events || [];
      entry.lastState = result.newState || entry.lastState;

      // Persist state
      if (this.stateStore && result.newState) {
        try {
          this.stateStore.set(`poller_state_${name}`, JSON.stringify(result.newState));
        } catch { /* ignore */ }
      }

      // Push events to queue
      for (const event of events) {
        this.queue.enqueue({
          source: name,
          sender: event.sender || name,
          senderName: event.senderName || event.sender || name,
          content: event.content,
          priority: event.priority || entry.priority,
          metadata: {
            type: event.type,
            integration: name,
            ...event.metadata,
          },
        });
      }

      if (events.length > 0) {
        this.emit('poll_events', { integration: name, count: events.length });
      }
    } catch (err) {
      log.error(`${name} poll failed:`, err.message);
      this.emit('poll_error', { integration: name, error: err.message });
    }
  }

  /**
   * Get status of all pollers.
   */
  getStatus() {
    const status = {};
    for (const [name, entry] of this.pollers) {
      status[name] = {
        interval: entry.interval,
        priority: entry.priority,
        hasState: entry.lastState !== null,
      };
    }
    return status;
  }
}
