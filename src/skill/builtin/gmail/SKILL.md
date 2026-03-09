---
name: gmail
description: "Read, send, reply, and search Gmail using IMAP/SMTP with Google App Passwords. Use when the user asks about email, inbox, sending messages, or email notifications. No OAuth, no Cloud Console, no payment."
---

# Gmail via IMAP/SMTP

Direct protocol access to Gmail. No browser automation, no Cloud Console, no payment. Uses Google App Passwords for permanent credentials that never expire.

## Setup

### 1. Enable 2FA on Google Account
Go to https://myaccount.google.com/security and enable 2-Step Verification.

### 2. Generate an App Password
Go to https://myaccount.google.com/apppasswords
- Select "Mail" as the app
- Copy the 16-character password (spaces are fine, strip them in code)

### 3. Configure
Store credentials in `.env`:
```
GMAIL_ADDRESS=your@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxx
```

## Protocol Details

| Function | Protocol | Server | Port |
|----------|----------|--------|------|
| Read | IMAP SSL | imap.gmail.com | 993 |
| Send | SMTP TLS | smtp.gmail.com | 587 |

## Reading Email (IMAP)

### Connect

```typescript
// Bun doesn't have built-in IMAP, use a library or shell out
// Option 1: Use bash tool with python3 one-liner
// Option 2: Create a tool that shells out to a helper script
// Option 3: Use node-imap compatible library
```

### IMAP Commands (via shell)

```bash
# Get unread count
python3 -c "
import imaplib
m = imaplib.IMAP4_SSL('imap.gmail.com', 993)
m.login('$GMAIL_ADDRESS', '$GMAIL_APP_PASSWORD')
m.select('INBOX')
_, data = m.search(None, 'UNSEEN')
print(len(data[0].split()) if data[0] else 0)
m.logout()
"

# Get latest N emails (headers only, doesn't mark as read)
python3 -c "
import imaplib, email
from email.header import decode_header
m = imaplib.IMAP4_SSL('imap.gmail.com', 993)
m.login('$GMAIL_ADDRESS', '$GMAIL_APP_PASSWORD')
m.select('INBOX')
_, data = m.search(None, 'ALL')
ids = data[0].split()[-10:]  # last 10
for uid in reversed(ids):
    _, msg_data = m.fetch(uid, '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
    print(msg_data[0][1].decode(errors='replace').strip())
    print('---')
m.logout()
"
```

### IMAP Search Syntax

```
UNSEEN                          — unread messages
FROM "alice@example.com"        — from specific sender
SUBJECT "meeting"               — subject contains
SINCE "01-Feb-2026"             — since date
UNSEEN FROM "bob"               — combine criteria
```

## Sending Email (SMTP)

```bash
python3 -c "
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

msg = MIMEMultipart()
msg['From'] = '$GMAIL_ADDRESS'
msg['To'] = 'recipient@example.com'
msg['Subject'] = 'Hello from spawnbot'
msg.attach(MIMEText('Message body here', 'plain', 'utf-8'))

s = smtplib.SMTP('smtp.gmail.com', 587)
s.ehlo(); s.starttls()
s.login('$GMAIL_ADDRESS', '$GMAIL_APP_PASSWORD')
s.sendmail(msg['From'], [msg['To']], msg.as_string())
s.quit()
print('Sent')
"
```

### Reply Threading

When replying to an email, include these headers for proper threading:
- `In-Reply-To`: original Message-ID
- `References`: original References + Message-ID
- `Subject`: prepend `Re: ` if not already present

## Key Operations

| Operation | How |
|-----------|-----|
| Read inbox | IMAP `SEARCH ALL`, `FETCH BODY.PEEK[HEADER]` |
| Unread count | IMAP `SEARCH UNSEEN` |
| Read full email | IMAP `FETCH RFC822` (marks as read) |
| Search | IMAP `SEARCH` with criteria |
| Mark read | IMAP `STORE +FLAGS \\Seen` |
| Mark unread | IMAP `STORE -FLAGS \\Seen` |
| Send email | SMTP `sendmail()` |
| Reply | SMTP with In-Reply-To/References headers |

## Creating the Tool

When you need email capabilities, use the `create-tool` skill to build email tools in `tools/`. Consider creating:

1. `gmail-inbox` — read inbox, return unread count + latest messages
2. `gmail-send` — send an email (to, subject, body, cc, bcc)
3. `gmail-read` — read a specific email by UID
4. `gmail-reply` — reply to an email with proper threading

Each tool should read `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` from `process.env`. Since Bun lacks native IMAP, the simplest approach is shelling out to a Python helper script (Python's `imaplib` and `smtplib` are in the standard library, no pip install needed).

## Troubleshooting

- **"IMAP login failed"**: Ensure App Passwords is enabled (requires 2FA). Regenerate the password if needed.
- **Search syntax**: IMAP uses its own query language, not Gmail's search syntax. Use `FROM`, `SUBJECT`, `SINCE`, `UNSEEN`, etc. Wrap values in double quotes.
- **Rate limits**: Gmail allows ~500 IMAP connections/day. Don't poll more frequently than every 2-3 minutes.
