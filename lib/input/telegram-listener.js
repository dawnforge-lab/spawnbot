/**
 * Telegram Listener — receives messages from Telegram, pushes to InputQueue.
 *
 * Handles multimodal input (all media saved to data/media/):
 *   - Photos: saved to disk, file path sent to LLM
 *   - Voice: transcribed via Whisper (if OPENAI_API_KEY set), also saved to disk
 *   - Documents: saved to disk, file path sent to LLM
 *   - Video: saved to disk, file path sent to LLM
 *
 * Supports two modes:
 *   - Polling (default): Grammy long-polling via bot.start()
 *   - Webhook: Grammy webhookCallback over HTTP server, with setWebhook on Telegram API
 */

import { Bot, webhookCallback } from 'grammy';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { downloadFile } from '../telegram/bot.js';
import { isWhisperEnabled, transcribeAudio } from '../telegram/transcribe.js';
import { createLogger } from '../logger.js';

const log = createLogger('TG-LISTEN');

export class TelegramListener extends EventEmitter {
  constructor({ queue, token, chatId, safeword, httpServer, webhookUrl, webhookSecret, projectRoot }) {
    super();
    this.queue = queue;
    this.token = token;
    this.allowedChatId = chatId;
    this.safeword = safeword || 'emergency-stop';
    this.httpServer = httpServer || null;
    this.webhookUrl = webhookUrl || null;
    this.webhookSecret = webhookSecret || null;
    this.projectRoot = projectRoot || process.cwd();
    this.bot = null;
    this.running = false;
    this.mode = null; // 'polling' or 'webhook'
  }

  /**
   * Start listening for Telegram messages.
   */
  async start() {
    if (this.running) return;
    if (!this.token) {
      log.error('TELEGRAM_BOT_TOKEN not set, skipping');
      return;
    }

    this.bot = new Bot(this.token);

    // Register message handlers (same for both modes)
    this.bot.on('message:text', (ctx) => this._handleMessage(ctx));
    this.bot.on('message:photo', (ctx) => this._handleMedia(ctx, 'photo'));
    this.bot.on('message:video', (ctx) => this._handleMedia(ctx, 'video'));
    this.bot.on('message:document', (ctx) => this._handleMedia(ctx, 'document'));
    this.bot.on('message:voice', (ctx) => this._handleMedia(ctx, 'voice'));

    this.bot.catch((err) => {
      log.error('Bot error:', err.message);
      this.emit('error', err);
    });

    this.running = true;

    // Choose mode
    if (this.webhookUrl && this.httpServer) {
      await this._startWebhookMode();
    } else {
      this._startPollingMode();
    }
  }

  /**
   * Stop listening.
   */
  async stop() {
    this.running = false;
    if (this.bot) {
      if (this.mode === 'polling') {
        this.bot.stop();
      }
      if (this.mode === 'webhook') {
        try {
          await this.bot.api.deleteWebhook();
        } catch (err) {
          log.error(`Error deleting webhook: ${err.message}`);
        }
      }
      this.bot = null;
    }
    this.mode = null;
    log.info('Stopped');
  }

  /**
   * Switch to polling mode (e.g. when ngrok disconnects).
   */
  async switchToPolling() {
    if (this.mode === 'polling') return;
    if (!this.bot || !this.running) return;

    log.info('Switching to polling mode');

    // Delete webhook from Telegram
    try {
      await this.bot.api.deleteWebhook();
    } catch (err) {
      log.error(`Error deleting webhook: ${err.message}`);
    }

    this._startPollingMode();
  }

  /**
   * Switch to webhook mode (e.g. when ngrok reconnects).
   */
  async switchToWebhook(webhookUrl) {
    if (this.mode === 'webhook' && this.webhookUrl === webhookUrl) return;
    if (!this.bot || !this.running) return;

    log.info(`Switching to webhook mode: ${webhookUrl}`);

    // Stop polling if active
    if (this.mode === 'polling') {
      this.bot.stop();
    }

    this.webhookUrl = webhookUrl;
    await this._startWebhookMode();
  }

  // ── Private ─────────────────────────────────────

  _startPollingMode() {
    this.mode = 'polling';
    this.bot.start({
      onStart: () => log.info('Started polling'),
    });
  }

  async _startWebhookMode() {
    this.mode = 'webhook';

    // Register webhook route on HTTP server
    const opts = {};
    if (this.webhookSecret) {
      opts.secretToken = this.webhookSecret;
    }
    const handler = webhookCallback(this.bot, 'http', opts);

    this.httpServer.addRoute('POST', '/webhook/telegram', (req, res) => {
      handler(req, res);
    }, { raw: true });

    // Register webhook with Telegram API
    try {
      const webhookOpts = {};
      if (this.webhookSecret) {
        webhookOpts.secret_token = this.webhookSecret;
      }
      await this.bot.api.setWebhook(this.webhookUrl, webhookOpts);
      log.info(`Webhook registered: ${this.webhookUrl}`);
    } catch (err) {
      log.error(`Failed to register webhook: ${err.message}`);
      log.info('Falling back to polling');
      this._startPollingMode();
    }
  }

  /**
   * Handle incoming text message.
   */
  _handleMessage(ctx) {
    const chatId = String(ctx.chat.id);

    // Only accept from configured chat
    if (this.allowedChatId && chatId !== this.allowedChatId) {
      log.info(`Ignoring message from unauthorized chat: ${chatId}`);
      return;
    }

    const text = ctx.message.text || '';
    const sender = ctx.from;

    // Check for safeword
    if (text.toLowerCase().includes(this.safeword.toLowerCase())) {
      log.info('SAFEWORD DETECTED');
      this.emit('safeword', { sender, text });
      return;
    }

    // Check for commands
    if (text.startsWith('/')) {
      this._handleCommand(ctx, text);
      return;
    }

    // Push to input queue
    this.queue.enqueue({
      source: 'telegram',
      senderId: String(sender.id),
      senderName: sender.first_name || sender.username || 'unknown',
      content: text,
      priority: 'high', // Direct messages are high priority
      metadata: {
        chatId,
        messageId: ctx.message.message_id,
        replyToMessageId: ctx.message.reply_to_message?.message_id,
      },
    });

    this.emit('message', { chatId, text, sender });
  }

  /**
   * Handle incoming media (photo, video, document, voice).
   * Downloads actual media and processes it for LLM consumption.
   */
  async _handleMedia(ctx, type) {
    const chatId = String(ctx.chat.id);

    if (this.allowedChatId && chatId !== this.allowedChatId) return;

    const sender = ctx.from;
    const caption = ctx.message.caption || '';

    // Get file_id for the media type
    let fileId = null;
    if (type === 'photo') {
      const photos = ctx.message.photo;
      fileId = photos[photos.length - 1]?.file_id;
    } else if (type === 'video') {
      fileId = ctx.message.video?.file_id;
    } else if (type === 'document') {
      fileId = ctx.message.document?.file_id;
    } else if (type === 'voice') {
      fileId = ctx.message.voice?.file_id;
    }

    if (!fileId) return;

    let textContent = caption;

    try {
      // Download with retry
      const { buffer, filename } = await this._downloadWithRetry(fileId);

      // Save all media to data/media/
      const mediaDir = resolve(this.projectRoot, 'data', 'media');
      if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

      const savedFilename = `${Date.now()}_${filename}`;
      const savedPath = resolve(mediaDir, savedFilename);
      writeFileSync(savedPath, buffer);
      const sizeKB = Math.round(buffer.length / 1024);

      if (type === 'photo') {
        textContent = `[image: ${savedPath}] (image/jpeg, ${sizeKB}KB) ${caption}`.trim();

      } else if (type === 'voice') {
        // Voice → transcribe via Whisper or describe
        if (isWhisperEnabled()) {
          const transcription = await transcribeAudio(buffer, filename);
          textContent = transcription + (caption ? `\n${caption}` : '');
        } else {
          const duration = ctx.message.voice?.duration || '?';
          textContent = `[voice message: ${savedPath}] (${duration}s, ${sizeKB}KB — transcription unavailable, OPENAI_API_KEY not set) ${caption}`.trim();
        }

      } else if (type === 'document') {
        const mimeType = ctx.message.document?.mime_type || 'application/octet-stream';
        textContent = `[document: ${savedPath}] (${mimeType}, ${sizeKB}KB) ${caption}`.trim();

      } else if (type === 'video') {
        const mimeType = ctx.message.video?.mime_type || 'video/mp4';
        const duration = ctx.message.video?.duration || '?';
        textContent = `[video: ${savedPath}] (${mimeType}, ${duration}s, ${sizeKB}KB) ${caption}`.trim();
      }

    } catch (err) {
      // Report error to user — no silent fallback
      log.error(`Failed to process ${type}: ${err.message}`);
      this.emit('media_error', { chatId, type, error: err });

      const { sendMessage } = await import('../telegram/bot.js');
      sendMessage(this.token, chatId, `Failed to process your ${type}: ${err.message}. Please try again.`).catch(() => {});
      return;
    }

    this.queue.enqueue({
      source: 'telegram',
      senderId: String(sender.id),
      senderName: sender.first_name || sender.username || 'unknown',
      content: textContent || `[${type}]`,
      priority: 'high',
      metadata: {
        chatId,
        messageId: ctx.message.message_id,
        mediaType: type,
        fileId,
      },
    });

    this.emit('media', { chatId, type, fileId, caption, sender });
  }

  /**
   * Download a file from Telegram with one retry on failure.
   */
  async _downloadWithRetry(fileId) {
    try {
      return await downloadFile(this.token, fileId);
    } catch (firstErr) {
      log.warn(`Download failed, retrying in 2s: ${firstErr.message}`);
      await new Promise(r => setTimeout(r, 2000));
      return await downloadFile(this.token, fileId);
    }
  }

  /**
   * Handle slash commands.
   */
  async _handleCommand(ctx, text) {
    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/status':
        this.emit('command_status', ctx);
        break;

      case '/tasks':
        this.emit('command_tasks', ctx);
        break;

      case '/safeword':
        log.info('SAFEWORD via /safeword command');
        this.emit('safeword', { sender: ctx.from, text: '/safeword' });
        break;

      default:
        // Treat unknown commands as regular messages
        this.queue.enqueue({
          source: 'telegram',
          senderId: String(ctx.from.id),
          senderName: ctx.from.first_name || 'unknown',
          content: text,
          priority: 'normal',
          metadata: {
            chatId: String(ctx.chat.id),
            messageId: ctx.message.message_id,
          },
        });
        break;
    }
  }
}
