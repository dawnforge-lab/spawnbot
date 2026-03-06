/**
 * Re-export from shared location.
 * The canonical bot utilities live in lib/telegram/bot.js — this shim
 * maintains backwards compatibility for the MCP server process.
 */
export {
  getBot,
  setWebhook,
  sendMessage,
  smartSplit,
  escapeHtml,
  markdownToTelegramHtml,
  formatJobNotification,
  downloadFile,
  reactToMessage,
  startTypingIndicator,
} from '../../telegram/bot.js';
