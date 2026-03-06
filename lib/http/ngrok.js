/**
 * ngrok Tunnel subsystem — optional public URL via ngrok.
 *
 * Uses @ngrok/ngrok SDK (dynamic import, not a hard dependency).
 * Provides a stable public HTTPS URL for webhooks and mobile app access.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger.js';

const log = createLogger('NGROK');

export class NgrokTunnel extends EventEmitter {
  constructor({ authtoken, domain, port }) {
    super();
    this.authtoken = authtoken;
    this.domain = domain || null;
    this.port = port;
    this.listener = null;
    this.url = null;
    this.running = false;
    this.reconnectTimer = null;
    this.reconnectBackoff = 1000;
  }

  async start() {
    if (!this.authtoken) {
      log.info('No NGROK_AUTHTOKEN set, skipping tunnel');
      return;
    }

    let ngrok;
    try {
      ngrok = await import('@ngrok/ngrok');
    } catch {
      log.warn('@ngrok/ngrok not installed — run: npm install @ngrok/ngrok');
      return;
    }

    try {
      const options = {
        addr: this.port,
        authtoken: this.authtoken,
      };
      if (this.domain) {
        options.domain = this.domain;
      }

      this.listener = await ngrok.forward(options);
      this.url = this.listener.url();
      this.running = true;
      this.reconnectBackoff = 1000;
      log.info(`Tunnel established: ${this.url}`);
      this.emit('connected', this.url);
    } catch (err) {
      log.error(`Failed to start tunnel: ${err.message}`);
      this.emit('error', err);
      this._scheduleReconnect();
    }
  }

  async stop() {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.listener) {
      try {
        await this.listener.close();
      } catch (err) {
        log.error(`Error closing listener: ${err.message}`);
      }
      this.listener = null;
      this.url = null;
    }

    // Kill the ngrok agent process
    try {
      const ngrok = await import('@ngrok/ngrok');
      await ngrok.kill();
    } catch {
      // Package not available or already stopped
    }

    log.info('Tunnel closed');
    this.emit('disconnected');
  }

  _scheduleReconnect() {
    if (!this.running) return;

    const delay = Math.min(this.reconnectBackoff, 30000);
    log.info(`Reconnecting in ${delay}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.running) return;

      try {
        const ngrok = await import('@ngrok/ngrok');
        const options = {
          addr: this.port,
          authtoken: this.authtoken,
        };
        if (this.domain) {
          options.domain = this.domain;
        }

        this.listener = await ngrok.forward(options);
        this.url = this.listener.url();
        this.reconnectBackoff = 1000;
        log.info(`Reconnected: ${this.url}`);
        this.emit('connected', this.url);
      } catch (err) {
        log.error(`Reconnect failed: ${err.message}`);
        this.reconnectBackoff = Math.min(this.reconnectBackoff * 2, 30000);
        this._scheduleReconnect();
      }
    }, delay);
  }
}
