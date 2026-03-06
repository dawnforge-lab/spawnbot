# Google Email & Calendar (IMAP/SMTP + CalDAV)

How to create an MCP server for Gmail and Google Calendar using direct protocols — no Google Cloud Console, no OAuth, no payment.

## Overview

Access Gmail via IMAP (read) and SMTP (send), and Google Calendar via CalDAV (HTTP). Authenticated with a Google App Password — permanent credentials that never expire. No external npm packages needed.

## Environment Variables

```
GOOGLE_EMAIL        — Gmail address (e.g. user@gmail.com)
GOOGLE_APP_PASSWORD — 16-character App Password (from Google account settings)
```

Register when creating the server:
```
tool_create({
  name: "google-email",
  code: "<full source>",
  env: {
    GOOGLE_EMAIL: "${GOOGLE_EMAIL}",
    GOOGLE_APP_PASSWORD: "${GOOGLE_APP_PASSWORD}"
  }
})
```

## Setup (One-Time for User)

1. **Enable 2FA** on the Google Account: https://myaccount.google.com/security
2. **Generate App Password**: https://myaccount.google.com/apppasswords → Select "Mail" → Copy the 16-character password
3. **Enable IMAP** in Gmail: Settings → Forwarding and POP/IMAP → Enable IMAP
4. Set `GOOGLE_EMAIL` and `GOOGLE_APP_PASSWORD` in `.env`

## Protocol Reference

| Service | Protocol | Server | Port |
|---------|----------|--------|------|
| Gmail Read | IMAP SSL | imap.gmail.com | 993 |
| Gmail Send | SMTP STARTTLS | smtp.gmail.com | 587 |
| Calendar | CalDAV (HTTPS) | apidata.googleusercontent.com | 443 |

## IMAP Helper (Read Emails)

Uses Node.js `tls` module for direct IMAP over SSL.

```js
import * as tls from 'tls';

const EMAIL = process.env.GOOGLE_EMAIL;
const PASSWORD = process.env.GOOGLE_APP_PASSWORD;

function imapCommand(socket, tag, command) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data) => {
      buffer += data.toString();
      // Check for tagged response (completion)
      const lines = buffer.split('\r\n');
      for (const line of lines) {
        if (line.startsWith(`${tag} OK`) || line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
          socket.removeListener('data', onData);
          if (line.startsWith(`${tag} OK`)) {
            resolve(buffer);
          } else {
            reject(new Error(line));
          }
          return;
        }
      }
    };
    socket.on('data', onData);
    socket.write(`${tag} ${command}\r\n`);
  });
}

function connectImap() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(993, 'imap.gmail.com', { servername: 'imap.gmail.com' });
    let greeted = false;
    socket.on('data', (data) => {
      if (!greeted && data.toString().startsWith('* OK')) {
        greeted = true;
        resolve(socket);
      }
    });
    socket.on('error', reject);
  });
}

async function imapSession(fn) {
  const socket = await connectImap();
  let tagNum = 1;
  const tag = () => `A${String(tagNum++).padStart(3, '0')}`;

  try {
    // Login
    await imapCommand(socket, tag(), `LOGIN "${EMAIL}" "${PASSWORD}"`);
    // Run caller's function
    return await fn(socket, tag, imapCommand);
  } finally {
    try {
      await imapCommand(socket, tag(), 'LOGOUT');
    } catch {}
    socket.destroy();
  }
}
```

### Get Inbox Emails

```js
async function getInbox({ count = 10, unreadOnly = false } = {}) {
  return imapSession(async (socket, tag, cmd) => {
    // Select INBOX
    const selectRes = await cmd(socket, tag(), 'SELECT INBOX');
    const existsMatch = selectRes.match(/\* (\d+) EXISTS/);
    const total = existsMatch ? parseInt(existsMatch[1]) : 0;
    if (total === 0) return [];

    // Search
    const searchCriteria = unreadOnly ? 'UNSEEN' : 'ALL';
    const searchRes = await cmd(socket, tag(), `SEARCH ${searchCriteria}`);
    const searchLine = searchRes.split('\r\n').find(l => l.startsWith('* SEARCH'));
    if (!searchLine) return [];

    const uids = searchLine.replace('* SEARCH ', '').trim().split(' ').filter(Boolean);
    const latest = uids.slice(-count).reverse();
    if (latest.length === 0) return [];

    // Fetch headers
    const fetchRes = await cmd(socket, tag(),
      `FETCH ${latest.join(',')} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`
    );

    return parseFetchHeaders(fetchRes, latest);
  });
}

function parseFetchHeaders(response, uids) {
  const emails = [];
  const blocks = response.split(/\* \d+ FETCH/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const from = (block.match(/From:\s*(.+)/i) || [])[1]?.trim() || '';
    const subject = (block.match(/Subject:\s*(.+)/i) || [])[1]?.trim() || '';
    const date = (block.match(/Date:\s*(.+)/i) || [])[1]?.trim() || '';
    const seen = block.includes('\\Seen');
    const uidMatch = block.match(/UID (\d+)/);
    emails.push({
      uid: uidMatch ? uidMatch[1] : uids[emails.length],
      from, subject, date, read: seen,
    });
  }
  return emails;
}
```

### Read Full Email

```js
async function readEmail(uid) {
  return imapSession(async (socket, tag, cmd) => {
    await cmd(socket, tag(), 'SELECT INBOX');
    const res = await cmd(socket, tag(), `FETCH ${uid} (BODY[])`);

    // Parse MIME — extract plain text body
    const bodyStart = res.indexOf('\r\n\r\n');
    const bodyEnd = res.lastIndexOf(`\r\nA`);
    const rawBody = res.slice(bodyStart + 4, bodyEnd > bodyStart ? bodyEnd : undefined);

    // Extract headers
    const from = (res.match(/From:\s*(.+)/i) || [])[1]?.trim() || '';
    const to = (res.match(/To:\s*(.+)/i) || [])[1]?.trim() || '';
    const subject = (res.match(/Subject:\s*(.+)/i) || [])[1]?.trim() || '';
    const date = (res.match(/Date:\s*(.+)/i) || [])[1]?.trim() || '';
    const messageId = (res.match(/Message-ID:\s*(.+)/i) || [])[1]?.trim() || '';

    // Basic MIME text extraction
    let body = rawBody;
    if (res.includes('Content-Transfer-Encoding: base64')) {
      body = Buffer.from(rawBody.replace(/\s/g, ''), 'base64').toString('utf8');
    } else if (res.includes('Content-Transfer-Encoding: quoted-printable')) {
      body = rawBody.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }

    return { uid, from, to, subject, date, messageId, body: body.trim().slice(0, 5000) };
  });
}
```

### Search Emails

```js
async function searchEmails(criteria) {
  return imapSession(async (socket, tag, cmd) => {
    await cmd(socket, tag(), 'SELECT INBOX');

    // IMAP search syntax:
    //   FROM "alice@example.com"
    //   SUBJECT "meeting"
    //   UNSEEN SINCE "01-Mar-2026"
    //   TO "bob@example.com" SINCE "01-Jan-2026"
    const searchRes = await cmd(socket, tag(), `SEARCH ${criteria}`);
    const searchLine = searchRes.split('\r\n').find(l => l.startsWith('* SEARCH'));
    if (!searchLine) return [];

    const uids = searchLine.replace('* SEARCH ', '').trim().split(' ').filter(Boolean);
    const latest = uids.slice(-20).reverse();
    if (latest.length === 0) return [];

    const fetchRes = await cmd(socket, tag(),
      `FETCH ${latest.join(',')} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`
    );
    return parseFetchHeaders(fetchRes, latest);
  });
}
```

### Mark Read/Unread

```js
async function markRead(uid) {
  return imapSession(async (socket, tag, cmd) => {
    await cmd(socket, tag(), 'SELECT INBOX');
    await cmd(socket, tag(), `STORE ${uid} +FLAGS (\\Seen)`);
    return { success: true };
  });
}

async function markUnread(uid) {
  return imapSession(async (socket, tag, cmd) => {
    await cmd(socket, tag(), 'SELECT INBOX');
    await cmd(socket, tag(), `STORE ${uid} -FLAGS (\\Seen)`);
    return { success: true };
  });
}
```

### Get Unread Count

```js
async function getUnreadCount() {
  return imapSession(async (socket, tag, cmd) => {
    const res = await cmd(socket, tag(), 'STATUS INBOX (UNSEEN)');
    const match = res.match(/UNSEEN (\d+)/);
    return { unread: match ? parseInt(match[1]) : 0 };
  });
}
```

## SMTP Helper (Send Emails)

Uses Node.js `net` and `tls` modules for SMTP with STARTTLS.

```js
import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';

async function smtpSend({ to, subject, body, cc, bcc, html = false, inReplyTo, references }) {
  return new Promise((resolve, reject) => {
    let socket = net.createConnection(587, 'smtp.gmail.com');
    let buffer = '';
    let step = 0;
    let upgraded = false;

    const messageId = `<${crypto.randomUUID()}@gmail.com>`;

    // Build email
    const headers = [
      `From: ${EMAIL}`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
      references ? `References: ${references}` : null,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
      'Content-Transfer-Encoding: 7bit',
    ].filter(Boolean).join('\r\n');

    const allRecipients = [to, cc, bcc].filter(Boolean);
    const message = `${headers}\r\n\r\n${body}\r\n.\r\n`;

    function processLine(line) {
      const code = parseInt(line.slice(0, 3));
      switch (step) {
        case 0: // Greeting
          if (code === 220) { socket.write('EHLO localhost\r\n'); step++; }
          break;
        case 1: // EHLO response
          if (line.startsWith('250 ') || (code === 250 && !line.startsWith('250-'))) {
            if (!upgraded) {
              socket.write('STARTTLS\r\n'); step = 2;
            } else {
              // After TLS EHLO, authenticate
              const creds = Buffer.from(`\0${EMAIL}\0${PASSWORD}`).toString('base64');
              socket.write(`AUTH PLAIN ${creds}\r\n`); step = 4;
            }
          }
          break;
        case 2: // STARTTLS response
          if (code === 220) {
            const tlsSocket = tls.connect({ socket, servername: 'smtp.gmail.com' }, () => {
              socket = tlsSocket;
              upgraded = true;
              socket.on('data', onData);
              socket.write('EHLO localhost\r\n');
              step = 1;
            });
            tlsSocket.on('error', reject);
          }
          break;
        case 4: // AUTH response
          if (code === 235) { socket.write(`MAIL FROM:<${EMAIL}>\r\n`); step++; }
          else reject(new Error(`Auth failed: ${line}`));
          break;
        case 5: // MAIL FROM response
          if (code === 250) { socket.write(`RCPT TO:<${allRecipients[0]}>\r\n`); step++; }
          break;
        case 6: // RCPT TO response(s)
          if (code === 250) { socket.write('DATA\r\n'); step++; }
          break;
        case 7: // DATA response
          if (code === 354) { socket.write(message); step++; }
          break;
        case 8: // Message accepted
          if (code === 250) {
            socket.write('QUIT\r\n');
            resolve({ success: true, messageId });
          }
          break;
      }
    }

    function onData(data) {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) processLine(line);
      }
    }

    socket.on('data', onData);
    socket.on('error', reject);
  });
}
```

### Reply to Email

```js
async function replyToEmail(uid, replyBody, replyAll = false) {
  // First read the original email to get headers
  const original = await readEmail(uid);

  const subject = original.subject.startsWith('Re:')
    ? original.subject
    : `Re: ${original.subject}`;

  const references = original.messageId;

  const result = await smtpSend({
    to: replyAll ? [original.from, original.to].filter(Boolean).join(', ') : original.from,
    subject,
    body: `${replyBody}\n\nOn ${original.date}, ${original.from} wrote:\n> ${original.body.split('\n').join('\n> ')}`,
    inReplyTo: original.messageId,
    references,
  });

  return result;
}
```

## CalDAV Helper (Google Calendar)

CalDAV is HTTP-based. Uses `fetch` with Basic auth.

```js
const CALDAV_BASE = 'https://apidata.googleusercontent.com/caldav/v2';
const CALDAV_AUTH = Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64');

async function caldavRequest(method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${CALDAV_AUTH}`,
      ...extraHeaders,
    },
  };
  if (body) {
    opts.body = body;
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/xml; charset=utf-8';
  }
  const res = await fetch(`${CALDAV_BASE}${path}`, opts);
  if (!res.ok && res.status !== 207) {
    throw new Error(`CalDAV ${res.status}: ${await res.text()}`);
  }
  return res.text();
}
```

### List Calendars

```js
async function listCalendars() {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`;

  const res = await caldavRequest('PROPFIND', `/${encodeURIComponent(EMAIL)}/`, body, {
    'Depth': '1',
  });

  // Parse XML responses for calendar names
  const calendars = [];
  const matches = res.matchAll(/<d:href>([^<]+)<\/d:href>[\s\S]*?<d:displayname>([^<]*)<\/d:displayname>/g);
  for (const m of matches) {
    if (m[1].includes('/events/') || m[1].endsWith('/events')) {
      calendars.push({ path: m[1], name: m[2] || 'Default' });
    }
  }
  return calendars;
}
```

### Get Events

```js
async function getEvents(daysAhead = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 86400000);

  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(now)}" end="${fmt(end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const res = await caldavRequest('REPORT', `/${encodeURIComponent(EMAIL)}/events/`, body, {
    'Depth': '1',
  });

  return parseICalEvents(res);
}

function parseICalEvents(xml) {
  const events = [];
  const calDataBlocks = xml.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const block of calDataBlocks) {
    const get = (key) => {
      const m = block.match(new RegExp(`${key}[^:]*:(.+)`));
      return m ? m[1].trim() : '';
    };
    events.push({
      uid: get('UID'),
      title: get('SUMMARY'),
      start: get('DTSTART'),
      end: get('DTEND'),
      location: get('LOCATION'),
      description: get('DESCRIPTION'),
    });
  }
  return events;
}
```

### Create Event

```js
async function createEvent({ title, startTime, endTime, description = '', location = '' }) {
  const uid = crypto.randomUUID();
  const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Eva Agent//EN
BEGIN:VEVENT
UID:${uid}
DTSTART:${fmt(startTime)}
DTEND:${fmt(endTime)}
SUMMARY:${title}
DESCRIPTION:${description}
LOCATION:${location}
END:VEVENT
END:VCALENDAR`;

  await caldavRequest('PUT',
    `/${encodeURIComponent(EMAIL)}/events/${uid}.ics`,
    ical,
    { 'Content-Type': 'text/calendar; charset=utf-8' }
  );

  return { success: true, uid };
}
```

### Delete Event

```js
async function deleteEvent(eventUid) {
  await caldavRequest('DELETE', `/${encodeURIComponent(EMAIL)}/events/${eventUid}.ics`);
  return { success: true };
}
```

## IMAP Search Syntax

| Criteria | Example | Description |
|----------|---------|-------------|
| `FROM` | `FROM "alice@example.com"` | Sender matches |
| `TO` | `TO "bob@example.com"` | Recipient matches |
| `SUBJECT` | `SUBJECT "meeting"` | Subject contains |
| `UNSEEN` | `UNSEEN` | Unread emails |
| `SEEN` | `SEEN` | Read emails |
| `SINCE` | `SINCE "01-Mar-2026"` | After date (DD-Mon-YYYY) |
| `BEFORE` | `BEFORE "01-Mar-2026"` | Before date |
| `BODY` | `BODY "keyword"` | Body contains |
| Combined | `UNSEEN FROM "alice@example.com"` | Multiple criteria (AND) |

## Complete MCP Server Example

```js
import { McpServer } from '../../lib/mcp/base-server.js';
import { defineTool } from '../../lib/mcp/tool.js';
import * as tls from 'tls';
import * as net from 'net';
import * as crypto from 'crypto';

const EMAIL = process.env.GOOGLE_EMAIL;
const PASSWORD = process.env.GOOGLE_APP_PASSWORD;
const CALDAV_BASE = 'https://apidata.googleusercontent.com/caldav/v2';
const CALDAV_AUTH = Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64');

// ── IMAP Helpers ──────────────────────────────────

function imapCommand(socket, tag, command) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      for (const line of lines) {
        if (line.startsWith(`${tag} OK`) || line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
          socket.removeListener('data', onData);
          if (line.startsWith(`${tag} OK`)) resolve(buffer);
          else reject(new Error(line));
          return;
        }
      }
    };
    socket.on('data', onData);
    socket.write(`${tag} ${command}\r\n`);
  });
}

function connectImap() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(993, 'imap.gmail.com', { servername: 'imap.gmail.com' });
    let greeted = false;
    socket.on('data', (data) => {
      if (!greeted && data.toString().startsWith('* OK')) { greeted = true; resolve(socket); }
    });
    socket.on('error', reject);
  });
}

async function imapSession(fn) {
  const socket = await connectImap();
  let tagNum = 1;
  const tag = () => `A${String(tagNum++).padStart(3, '0')}`;
  try {
    await imapCommand(socket, tag(), `LOGIN "${EMAIL}" "${PASSWORD}"`);
    return await fn(socket, tag, imapCommand);
  } finally {
    try { await imapCommand(socket, tag(), 'LOGOUT'); } catch {}
    socket.destroy();
  }
}

function parseFetchHeaders(response) {
  const emails = [];
  const blocks = response.split(/\* \d+ FETCH/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const from = (block.match(/From:\s*(.+)/i) || [])[1]?.trim() || '';
    const subject = (block.match(/Subject:\s*(.+)/i) || [])[1]?.trim() || '';
    const date = (block.match(/Date:\s*(.+)/i) || [])[1]?.trim() || '';
    const seen = block.includes('\\Seen');
    const uidMatch = block.match(/UID (\d+)/);
    if (from || subject) emails.push({ uid: uidMatch?.[1], from, subject, date, read: seen });
  }
  return emails;
}

// ── CalDAV Helpers ────────────────────────────────

async function caldavRequest(method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: { 'Authorization': `Basic ${CALDAV_AUTH}`, ...extraHeaders },
  };
  if (body) {
    opts.body = body;
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/xml; charset=utf-8';
  }
  const res = await fetch(`${CALDAV_BASE}${path}`, opts);
  if (!res.ok && res.status !== 207) throw new Error(`CalDAV ${res.status}: ${await res.text()}`);
  return res.text();
}

function parseICalEvents(xml) {
  const events = [];
  const blocks = xml.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const block of blocks) {
    const get = (key) => (block.match(new RegExp(`${key}[^:]*:(.+)`)) || [])[1]?.trim() || '';
    events.push({ uid: get('UID'), title: get('SUMMARY'), start: get('DTSTART'), end: get('DTEND'), location: get('LOCATION'), description: get('DESCRIPTION') });
  }
  return events;
}

// ── MCP Server ────────────────────────────────────

const server = new McpServer({ name: 'google-email', version: '0.1.0' });

server.addTools([
  defineTool({
    name: 'gmail_inbox',
    description: 'Get recent emails from Gmail inbox.',
    inputSchema: {
      properties: {
        count: { type: 'number', description: 'Number of emails to fetch (default 10)' },
        unread_only: { type: 'boolean', description: 'Only unread emails (default false)' },
      },
    },
    async handler({ count = 10, unread_only = false }) {
      return imapSession(async (socket, tag, cmd) => {
        await cmd(socket, tag(), 'SELECT INBOX');
        const criteria = unread_only ? 'UNSEEN' : 'ALL';
        const searchRes = await cmd(socket, tag(), `SEARCH ${criteria}`);
        const searchLine = searchRes.split('\r\n').find(l => l.startsWith('* SEARCH'));
        if (!searchLine) return { emails: [] };
        const uids = searchLine.replace('* SEARCH ', '').trim().split(' ').filter(Boolean);
        const latest = uids.slice(-count).reverse();
        if (!latest.length) return { emails: [] };
        const fetchRes = await cmd(socket, tag(), `FETCH ${latest.join(',')} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
        return { emails: parseFetchHeaders(fetchRes) };
      });
    },
  }),

  defineTool({
    name: 'gmail_read',
    description: 'Read the full content of an email by UID.',
    inputSchema: {
      properties: {
        uid: { type: 'string', description: 'Email UID (from gmail_inbox)' },
      },
      required: ['uid'],
    },
    async handler({ uid }) {
      return imapSession(async (socket, tag, cmd) => {
        await cmd(socket, tag(), 'SELECT INBOX');
        const res = await cmd(socket, tag(), `FETCH ${uid} (BODY[])`);
        const from = (res.match(/From:\s*(.+)/i) || [])[1]?.trim() || '';
        const to = (res.match(/To:\s*(.+)/i) || [])[1]?.trim() || '';
        const subject = (res.match(/Subject:\s*(.+)/i) || [])[1]?.trim() || '';
        const date = (res.match(/Date:\s*(.+)/i) || [])[1]?.trim() || '';
        const messageId = (res.match(/Message-ID:\s*(.+)/i) || [])[1]?.trim() || '';
        const bodyStart = res.indexOf('\r\n\r\n');
        let body = res.slice(bodyStart + 4).trim().slice(0, 5000);
        return { uid, from, to, subject, date, messageId, body };
      });
    },
  }),

  defineTool({
    name: 'gmail_send',
    description: 'Send an email via Gmail SMTP.',
    inputSchema: {
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body text' },
        cc: { type: 'string', description: 'CC recipients (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
    async handler({ to, subject, body, cc }) {
      return smtpSendImpl({ to, subject, body, cc });
    },
  }),

  defineTool({
    name: 'gmail_search',
    description: 'Search Gmail using IMAP search syntax.',
    inputSchema: {
      properties: {
        criteria: { type: 'string', description: 'IMAP search criteria (e.g. FROM "alice@example.com", SUBJECT "meeting", UNSEEN)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['criteria'],
    },
    async handler({ criteria, limit = 20 }) {
      return imapSession(async (socket, tag, cmd) => {
        await cmd(socket, tag(), 'SELECT INBOX');
        const searchRes = await cmd(socket, tag(), `SEARCH ${criteria}`);
        const searchLine = searchRes.split('\r\n').find(l => l.startsWith('* SEARCH'));
        if (!searchLine) return { emails: [] };
        const uids = searchLine.replace('* SEARCH ', '').trim().split(' ').filter(Boolean);
        const latest = uids.slice(-limit).reverse();
        if (!latest.length) return { emails: [] };
        const fetchRes = await cmd(socket, tag(), `FETCH ${latest.join(',')} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
        return { emails: parseFetchHeaders(fetchRes) };
      });
    },
  }),

  defineTool({
    name: 'gmail_unread_count',
    description: 'Get the number of unread emails in the inbox.',
    inputSchema: { properties: {} },
    async handler() {
      return imapSession(async (socket, tag, cmd) => {
        const res = await cmd(socket, tag(), 'STATUS INBOX (UNSEEN)');
        const match = res.match(/UNSEEN (\d+)/);
        return { unread: match ? parseInt(match[1]) : 0 };
      });
    },
  }),

  defineTool({
    name: 'gcal_events',
    description: 'Get upcoming Google Calendar events.',
    inputSchema: {
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 7)' },
      },
    },
    async handler({ days_ahead = 7 }) {
      const now = new Date();
      const end = new Date(now.getTime() + days_ahead * 86400000);
      const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${fmt(now)}" end="${fmt(end)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
      const res = await caldavRequest('REPORT', `/${encodeURIComponent(EMAIL)}/events/`, body, { 'Depth': '1' });
      return { events: parseICalEvents(res) };
    },
  }),

  defineTool({
    name: 'gcal_create',
    description: 'Create a Google Calendar event.',
    inputSchema: {
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_time: { type: 'string', description: 'Start time (ISO 8601, e.g. 2026-03-15T10:00:00)' },
        end_time: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description (optional)' },
        location: { type: 'string', description: 'Event location (optional)' },
      },
      required: ['title', 'start_time', 'end_time'],
    },
    async handler({ title, start_time, end_time, description = '', location = '' }) {
      const uid = crypto.randomUUID();
      const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${fmt(start_time)}\r\nDTEND:${fmt(end_time)}\r\nSUMMARY:${title}\r\nDESCRIPTION:${description}\r\nLOCATION:${location}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
      await caldavRequest('PUT', `/${encodeURIComponent(EMAIL)}/events/${uid}.ics`, ical, { 'Content-Type': 'text/calendar; charset=utf-8' });
      return { success: true, uid };
    },
  }),
]);

// SMTP implementation (inline for the complete example)
async function smtpSendImpl({ to, subject, body, cc, inReplyTo, references }) {
  return new Promise((resolve, reject) => {
    let socket = net.createConnection(587, 'smtp.gmail.com');
    let buf = '', step = 0, upgraded = false;
    const msgId = `<${crypto.randomUUID()}@gmail.com>`;
    const hdrs = [`From: ${EMAIL}`, `To: ${to}`, cc ? `Cc: ${cc}` : null, `Subject: ${subject}`,
      `Message-ID: ${msgId}`, inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
      references ? `References: ${references}` : null, `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8'].filter(Boolean).join('\r\n');
    const msg = `${hdrs}\r\n\r\n${body}\r\n.\r\n`;
    function proc(line) {
      const c = parseInt(line.slice(0, 3));
      if (step === 0 && c === 220) { socket.write('EHLO localhost\r\n'); step++; }
      else if (step === 1 && line.startsWith('250 ')) {
        if (!upgraded) { socket.write('STARTTLS\r\n'); step = 2; }
        else { socket.write(`AUTH PLAIN ${Buffer.from(`\0${EMAIL}\0${PASSWORD}`).toString('base64')}\r\n`); step = 4; }
      }
      else if (step === 2 && c === 220) {
        const t = tls.connect({ socket, servername: 'smtp.gmail.com' }, () => {
          socket = t; upgraded = true; socket.on('data', onD); socket.write('EHLO localhost\r\n'); step = 1;
        }); t.on('error', reject);
      }
      else if (step === 4 && c === 235) { socket.write(`MAIL FROM:<${EMAIL}>\r\n`); step++; }
      else if (step === 4) reject(new Error(`Auth failed: ${line}`));
      else if (step === 5 && c === 250) { socket.write(`RCPT TO:<${to}>\r\n`); step++; }
      else if (step === 6 && c === 250) { socket.write('DATA\r\n'); step++; }
      else if (step === 7 && c === 354) { socket.write(msg); step++; }
      else if (step === 8 && c === 250) { socket.write('QUIT\r\n'); resolve({ success: true, messageId: msgId }); }
    }
    function onD(d) { buf += d.toString(); const ls = buf.split('\r\n'); buf = ls.pop() || ''; ls.forEach(l => l.trim() && proc(l)); }
    socket.on('data', onD); socket.on('error', reject);
  });
}

server.start();
```

## Troubleshooting

- **"IMAP login failed"**: Verify App Passwords is enabled (requires 2FA). Regenerate the App Password if needed.
- **"CalDAV 401"**: Same credentials as IMAP — check email and App Password are correct.
- **"No calendars found"**: Enable IMAP in Gmail Settings → Forwarding and POP/IMAP.
- **IMAP search syntax**: Uses IMAP query language, not Gmail search. Use `FROM`, `SUBJECT`, `SINCE`, `UNSEEN`, etc. Wrap values in double quotes.
- **Date format in search**: IMAP dates use `DD-Mon-YYYY` format (e.g. `01-Mar-2026`).
- **MIME parsing**: The basic parser handles plain text. For complex multipart emails, the body extraction may need refinement.

## Tips

- **App Passwords never expire** — set once, works forever (unless 2FA is disabled or password is revoked)
- **No API quotas** — IMAP/SMTP have no daily limits like the Gmail REST API
- **CalDAV is HTTP** — uses standard `fetch`, works with Basic auth
- **IMAP is stateful** — each session opens a connection, authenticates, runs commands, then closes
- **Thread replies properly** — always include `In-Reply-To` and `References` headers when replying
- **Credential storage** — keep App Password in `.env`, never hardcode it
