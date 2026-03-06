/**
 * Priority Input Queue — serializes all inputs for the Wire client.
 * Only one Wire turn can run at a time, so inputs are queued by priority.
 *
 * Priority levels: critical (0) > high (1) > normal (2) > low (3)
 */

import { createLogger } from '../logger.js';

const log = createLogger('QUEUE');
const PRIORITY = { critical: 0, high: 1, normal: 2, low: 3 };
const MAX_QUEUE_SIZE = 100;

export class InputQueue {
  constructor({ maxSize = MAX_QUEUE_SIZE } = {}) {
    this.maxSize = maxSize;
    this.items = []; // sorted: lowest priority number first
    this.waiters = []; // resolve functions waiting for items
  }

  /**
   * Enqueue an input item.
   * @param {object} item — { source, sender, content, priority, metadata }
   */
  enqueue(item) {
    const priority = PRIORITY[item.priority] ?? PRIORITY.normal;
    const entry = {
      ...item,
      priorityNum: priority,
      enqueuedAt: Date.now(),
    };

    // Drop lowest priority items if full
    if (this.items.length >= this.maxSize) {
      // Remove the last (lowest priority) item
      const dropped = this.items.pop();
      log.warn(`Dropped item from ${dropped.source} (queue full, priority ${dropped.priority})`);
    }

    // Insert in sorted position (lower number = higher priority, FIFO within same priority)
    let inserted = false;
    for (let i = 0; i < this.items.length; i++) {
      if (priority < this.items[i].priorityNum) {
        this.items.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.items.push(entry);
    }

    // Wake up a waiter if one exists
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift();
      resolve(this.items.shift());
    }
  }

  /**
   * Dequeue the highest priority item. Blocks until one is available.
   * @returns {Promise<object>}
   */
  async dequeue() {
    if (this.items.length > 0) {
      return this.items.shift();
    }

    // Wait for an item
    return new Promise(resolve => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Peek at the next item without removing it.
   */
  peek() {
    return this.items[0] || null;
  }

  /**
   * Current queue depth.
   */
  get depth() {
    return this.items.length;
  }

  /**
   * Check if queue is empty.
   */
  get empty() {
    return this.items.length === 0;
  }

  /**
   * Clear all items.
   */
  clear() {
    this.items = [];
  }

  /**
   * Get queue stats.
   */
  stats() {
    const byPriority = { critical: 0, high: 0, normal: 0, low: 0 };
    for (const item of this.items) {
      const name = Object.entries(PRIORITY).find(([, v]) => v === item.priorityNum)?.[0] || 'normal';
      byPriority[name]++;
    }
    return { depth: this.items.length, byPriority, waiters: this.waiters.length };
  }
}

export { PRIORITY };
