import { existsSync } from 'fs';
import { McpServer } from '../base-server.js';
import { defineTool } from '../tool.js';
import {
  sendMessage,
  reactToMessage,
  getBot,
  markdownToTelegramHtml,
} from './bot.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const defaultChatId = process.env.TELEGRAM_CHAT_ID;

const server = new McpServer({ name: 'spawnbot-telegram' });

server.addTools([
  defineTool({
    name: 'tg_send',
    description: 'Send a proactive message to a Telegram chat. NOTE: Responses to incoming Telegram messages are sent automatically by the daemon — only use this for proactive messages (from cron, autonomy, etc.) or messages to a different chat. Supports markdown formatting auto-converted to Telegram HTML. Messages over 4096 chars are auto-split.',
    inputSchema: {
      properties: {
        message: { type: 'string', description: 'Message text (markdown supported)' },
        chat_id: { type: 'string', description: 'Chat ID (defaults to primary chat)' },
        disable_preview: { type: 'boolean', description: 'Disable link previews' },
      },
      required: ['message'],
    },
    async handler({ message, chat_id, disable_preview }) {
      const chatId = chat_id || defaultChatId;
      if (!chatId) throw new Error('No chat_id provided and TELEGRAM_CHAT_ID not set');
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

      const result = await sendMessage(token, chatId, message, {
        disablePreview: disable_preview,
      });
      return { message_id: result.message_id, chat_id: chatId };
    },
  }),

  defineTool({
    name: 'tg_photo',
    description: 'Send a photo to a Telegram chat. Use for sending images from tool results (e.g. AI-generated images), screenshots, or any visual content.',
    inputSchema: {
      properties: {
        photo: { type: 'string', description: 'URL or local file path of the photo' },
        caption: { type: 'string', description: 'Photo caption (markdown supported)' },
        chat_id: { type: 'string', description: 'Chat ID (defaults to primary chat)' },
      },
      required: ['photo'],
    },
    async handler({ photo, caption, chat_id }) {
      const chatId = chat_id || defaultChatId;
      if (!chatId) throw new Error('No chat_id provided and TELEGRAM_CHAT_ID not set');
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

      const bot = getBot(token);
      const captionHtml = caption ? markdownToTelegramHtml(caption) : undefined;
      const result = await bot.api.sendPhoto(chatId, photo, {
        caption: captionHtml,
        parse_mode: captionHtml ? 'HTML' : undefined,
      });
      return { message_id: result.message_id, chat_id: chatId };
    },
  }),

  defineTool({
    name: 'tg_voice',
    description: 'Send a voice/audio message to a Telegram chat. Use for TTS output from Cartesia or other speech providers. OGG files are sent as voice bubbles (playable inline), other formats as audio files.',
    inputSchema: {
      properties: {
        audio: { type: 'string', description: 'Local file path or URL of the audio file' },
        caption: { type: 'string', description: 'Optional caption' },
        chat_id: { type: 'string', description: 'Chat ID (defaults to primary chat)' },
      },
      required: ['audio'],
    },
    async handler({ audio, caption, chat_id }) {
      const chatId = chat_id || defaultChatId;
      if (!chatId) throw new Error('No chat_id provided and TELEGRAM_CHAT_ID not set');
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

      const bot = getBot(token);
      const isOgg = audio.endsWith('.ogg') || audio.endsWith('.oga');

      let result;
      if (isOgg) {
        // Send as voice bubble (playable inline in Telegram)
        result = await bot.api.sendVoice(chatId, audio, {
          caption: caption || undefined,
        });
      } else {
        // Send as audio file with metadata
        result = await bot.api.sendAudio(chatId, audio, {
          caption: caption || undefined,
        });
      }
      return { message_id: result.message_id, chat_id: chatId };
    },
  }),

  defineTool({
    name: 'tg_document',
    description: 'Send a file/document to a Telegram chat. Use for sending any file type — PDFs, spreadsheets, code files, archives, etc.',
    inputSchema: {
      properties: {
        document: { type: 'string', description: 'Local file path or URL of the document' },
        caption: { type: 'string', description: 'Optional caption (markdown supported)' },
        chat_id: { type: 'string', description: 'Chat ID (defaults to primary chat)' },
      },
      required: ['document'],
    },
    async handler({ document, caption, chat_id }) {
      const chatId = chat_id || defaultChatId;
      if (!chatId) throw new Error('No chat_id provided and TELEGRAM_CHAT_ID not set');
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

      const bot = getBot(token);
      const captionHtml = caption ? markdownToTelegramHtml(caption) : undefined;
      const result = await bot.api.sendDocument(chatId, document, {
        caption: captionHtml,
        parse_mode: captionHtml ? 'HTML' : undefined,
      });
      return { message_id: result.message_id, chat_id: chatId };
    },
  }),

  defineTool({
    name: 'tg_react',
    description: 'React to a message with an emoji.',
    inputSchema: {
      properties: {
        message_id: { type: 'number', description: 'Message ID to react to' },
        emoji: { type: 'string', description: 'Emoji to react with (default: 👍)' },
        chat_id: { type: 'string', description: 'Chat ID (defaults to primary chat)' },
      },
      required: ['message_id'],
    },
    async handler({ message_id, emoji, chat_id }) {
      const chatId = chat_id || defaultChatId;
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

      await reactToMessage(token, chatId, message_id, emoji || '👍');
      return { reacted: true, emoji: emoji || '👍' };
    },
  }),
]);

server.start();
