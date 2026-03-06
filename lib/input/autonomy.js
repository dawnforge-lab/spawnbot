/**
 * Autonomy Loop — periodic self-check-in so the agent thinks proactively.
 *
 * Default interval: 30 minutes.
 * Escalates frequency when idle:
 *   - >2h idle → every 15 minutes
 *   - >6h idle → every 15 minutes + warning in prompt
 */

import { createLogger } from '../logger.js';

const log = createLogger('AUTONOMY');

export class AutonomyLoop {
  constructor({ queue, intervalMs = 30 * 60 * 1000, agentName = 'Agent' }) {
    this.queue = queue;
    this.agentName = agentName;
    this.baseInterval = intervalMs;
    this.currentInterval = intervalMs;
    this.timer = null;
    this.lastActivityAt = Date.now();
    this.running = false;
    this.checkInCount = 0;
  }

  /**
   * Start the autonomy loop.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastActivityAt = Date.now();

    this._scheduleNext();
    log.info(`Started (interval: ${this.baseInterval / 60000}min)`);
  }

  /**
   * Stop the loop.
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info('Stopped');
  }

  /**
   * Record activity (reset idle timer).
   * Call this when any real input is processed.
   */
  recordActivity() {
    this.lastActivityAt = Date.now();
    // Reset to base interval when activity detected
    if (this.currentInterval !== this.baseInterval) {
      this.currentInterval = this.baseInterval;
      this._scheduleNext();
    }
  }

  /**
   * Schedule the next autonomous check-in.
   */
  _scheduleNext() {
    if (!this.running) return;

    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(() => this._checkIn(), this.currentInterval);
  }

  /**
   * Execute an autonomous check-in.
   */
  _checkIn() {
    if (!this.running) return;

    this.checkInCount++;
    const idleMs = Date.now() - this.lastActivityAt;
    const idleMinutes = Math.round(idleMs / 60000);

    // Build check-in prompt
    let prompt = `Autonomous check-in #${this.checkInCount}. You have been idle for ${idleMinutes} minutes.`;

    // Escalate if very idle
    if (idleMs > 6 * 3_600_000) {
      prompt += '\n\nWARNING: Over 6 hours idle. Consider: Is there a problem? Are tasks being neglected? Take proactive action.';
      this.currentInterval = 15 * 60 * 1000; // 15 minutes
    } else if (idleMs > 2 * 3_600_000) {
      prompt += '\n\nNote: Over 2 hours idle. Check for pending tasks, revenue status, and opportunities.';
      this.currentInterval = 15 * 60 * 1000; // 15 minutes
    } else {
      this.currentInterval = this.baseInterval;
    }

    prompt += '\n\nActions: Check status, review active tasks, recall recent memories, decide on proactive steps.';

    this.queue.enqueue({
      source: 'autonomous',
      sender: 'self',
      senderName: `${this.agentName} (self)`,
      content: prompt,
      priority: 'low',
      metadata: {
        checkInNumber: this.checkInCount,
        idleMinutes,
        escalated: idleMs > 2 * 3_600_000,
      },
    });

    // Schedule next
    this._scheduleNext();
  }

  /**
   * Get autonomy loop status.
   */
  getStatus() {
    const idleMs = Date.now() - this.lastActivityAt;
    return {
      running: this.running,
      checkInCount: this.checkInCount,
      currentIntervalMin: this.currentInterval / 60000,
      idleMinutes: Math.round(idleMs / 60000),
      escalated: this.currentInterval < this.baseInterval,
    };
  }
}
