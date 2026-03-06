/**
 * Input Router — dequeues from InputQueue, formats for Wire, manages turn lifecycle.
 *
 * Flow: InputQueue → format → wire.prompt() → response handling → loop
 * Also handles flow execution: source='flow' items run multi-turn FlowRunner sequences.
 */

import { EventEmitter } from 'events';
import { FlowRunner } from '../flow/runner.js';
import { createLogger } from '../logger.js';

const log = createLogger('ROUTER');

export class InputRouter extends EventEmitter {
  constructor({ queue, wireClient }) {
    super();
    this.queue = queue;
    this.wire = wireClient;
    this.running = false;
    this.turnInProgress = false;
    this.currentItem = null;
  }

  /**
   * Start the routing loop.
   */
  async start() {
    if (this.running) return;
    this.running = true;
    log.info('Started');

    this._loop();
  }

  /**
   * Stop the routing loop.
   */
  stop() {
    this.running = false;
    log.info('Stopped');
  }

  /**
   * Main dequeue → prompt → response loop.
   */
  async _loop() {
    while (this.running) {
      try {
        // Wait for next input
        const item = await this.queue.dequeue();
        if (!this.running) break;

        // Flow execution — multi-turn sequence
        if (item.source === 'flow') {
          await this._executeFlow(item);
          continue;
        }

        this.currentItem = item;
        this.turnInProgress = true;
        this.emit('turn_start', item);

        // Format input for Wire protocol
        const formatted = this._formatInput(item);

        // Accumulate streamed content during this turn
        const contentParts = [];
        const onContent = (data) => {
          if (data.type === 'text' && data.text) {
            contentParts.push(data.text);
          }
        };
        this.wire.on('content', onContent);

        // Send to Kimi CLI via Wire
        const startMs = Date.now();
        let result;

        try {
          result = await this.wire.prompt(formatted);
        } catch (err) {
          log.error(`Wire prompt failed: ${err.message}`);
          this.emit('turn_error', { item, error: err });
          this.turnInProgress = false;
          this.currentItem = null;
          this.wire.removeListener('content', onContent);
          continue;
        } finally {
          this.wire.removeListener('content', onContent);
        }

        const durationMs = Date.now() - startMs;

        // Use streamed content if available, fall back to prompt result
        const streamedText = contentParts.join('');
        const responseText = streamedText || this._extractResponse(result);

        this.emit('turn_end', {
          item,
          response: responseText,
          result,
          durationMs,
        });

        this.turnInProgress = false;
        this.currentItem = null;
      } catch (err) {
        log.error(`Loop error: ${err.message}`);
        this.turnInProgress = false;
        this.currentItem = null;

        // Brief pause on error before retrying
        if (this.running) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  /**
   * Execute a flow skill — runs multiple LLM turns sequentially.
   */
  async _executeFlow(item) {
    const { flow, flowName } = item.metadata || {};
    if (!flow) {
      log.error('Flow item missing metadata.flow');
      return;
    }

    this.currentItem = item;
    this.turnInProgress = true;
    this.emit('flow_start', { name: flowName });

    const runner = new FlowRunner({
      wire: this.wire,
      flow,
      name: flowName,
    });

    runner.on('node_start', (e) => this.emit('flow_node', e));
    runner.on('decision', (e) => this.emit('flow_decision', e));

    try {
      const result = await runner.run();
      this.emit('flow_end', { name: flowName, result });
    } catch (err) {
      log.error(`Flow "${flowName}" failed: ${err.message}`);
      this.emit('flow_error', { name: flowName, error: err });
    } finally {
      this.turnInProgress = false;
      this.currentItem = null;
    }
  }

  /**
   * Format an input item for Wire prompt.
   * Returns string for text-only, ContentPart[] for multimodal.
   */
  _formatInput(item) {
    const source = (item.source || 'system').toUpperCase();
    const sender = item.senderName || item.senderId || item.sender || 'unknown';
    const content = item.content || item.text || '';
    return `[${source} from ${sender}]: ${content}`;
  }

  /**
   * Extract text response from Wire turn result.
   */
  _extractResponse(result) {
    if (!result) return '';

    // Wire turn result may contain content array
    if (result.content) {
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }

    // Or it may be a simple text field
    if (result.text) return result.text;
    if (typeof result === 'string') return result;

    return JSON.stringify(result);
  }

  /**
   * Inject an urgent message into the current turn (bypasses queue).
   */
  async steer(content) {
    if (!this.turnInProgress) {
      log.info('No turn in progress, enqueuing as critical');
      this.queue.enqueue({
        source: 'system',
        sender: 'emergency',
        content,
        priority: 'critical',
      });
      return;
    }

    try {
      await this.wire.steer(content);
    } catch (err) {
      log.error(`Steer failed: ${err.message}`);
    }
  }

  /**
   * Get current router state.
   */
  getState() {
    return {
      running: this.running,
      turnInProgress: this.turnInProgress,
      currentSource: this.currentItem?.source || null,
      queueDepth: this.queue.depth,
    };
  }
}
