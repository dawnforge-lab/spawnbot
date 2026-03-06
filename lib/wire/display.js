/**
 * Wire display — attaches to a WireClient and renders events to the terminal.
 *
 * Shows thinking indicators, tool calls, tool results, and streamed content
 * so the user sees what the agent is doing in real-time.
 */

import chalk from 'chalk';

const dim = chalk.dim;
const cyan = chalk.cyan;
const yellow = chalk.yellow;
const green = chalk.green;
const red = chalk.red;

const LINE_WIDTH = 50;

/**
 * Print a turn header line with source and sender.
 */
export function printTurnHeader(source, senderName) {
  const label = senderName ? `${source}/${senderName}` : source;
  const pad = Math.max(0, LINE_WIDTH - label.length - 4);
  process.stderr.write('\n' + dim('── ') + cyan(label) + dim(' ' + '─'.repeat(pad)) + '\n');
}

/**
 * Print a turn footer with duration.
 */
export function printTurnFooter(durationMs) {
  if (durationMs == null) return;
  const secs = (durationMs / 1000).toFixed(1);
  const label = `completed in ${secs}s`;
  const pad = Math.max(0, LINE_WIDTH - label.length - 4);
  process.stderr.write(dim('── ' + label + ' ' + '─'.repeat(pad)) + '\n');
}

/**
 * Format tool call arguments as a compact string.
 */
function formatArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const parts = entries.slice(0, 3).map(([k, v]) => {
    let val = typeof v === 'string'
      ? `"${v.length > 30 ? v.slice(0, 30) + '…' : v}"`
      : JSON.stringify(v);
    if (val && val.length > 40) val = val.slice(0, 40) + '…';
    return `${k}: ${val}`;
  });
  if (entries.length > 3) parts.push('…');
  return `(${parts.join(', ')})`;
}

/**
 * Attach interactive display listeners to a WireClient.
 * Returns a detach function to remove all listeners.
 *
 * Options:
 *   showContent  — write streamed text to stdout (default true)
 *   onContent    — callback for each content chunk (receives { text })
 *   showThinking — show thinking indicator (default true)
 *   showTools    — show tool call/result lines (default true)
 */
export function attachDisplay(wire, opts = {}) {
  const {
    showContent = true,
    onContent = null,
    showThinking = true,
    showTools = true,
  } = opts;

  let thinkingActive = false;
  let contentStarted = false;
  const listeners = [];

  function on(event, fn) {
    wire.on(event, fn);
    listeners.push([event, fn]);
  }

  function clearThinking() {
    if (thinkingActive) {
      process.stderr.write('\r' + ' '.repeat(30) + '\r');
      thinkingActive = false;
    }
  }

  // --- Thinking ---
  if (showThinking) {
    on('think', ({ text }) => {
      if (!thinkingActive && text) {
        process.stderr.write(dim('  ⟡ thinking...'));
        thinkingActive = true;
      }
    });
  }

  // --- Content ---
  on('content', ({ text }) => {
    clearThinking();
    if (!contentStarted) {
      contentStarted = true;
    }
    if (showContent) {
      process.stdout.write(text);
    }
    if (onContent) {
      onContent({ text });
    }
  });

  // --- Tool calls (from events — internal Kimi tool use) ---
  if (showTools) {
    on('tool_call_event', (payload) => {
      clearThinking();
      // End content line if we were streaming text
      if (contentStarted) {
        process.stdout.write('\n');
        contentStarted = false;
      }
      const name = payload.name || payload.tool_name || '?';
      const args = payload.arguments || payload.args;
      process.stderr.write(dim(`  ↳ ${name}${formatArgs(args)}`) + '\n');
    });

    on('tool_result_event', (payload) => {
      const error = payload.is_error || payload.error;
      const name = payload.name || payload.tool_name || '';
      if (error) {
        const msg = typeof payload.error === 'string' ? payload.error : '';
        process.stderr.write(red(`  ↳ ✗ ${name}${msg ? ': ' + msg.slice(0, 80) : ''}`) + '\n');
      } else if (name) {
        process.stderr.write(dim(`  ↳ `) + green('✓') + dim(` ${name}`) + '\n');
      }
    });

    // Tool calls that go through the request handler (external MCP tools)
    on('tool_call', ({ name, args }) => {
      clearThinking();
      if (contentStarted) {
        process.stdout.write('\n');
        contentStarted = false;
      }
      process.stderr.write(dim(`  ↳ ${name}${formatArgs(args)}`) + '\n');
    });

    on('tool_result', ({ name, error }) => {
      if (error) {
        const msg = typeof error === 'string' ? error : (error?.message || '');
        process.stderr.write(red(`  ↳ ✗ ${name}${msg ? ': ' + msg.slice(0, 80) : ''}`) + '\n');
      } else if (name) {
        process.stderr.write(dim(`  ↳ `) + green('✓') + dim(` ${name}`) + '\n');
      }
    });
  }

  // --- Turn lifecycle ---
  on('turn_begin', () => {
    contentStarted = false;
  });

  on('turn_end', () => {
    clearThinking();
    if (contentStarted) {
      process.stdout.write('\n');
      contentStarted = false;
    }
  });

  // --- Status updates ---
  on('status_update', (payload) => {
    const msg = payload.message || payload.status || '';
    if (msg) {
      process.stderr.write(dim(`  ${msg}`) + '\n');
    }
  });

  // Return detach function
  return function detach() {
    for (const [event, fn] of listeners) {
      wire.removeListener(event, fn);
    }
    clearThinking();
  };
}
