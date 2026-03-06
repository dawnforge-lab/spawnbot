import { EventEmitter } from 'events';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('WIRE');

/**
 * WireHandler — routes Wire protocol events and requests.
 *
 * Wire protocol v1.3 message format:
 *   Events:   { method: "event", params: { type: "TurnBegin", payload: { ... } } }
 *   Requests: { method: "request", id: "...", params: { type: "ApprovalRequest", payload: { ... } } }
 *
 * Responses we send back for requests:
 *   ApprovalRequest  → { request_id, response: "approve"|"approve_for_session"|"reject" }
 *   ToolCallRequest  → { tool_call_id, content: [...], is_error: bool }
 *   QuestionRequest  → { request_id, answers: { "question text": "selected label" } }
 */
export class WireHandler extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.safeword = config.safeword || 'emergency-stop';
    this.logPath = resolve(config.paths?.logs || 'data/logs', 'wire.jsonl');
    this.externalTools = new Map(); // name → handler function

    // Ensure log directory exists
    const logDir = dirname(this.logPath);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  }

  registerExternalTool(name, handler) {
    this.externalTools.set(name, handler);
  }

  log(msg) {
    try {
      const entry = { ts: Date.now(), ...msg };
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch {
      // Don't crash on log failures
    }
  }

  /**
   * Handle an "event" notification from Kimi CLI.
   * params is the envelope: { type: "TurnBegin", payload: { ... } }
   */
  handleNotification(method, params) {
    if (method !== 'event') {
      this.emit('unknown_notification', { method, params });
      return;
    }

    const eventType = params?.type;
    const payload = params?.payload || {};

    switch (eventType) {
      case 'TurnBegin':
        this.emit('turn_begin', payload);
        break;

      case 'TurnEnd':
        this.emit('turn_end', payload);
        break;

      case 'StepBegin':
        this.emit('step_begin', payload);
        break;

      case 'StepInterrupted':
        this.emit('step_interrupted', payload);
        break;

      case 'ContentPart':
        // ContentPart payload: { type: "text"|"think", text?: "...", think?: "..." }
        if (payload.type === 'text') {
          this._handleContent(payload.text || '', 'text');
        } else if (payload.type === 'think') {
          this.emit('think', { text: payload.think || '' });
        }
        break;

      case 'ToolCall':
      case 'ToolCallPart':
        this.emit('tool_call_event', payload);
        break;

      case 'ToolResult':
        this.emit('tool_result_event', payload);
        break;

      case 'StatusUpdate':
        this.emit('status_update', payload);
        break;

      case 'CompactionBegin':
        this.emit('compaction_begin', payload);
        break;

      case 'CompactionEnd':
        this.emit('compaction_end', payload);
        break;

      case 'ApprovalResponse':
        this.emit('approval_response', payload);
        break;

      default:
        this.emit('unknown_event', { type: eventType, payload });
        break;
    }
  }

  /**
   * Handle a "request" from Kimi CLI that needs a response.
   * params is the envelope: { type: "ApprovalRequest"|"ToolCallRequest"|"QuestionRequest", payload: { ... } }
   */
  async handleRequest(method, params) {
    if (method !== 'request') {
      throw new Error(`Unknown request method: ${method}`);
    }

    const requestType = params?.type;
    const payload = params?.payload || {};

    switch (requestType) {
      case 'ApprovalRequest':
        return this._handleApproval(payload);

      case 'ToolCallRequest':
        return this._handleToolCall(payload);

      case 'QuestionRequest':
        return this._handleQuestion(payload);

      default:
        throw new Error(`Unknown request type: ${requestType}`);
    }
  }

  // --- Private ---

  _handleContent(text, type) {
    // Check for safeword in any content
    if (this._containsSafeword(text)) {
      log.error('SAFEWORD DETECTED — emergency stop');
      this.emit('safeword');
      return;
    }

    this.emit('content', { text, type });
  }

  _handleApproval(payload) {
    const { id, action, description } = payload;
    const desc = description || action || '';

    // Safeword check
    if (this._containsSafeword(desc)) {
      log.error('SAFEWORD in approval request — rejecting');
      this.emit('safeword');
      return { request_id: id, response: 'reject' };
    }

    // Auto-approve everything (agent runs with full autonomy)
    log.debug(`Auto-approved: ${desc.slice(0, 100)}`);
    this.emit('approval', { id, action: desc, decision: 'approve' });
    return { request_id: id, response: 'approve' };
  }

  async _handleToolCall(payload) {
    const { id, name, arguments: argsJson } = payload;

    // Parse arguments from JSON string
    let args = {};
    if (argsJson) {
      try {
        args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
      } catch {
        args = {};
      }
    }

    this.emit('tool_call', { name, args });

    // Check if we have a registered external tool handler
    const handler = this.externalTools.get(name);
    if (handler) {
      try {
        const result = await handler(args);
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        this.emit('tool_result', { name, result, error: false });
        return {
          tool_call_id: id,
          content: [{ type: 'text', text }],
          is_error: false,
        };
      } catch (err) {
        this.emit('tool_result', { name, result: err.message, error: true });
        return {
          tool_call_id: id,
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          is_error: true,
        };
      }
    }

    // Not an external tool — error (shouldn't happen with --yolo)
    return {
      tool_call_id: id,
      content: [{ type: 'text', text: `Unknown external tool: ${name}` }],
      is_error: true,
    };
  }

  _handleQuestion(payload) {
    const { id, questions } = payload;
    const answers = {};

    for (const q of questions || []) {
      const question = q.question || '';
      log.debug(`Auto-answering question: ${question.slice(0, 80)}`);

      // Auto-select first option
      if (q.options && q.options.length > 0) {
        answers[question] = q.options[0].label;
      } else {
        answers[question] = 'proceed';
      }
    }

    this.emit('question_answered', { id, answers });
    return { request_id: id, answers };
  }

  _containsSafeword(text) {
    if (!text || !this.safeword) return false;
    return text.toLowerCase().includes(this.safeword.toLowerCase());
  }
}
