/**
 * Step 4: Credentials — collect API tokens for Telegram and integrations.
 */

import { confirm, input, password } from '@inquirer/prompts';
import { section, c, spinner } from '../util.js';

const TG_API = 'https://api.telegram.org/bot';

/**
 * Poll Telegram getUpdates until a message arrives.
 * Returns the chat ID from the first message received.
 */
async function detectChatId(botToken, timeoutMs = 120000) {
  const startedAt = Date.now();

  // Delete any existing webhook — getUpdates won't work while a webhook is set
  await fetch(`${TG_API}${botToken}/deleteWebhook`);

  // Clear any old updates first
  const clearUrl = `${TG_API}${botToken}/getUpdates?offset=-1`;
  const clearRes = await fetch(clearUrl);
  const clearData = await clearRes.json();
  const lastUpdateId = clearData.result?.[0]?.update_id;
  let offset = lastUpdateId ? lastUpdateId + 1 : 0;

  while (Date.now() - startedAt < timeoutMs) {
    const url = `${TG_API}${botToken}/getUpdates?offset=${offset}&timeout=5`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.ok && data.result?.length > 0) {
      for (const update of data.result) {
        // Advance offset past this update regardless of type
        offset = update.update_id + 1;
        const chat = update.message?.chat || update.my_chat_member?.chat;
        if (chat) {
          return { chatId: String(chat.id), chatTitle: chat.title || chat.first_name || '' };
        }
      }
    }
  }

  return null;
}

/**
 * Verify a bot token by calling getMe.
 */
async function verifyBotToken(botToken) {
  try {
    const res = await fetch(`${TG_API}${botToken}/getMe`);
    const data = await res.json();
    if (data.ok) {
      return data.result; // { id, is_bot, first_name, username }
    }
  } catch {
    // Network error
  }
  return null;
}

export async function collectCredentials() {
  section('API Credentials');

  const credentials = {
    telegram: { enabled: false, botToken: '', chatId: '' },
    integrations: {},
  };

  // Telegram
  const setupTelegram = await confirm({
    message: 'Set up Telegram?',
    default: true,
  });

  if (setupTelegram) {
    console.log();
    console.log(c.dim('  To create a Telegram bot:'));
    console.log(c.dim('  1. Message @BotFather on Telegram'));
    console.log(c.dim('  2. Send /newbot and follow the prompts'));
    console.log(c.dim('  3. Copy the bot token'));
    console.log();

    const botToken = await password({
      message: 'Bot token:',
      mask: '*',
    });

    if (!botToken) {
      console.log(c.warn('  No bot token provided — skipping Telegram.'));
    } else {
      // Verify token — allow retries on failure
      let verifiedToken = botToken;
      let botInfo = null;

      while (!botInfo) {
        const s = spinner('Verifying bot token...');
        s.start();
        botInfo = await verifyBotToken(verifiedToken);
        s.stop();

        if (botInfo) break;

        console.log(c.error('  Invalid bot token — could not connect to Telegram API.'));
        const retry = await confirm({ message: 'Try again?', default: true });
        if (!retry) {
          console.log(c.dim('  You can set TELEGRAM_BOT_TOKEN in .env later.'));
          break;
        }

        verifiedToken = await password({ message: 'Bot token:', mask: '*' });
        if (!verifiedToken) break;
      }

      if (botInfo) {
        console.log(c.success(`  Bot verified: @${botInfo.username}`));
        console.log();

        // Auto-detect chat ID
        console.log(c.bold('  Now send any message to @' + botInfo.username + ' on Telegram.'));
        console.log(c.dim('  (Or add it to a group and send a message there)'));
        console.log();

        const s2 = spinner('Waiting for a message... (2 min timeout)');
        s2.start();
        const result = await detectChatId(verifiedToken);
        s2.stop();

        if (result) {
          const label = result.chatTitle ? ` (${result.chatTitle})` : '';
          console.log(c.success(`  Chat ID detected: ${result.chatId}${label}`));
          credentials.telegram = { enabled: true, botToken: verifiedToken, chatId: result.chatId };
        } else {
          console.log(c.warn('  No message received — timed out.'));
          console.log(c.dim('  You can set TELEGRAM_CHAT_ID manually in .env'));

          const manualChatId = await input({
            message: 'Chat ID (or leave empty to skip):',
          });

          if (manualChatId) {
            credentials.telegram = { enabled: true, botToken: verifiedToken, chatId: manualChatId };
            console.log(c.success('  Telegram configured.'));
          } else {
            credentials.telegram = { enabled: false, botToken: verifiedToken, chatId: '' };
            console.log(c.warn('  Telegram partially configured — set TELEGRAM_CHAT_ID in .env later.'));
          }
        }
      }
    }
  }

  // ngrok tunnel (optional)
  console.log();
  const setupNgrok = await confirm({
    message: 'Set up ngrok tunnel? (enables webhooks + mobile app access)',
    default: false,
  });

  if (setupNgrok) {
    console.log();
    console.log(c.dim('  ngrok provides a public HTTPS URL for your local daemon.'));
    console.log(c.dim('  1. Sign up at https://ngrok.com (free tier works)'));
    console.log(c.dim('  2. Copy your authtoken from the ngrok dashboard'));
    console.log();

    const ngrokAuthtoken = await password({
      message: 'ngrok authtoken:',
      mask: '*',
    });

    if (ngrokAuthtoken) {
      credentials.ngrok = { authtoken: ngrokAuthtoken };

      console.log();
      console.log(c.dim('  For a stable URL, claim a free static domain at:'));
      console.log(c.dim('  https://dashboard.ngrok.com/domains'));
      console.log();

      const ngrokDomain = await input({
        message: 'Static domain (e.g. your-name.ngrok-free.app, or leave empty):',
      });

      if (ngrokDomain) {
        credentials.ngrok.domain = ngrokDomain;
      }

      console.log(c.success('  ngrok configured.'));
    }
  }

  // OpenAI API key (optional — for voice transcription via Whisper)
  console.log();
  const setupOpenAI = await confirm({
    message: 'Set up OpenAI API key? (enables voice message transcription)',
    default: false,
  });

  if (setupOpenAI) {
    console.log();
    console.log(c.dim('  An OpenAI API key enables Whisper voice transcription.'));
    console.log(c.dim('  Without it, voice messages are described but not transcribed.'));
    console.log(c.dim('  Get a key at https://platform.openai.com/api-keys'));
    console.log();

    const openaiKey = await password({
      message: 'OpenAI API key:',
      mask: '*',
    });

    if (openaiKey) {
      credentials.openai = { apiKey: openaiKey };
      console.log(c.success('  OpenAI configured — voice transcription enabled.'));
    }
  }

  console.log();
  return credentials;
}
