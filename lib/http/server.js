/**
 * HTTP Server subsystem — lightweight HTTP server using Node.js built-in `http` module.
 *
 * Provides webhook endpoints (Telegram, future integrations), API endpoints
 * for mobile app communication, and a health check endpoint.
 */

import { createServer } from 'http';
import { EventEmitter } from 'events';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { resolve } from 'path';
import { loadFlowSkill } from '../flow/loader.js';
import { createLogger } from '../logger.js';

const log = createLogger('HTTP');

export class HttpServer extends EventEmitter {
  constructor({ port = 31415, daemon, apiKey, webhookSecret, githubWebhookSecret }) {
    super();
    this.port = port;
    this.daemon = daemon;
    this.apiKey = apiKey || '';
    this.webhookSecret = webhookSecret || randomUUID();
    this.githubWebhookSecret = githubWebhookSecret || '';
    this.server = null;
    this.publicUrl = null;
    this.routes = new Map(); // 'METHOD /path' → { handler, raw }
  }

  /**
   * Register a route handler.
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - URL path (exact match)
   * @param {Function} handler - (req, res, ctx) where ctx has { json, body, query }
   * @param {object} [opts]
   * @param {boolean} [opts.raw=false] - If true, skip body parsing (handler reads req stream directly)
   */
  addRoute(method, path, handler, { raw = false } = {}) {
    this.routes.set(`${method.toUpperCase()} ${path}`, { handler, raw });
  }

  async start() {
    this._registerBuiltinRoutes();

    this.server = createServer((req, res) => this._handleRequest(req, res));

    return new Promise((resolve, reject) => {
      this.server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE') {
          log.warn(`Port ${this.port} in use — attempting to reclaim`);
          const killed = await this._killPortHolder(this.port);
          if (killed) {
            // Retry after a brief delay
            setTimeout(() => {
              this.server.once('error', (retryErr) => {
                log.error(`Port ${this.port} still in use after reclaim attempt`);
                reject(retryErr);
              });
              this.server.listen(this.port, () => {
                log.info(`Listening on port ${this.port} (reclaimed)`);
                resolve();
              });
            }, 500);
          } else {
            log.error(`Port ${this.port} in use and could not reclaim — is another spawnbot running?`);
            reject(err);
          }
          return;
        }
        reject(err);
      });

      this.server.listen(this.port, () => {
        log.info(`Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Attempt to kill the process holding a port. Only kills node/spawnbot processes.
   * @returns {boolean} true if a process was killed
   */
  async _killPortHolder(port) {
    try {
      const { execFileSync } = await import('child_process');
      const output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8' }).trim();
      if (!output) return false;

      const pids = output.split('\n').map(p => parseInt(p, 10)).filter(p => !isNaN(p) && p !== process.pid);
      if (pids.length === 0) return false;

      // SIGTERM first
      for (const pid of pids) {
        log.warn(`Killing stale process ${pid} on port ${port}`);
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }

      // Wait, then check if they're still alive and SIGKILL
      await new Promise(r => setTimeout(r, 1000));

      for (const pid of pids) {
        try {
          process.kill(pid, 0); // check if still alive
          log.warn(`Process ${pid} did not exit — sending SIGKILL`);
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already dead — good
        }
      }

      await new Promise(r => setTimeout(r, 500));
      return true;
    } catch {
      return false;
    }
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log.info('Server stopped');
          resolve();
        });
        // Force close after 5s
        setTimeout(() => resolve(), 5000);
      } else {
        resolve();
      }
    });
  }

  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);
    const method = req.method.toUpperCase();
    const path = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const route = this.routes.get(`${method} ${path}`);
    if (!route) {
      this._json(res, 404, { error: 'Not found' });
      return;
    }

    try {
      // Raw routes handle the request stream themselves (e.g. webhook handlers)
      if (route.raw) {
        await route.handler(req, res);
        return;
      }

      // Parse body for POST/PUT
      let body = null;
      if (method === 'POST' || method === 'PUT') {
        body = await this._readBody(req);
      }

      const ctx = {
        body,
        query: Object.fromEntries(url.searchParams),
        json: (status, data) => this._json(res, status, data),
        requireApiKey: () => this._requireApiKey(req, res),
        req,
        res,
      };

      await route.handler(req, res, ctx);
    } catch (err) {
      log.error(`Error handling ${method} ${path}`, err);
      if (!res.headersSent) {
        this._json(res, 500, { error: 'Internal server error' });
      }
    }
  }

  _registerBuiltinRoutes() {
    // Health check (unauthenticated)
    this.addRoute('GET', '/health', (req, res, { json }) => {
      const status = this.daemon?.getStatus() || {};
      json(200, {
        status: 'ok',
        uptime: status.uptime || 0,
        wireConnected: status.wireConnected || false,
        queueDepth: status.queue?.depth || 0,
        publicUrl: this.publicUrl,
      });
    });

    // Rich status (authenticated)
    this.addRoute('GET', '/api/status', (req, res, { json, requireApiKey }) => {
      if (!requireApiKey()) return;
      json(200, this.daemon?.getStatus() || {});
    });

    // Prompt endpoint (authenticated)
    this.addRoute('POST', '/api/prompt', async (req, res, { json, requireApiKey, body }) => {
      if (!requireApiKey()) return;
      if (!body?.content) {
        json(400, { error: 'content is required' });
        return;
      }

      const queue = this.daemon?.queue;
      if (!queue) {
        json(503, { error: 'Queue not available' });
        return;
      }

      queue.enqueue({
        source: body.source || 'api',
        senderId: body.sender || 'api',
        senderName: body.sender || 'api-client',
        content: body.content,
        priority: body.priority || 'normal',
        metadata: { via: 'http-api' },
      });

      json(202, { queued: true, queueDepth: queue.depth });
    });

    // GitHub webhook (validated with HMAC)
    this.addRoute('POST', '/webhook/github', async (req, res) => {
      // Read raw body for HMAC validation
      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) { reject(new Error('Too large')); req.destroy(); return; }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });

      // Validate HMAC signature
      if (this.githubWebhookSecret) {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
          this._json(res, 401, { error: 'Missing signature' });
          return;
        }
        const expected = 'sha256=' + createHmac('sha256', this.githubWebhookSecret)
          .update(rawBody).digest('hex');
        if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          this._json(res, 401, { error: 'Invalid signature' });
          return;
        }
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        this._json(res, 400, { error: 'Invalid JSON' });
        return;
      }

      const event = req.headers['x-github-event'];
      const queue = this.daemon?.queue;

      if (!queue) {
        this._json(res, 503, { error: 'Queue not available' });
        return;
      }

      const notification = this._parseGitHubEvent(event, payload);
      if (notification) {
        queue.enqueue({
          source: 'github',
          sender: 'github',
          senderName: 'github:webhook',
          content: notification,
          priority: 'low',
          metadata: { githubEvent: event, via: 'webhook' },
        });
        log.info(`GitHub webhook: ${event} — enqueued notification`);
        this._json(res, 200, { received: true, event });
      } else {
        // Event type not handled — acknowledge but don't enqueue
        log.debug(`GitHub webhook: ${event} — ignored`);
        this._json(res, 200, { received: true, event, ignored: true });
      }
    }, { raw: true });

    // Flow execution endpoint (authenticated)
    this.addRoute('POST', '/api/flow', async (req, res, { json, requireApiKey, body }) => {
      if (!requireApiKey()) return;
      if (!body?.name) {
        json(400, { error: 'name is required' });
        return;
      }

      const projectRoot = this.daemon?.projectRoot || process.cwd();
      const skill = loadFlowSkill(resolve(projectRoot, 'skills', body.name, 'SKILL.md'));
      if (!skill) {
        json(404, { error: `Flow "${body.name}" not found` });
        return;
      }

      const queue = this.daemon?.queue;
      if (!queue) {
        json(503, { error: 'Queue not available' });
        return;
      }

      queue.enqueue({
        source: 'flow',
        senderName: `api:flow:${body.name}`,
        content: `Executing flow: ${body.name}`,
        priority: body.priority || 'high',
        metadata: { flow: skill.flow, flowName: body.name },
      });

      json(202, { started: true, name: skill.name, description: skill.description });
    });
  }

  /**
   * Parse a GitHub webhook event into a notification string.
   * Returns null for events we don't want to enqueue.
   */
  _parseGitHubEvent(event, payload) {
    if (event === 'pull_request') {
      const pr = payload.pull_request;
      const action = payload.action;
      const title = pr?.title || 'unknown';
      const number = pr?.number || '?';
      const user = pr?.user?.login || 'unknown';

      if (action === 'closed' && pr?.merged) {
        return `[GitHub] PR #${number} merged: "${title}" by ${user}`;
      }
      if (action === 'closed') {
        return `[GitHub] PR #${number} closed without merge: "${title}" by ${user}`;
      }
      if (action === 'opened') {
        return `[GitHub] PR #${number} opened: "${title}" by ${user}`;
      }
      return null;
    }

    if (event === 'pull_request_review') {
      const pr = payload.pull_request;
      const review = payload.review;
      const number = pr?.number || '?';
      const title = pr?.title || 'unknown';
      const state = review?.state || 'unknown'; // approved, changes_requested, commented
      const reviewer = review?.user?.login || 'unknown';

      if (state === 'approved') {
        return `[GitHub] PR #${number} approved by ${reviewer}: "${title}"`;
      }
      if (state === 'changes_requested') {
        return `[GitHub] PR #${number} changes requested by ${reviewer}: "${title}"`;
      }
      return null;
    }

    if (event === 'issues') {
      const issue = payload.issue;
      const action = payload.action;
      const number = issue?.number || '?';
      const title = issue?.title || 'unknown';
      const user = issue?.user?.login || 'unknown';

      if (action === 'opened') {
        return `[GitHub] Issue #${number} opened: "${title}" by ${user}`;
      }
      return null;
    }

    // push, ping, etc. — don't enqueue
    return null;
  }

  _json(res, status, data) {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  _requireApiKey(req, res) {
    if (!this.apiKey) {
      this._json(res, 403, { error: 'API_KEY not configured' });
      return false;
    }
    const key = req.headers['x-api-key'];
    if (key !== this.apiKey) {
      this._json(res, 401, { error: 'Invalid API key' });
      return false;
    }
    return true;
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const maxSize = 1024 * 1024; // 1MB

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          // Return raw string if not JSON
          resolve(raw);
        }
      });

      req.on('error', reject);
    });
  }
}
