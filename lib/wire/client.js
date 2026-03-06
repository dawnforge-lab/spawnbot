import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { v4 as uuid } from 'uuid';
import { WireHandler } from './handler.js';
import { createLogger } from '../logger.js';

const log = createLogger('WIRE');

const WIRE_PROTOCOL_VERSION = '1.3';
const DEFAULT_TIMEOUT = 300000; // 5 minutes per turn

export class WireClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.process = null;
    this.reader = null;
    this.handler = new WireHandler(config);
    this.pending = new Map(); // id → { resolve, reject, timer }
    this.turnInProgress = false;
    this.initialized = false;
    this._buffer = '';

    // Bubble up handler events
    this.handler.on('content', (data) => this.emit('content', data));
    this.handler.on('think', (data) => this.emit('think', data));
    this.handler.on('tool_call', (data) => this.emit('tool_call', data));
    this.handler.on('tool_result', (data) => this.emit('tool_result', data));
    this.handler.on('tool_call_event', (data) => this.emit('tool_call_event', data));
    this.handler.on('tool_result_event', (data) => this.emit('tool_result_event', data));
    this.handler.on('status_update', (data) => this.emit('status_update', data));
    this.handler.on('turn_begin', () => { this.turnInProgress = true; this.emit('turn_begin'); });
    this.handler.on('turn_end', (data) => { this.turnInProgress = false; this.emit('turn_end', data); });
    this.handler.on('safeword', () => this.emit('safeword'));
  }

  async spawn() {
    return new Promise((resolve, reject) => {
      const args = ['--wire'];

      // Add agent file if it exists
      if (this.config.kimi?.agentFile) {
        args.push('--agent-file', this.config.kimi.agentFile);
      }

      // Add MCP config file if generated
      if (this.config.paths?.mcpConfig) {
        args.push('--mcp-config-file', this.config.paths.mcpConfig);
      }

      // Auto-approve all actions (agent runs autonomously)
      args.push('--yolo');

      // Model override
      if (this.config.kimi?.model) {
        args.push('--model', this.config.kimi.model);
      }

      // Thinking mode
      if (this.config.kimi?.thinking === 'true') args.push('--thinking');
      if (this.config.kimi?.thinking === 'false') args.push('--no-thinking');

      // Max steps per turn
      if (this.config.kimi?.maxStepsPerTurn > 0) {
        args.push('--max-steps-per-turn', String(this.config.kimi.maxStepsPerTurn));
      }

      // Verbose output
      if (this.config.kimi?.verbose) args.push('--verbose');

      const cmd = this.config.kimi?.command || 'kimi';
      log.info(`Spawning: ${cmd} ${args.join(' ')}`);

      this.process = spawn(cmd, args, {
        cwd: this.config.projectRoot,
        env: {
          ...process.env,
          SPAWNBOT_MODE: 'true',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Absorb write errors on destroyed stdin (EIO, EPIPE)
      this.process.stdin.on('error', (err) => {
        log.debug(`stdin error (ignored): ${err.code || err.message}`);
      });

      // Read stdout line by line (JSON-RPC messages)
      this.reader = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.reader.on('line', (line) => {
        this._handleLine(line);
      });

      // Log stderr (Kimi CLI logs)
      const stderrReader = createInterface({
        input: this.process.stderr,
        crlfDelay: Infinity,
      });
      stderrReader.on('line', (line) => {
        // Only log non-empty lines that aren't progress spinners
        if (line.trim() && !line.includes('\r')) {
          this.emit('log', line);
        }
      });

      this.process.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      let resolved = false;

      this.process.on('exit', (code, signal) => {
        this.initialized = false;
        this.turnInProgress = false;
        this._rejectAllPending(new Error(`Kimi CLI exited (code: ${code}, signal: ${signal})`));
        this.emit('disconnected', code);
        if (!resolved) {
          resolved = true;
          reject(new Error(`Kimi CLI exited immediately (code: ${code})`));
        }
      });

      // Resolve once we get ANY output on stdout (wire is ready)
      // or after a brief delay if process is still alive
      const readyCheck = setInterval(() => {
        if (this.process && !this.process.killed && !resolved) {
          resolved = true;
          clearInterval(readyCheck);
          resolve();
        }
      }, 100);

      // Timeout after 10s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(readyCheck);
          reject(new Error('Kimi CLI failed to start within 10s'));
        }
      }, 10000);
    });
  }

  async initialize() {
    const result = await this._request('initialize', {
      protocol_version: WIRE_PROTOCOL_VERSION,
      client: {
        name: 'spawnbot',
        version: '0.1.0',
      },
      capabilities: {
        supports_question: true,
      },
    });

    this.initialized = true;
    log.info(`Wire protocol initialized (server: ${result?.server?.name || 'unknown'} ${result?.server?.version || ''})`);
    return result;
  }

  async prompt(input, { timeout = DEFAULT_TIMEOUT } = {}) {
    if (!this.initialized) {
      throw new Error('Wire client not initialized — call initialize() first');
    }
    if (this.turnInProgress) {
      throw new Error('Turn already in progress — queue input or use steer()');
    }

    // Wire protocol uses user_input field (string or ContentPart[])
    try {
      const result = await this._request('prompt', { user_input: input }, timeout);
      return result;
    } catch (err) {
      // Reset turn state on timeout or error so we don't get permanently stuck
      this.turnInProgress = false;
      throw err;
    }
  }

  async steer(input) {
    if (!this.turnInProgress) {
      throw new Error('No turn in progress — use prompt() instead');
    }

    // steer is a request (has id, expects response)
    return this._request('steer', { user_input: input });
  }

  async cancel() {
    if (this.turnInProgress) {
      return this._request('cancel', {});
    }
  }

  isConnected() {
    return this.process && !this.process.killed && this.initialized;
  }

  kill() {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // Force kill after 5s if still alive
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  // --- Private ---

  _handleLine(line) {
    if (!line.trim()) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      this.emit('log', `Non-JSON from wire: ${line}`);
      return;
    }

    this.handler.log(msg);

    // Response to a request we sent
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(timer);

      if (msg.error) {
        reject(new WireError(msg.error.code, msg.error.message, msg.error.data));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Notification from Kimi CLI (no id)
    if (!msg.id && msg.method) {
      this.handler.handleNotification(msg.method, msg.params);
      return;
    }

    // Request from Kimi CLI (has id, needs response)
    if (msg.id && msg.method) {
      this._handleServerRequest(msg);
      return;
    }
  }

  async _handleServerRequest(msg) {
    try {
      const result = await this.handler.handleRequest(msg.method, msg.params);
      this._send({
        jsonrpc: '2.0',
        id: msg.id,
        result,
      });
    } catch (err) {
      this._send({
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32603,
          message: err.message,
        },
      });
    }
  }

  _request(method, params, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = uuid();

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Wire request "${method}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      this._send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  _notify(method, params) {
    this._send({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  _send(obj) {
    if (!this.process || this.process.killed) {
      throw new Error('Wire client not connected');
    }
    const line = JSON.stringify(obj) + '\n';
    try {
      this.process.stdin.write(line);
    } catch (err) {
      // Pipe already destroyed — emit error instead of crashing
      this.emit('error', err);
    }
  }

  _rejectAllPending(err) {
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }
}

export class WireError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'WireError';
    this.code = code;
    this.data = data;
  }
}
