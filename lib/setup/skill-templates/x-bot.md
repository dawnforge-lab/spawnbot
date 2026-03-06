# X/Twitter Bot

How to create an MCP server for the X (Twitter) API v2 using Node.js.

## Overview

This skill covers posting tweets, checking mentions, DMs, timeline, search, and engagement (likes, retweets, follows) via the X API v2. The MCP server uses OAuth 1.0a for write operations and Bearer token for read operations.

## Environment Variables

```
TWITTER_API_KEY        — App API key (from developer.x.com)
TWITTER_API_SECRET     — App API secret
TWITTER_BEARER_TOKEN   — App bearer token (for read-only endpoints)
TWITTER_ACCESS_TOKEN   — User access token (for posting as the account)
TWITTER_ACCESS_SECRET  — User access token secret
```

Register these when creating the server:
```
tool_create({
  name: "x-bot",
  code: "<full source>",
  env: {
    TWITTER_API_KEY: "${TWITTER_API_KEY}",
    TWITTER_API_SECRET: "${TWITTER_API_SECRET}",
    TWITTER_BEARER_TOKEN: "${TWITTER_BEARER_TOKEN}",
    TWITTER_ACCESS_TOKEN: "${TWITTER_ACCESS_TOKEN}",
    TWITTER_ACCESS_SECRET: "${TWITTER_ACCESS_SECRET}"
  }
})
```

## OAuth 1.0a Signing (Node.js)

Write operations (post, like, retweet, follow, DM) require OAuth 1.0a signatures. Here's how to implement it with no external dependencies:

```js
import crypto from 'crypto';

function oauthSign(method, url, params, credentials) {
  const { apiKey, apiSecret, accessToken, accessSecret } = credentials;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // Combine all params for signature base
  const allParams = { ...oauthParams, ...params };
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${encodeRFC3986(k)}=${encodeRFC3986(allParams[k])}`)
    .join('&');

  const baseString = `${method.toUpperCase()}&${encodeRFC3986(url)}&${encodeRFC3986(paramString)}`;
  const signingKey = `${encodeRFC3986(apiSecret)}&${encodeRFC3986(accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeRFC3986(k)}="${encodeRFC3986(oauthParams[k])}"`)
    .join(', ');

  return authHeader;
}

function encodeRFC3986(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}
```

## API Helpers

```js
const API_BASE = 'https://api.x.com/2';

const credentials = {
  apiKey: process.env.TWITTER_API_KEY,
  apiSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
};
const bearerToken = process.env.TWITTER_BEARER_TOKEN;

// OAuth 1.0a request (write operations)
async function oauthRequest(method, url, body = null) {
  const params = {};
  const auth = oauthSign(method, url, params, credentials);
  const opts = {
    method,
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X API ${res.status}: ${err}`);
  }
  return res.json();
}

// Bearer token request (read operations)
async function bearerRequest(url) {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${bearerToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X API ${res.status}: ${err}`);
  }
  return res.json();
}
```

## X API v2 Endpoints

### Post a Tweet

```js
// POST https://api.x.com/2/tweets
const data = await oauthRequest('POST', `${API_BASE}/tweets`, { text: 'Hello world!' });
// Returns: { data: { id: '123', text: 'Hello world!' } }
```

### Reply to a Tweet

```js
await oauthRequest('POST', `${API_BASE}/tweets`, {
  text: 'My reply',
  reply: { in_reply_to_tweet_id: tweetId },
});
```

### Post a Thread

```js
let previousId = null;
for (const text of tweets) {
  const body = { text };
  if (previousId) body.reply = { in_reply_to_tweet_id: previousId };
  const data = await oauthRequest('POST', `${API_BASE}/tweets`, body);
  previousId = data.data.id;
}
```

### Like a Tweet

```js
// Get your user ID first with /2/users/me
// POST https://api.x.com/2/users/:userId/likes
await oauthRequest('POST', `${API_BASE}/users/${userId}/likes`, { tweet_id: tweetId });
```

### Retweet

```js
// POST https://api.x.com/2/users/:userId/retweets
await oauthRequest('POST', `${API_BASE}/users/${userId}/retweets`, { tweet_id: tweetId });
```

### Follow a User

```js
// POST https://api.x.com/2/users/:userId/following
await oauthRequest('POST', `${API_BASE}/users/${userId}/following`, { target_user_id: targetUserId });
```

### Get Mentions

```js
// GET https://api.x.com/2/users/:userId/mentions
const url = `${API_BASE}/users/${userId}/mentions?max_results=20&tweet.fields=created_at,public_metrics,conversation_id&expansions=author_id&user.fields=username,name`;
const data = await bearerRequest(url);
// Returns: { data: [...tweets], includes: { users: [...] } }
```

### Get Timeline

```js
// GET https://api.x.com/2/users/:userId/timelines/reverse_chronological
const url = `${API_BASE}/users/${userId}/timelines/reverse_chronological?max_results=20&tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=username,name`;
const data = await bearerRequest(url);
```

### Search Tweets

```js
// GET https://api.x.com/2/tweets/search/recent
const url = `${API_BASE}/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=username,name`;
const data = await bearerRequest(url);
```

### Send DM

```js
// POST https://api.x.com/2/dm_conversations/with/:participantId/messages
await oauthRequest('POST', `${API_BASE}/dm_conversations/with/${participantId}/messages`, { text: message });
```

### Get DMs

```js
// GET https://api.x.com/2/dm_events
const url = `${API_BASE}/dm_events?max_results=20&dm_event.fields=id,text,sender_id,created_at,dm_conversation_id`;
const data = await bearerRequest(url);
```

### User Lookup

```js
// By username
const data = await bearerRequest(`${API_BASE}/users/by/username/${username}?user.fields=description,public_metrics`);

// By ID
const data = await bearerRequest(`${API_BASE}/users/${userId}?user.fields=description,public_metrics`);

// Get own user ID
const me = await bearerRequest(`${API_BASE}/users/me`);
const userId = me.data.id;
```

## Complete MCP Server Example

```js
import { McpServer } from '../../lib/mcp/base-server.js';
import { defineTool } from '../../lib/mcp/tool.js';
import crypto from 'crypto';

const API_BASE = 'https://api.x.com/2';

const credentials = {
  apiKey: process.env.TWITTER_API_KEY,
  apiSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
};
const bearerToken = process.env.TWITTER_BEARER_TOKEN;

// -- OAuth 1.0a signing (paste oauthSign + encodeRFC3986 from above) --
// -- API helpers (paste oauthRequest + bearerRequest from above) --

// Cache user ID
let cachedUserId = null;
async function getMyUserId() {
  if (cachedUserId) return cachedUserId;
  const me = await bearerRequest(`${API_BASE}/users/me`);
  cachedUserId = me.data.id;
  return cachedUserId;
}

const server = new McpServer({ name: 'x-bot', version: '0.1.0' });

server.addTools([
  defineTool({
    name: 'x_post',
    description: 'Post a tweet (max 280 characters).',
    inputSchema: {
      properties: {
        text: { type: 'string', description: 'Tweet text (max 280 chars)' },
      },
      required: ['text'],
    },
    async handler({ text }) {
      const data = await oauthRequest('POST', `${API_BASE}/tweets`, { text });
      return { tweet_id: data.data.id, text: data.data.text };
    },
  }),

  defineTool({
    name: 'x_mentions',
    description: 'Get recent mentions.',
    inputSchema: {
      properties: {
        max_results: { type: 'number', description: 'Max results (5-100, default 20)' },
      },
    },
    async handler({ max_results = 20 }) {
      const userId = await getMyUserId();
      const url = `${API_BASE}/users/${userId}/mentions?max_results=${max_results}&tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=username,name`;
      return await bearerRequest(url);
    },
  }),

  // Add more tools following the same pattern...
]);

server.start();
```

## API Tier Requirements

| Endpoint | Free | Basic | Pro |
|----------|------|-------|-----|
| POST /tweets | 1,500/mo | 3,000/mo | 300k/mo |
| GET /users/me | Yes | Yes | Yes |
| GET /users/:id/mentions | No | Yes | Yes |
| GET /tweets/search/recent | No | Yes | Yes |
| GET /users/:id/timelines | No | Yes | Yes |
| POST /users/:id/likes | Yes | Yes | Yes |
| POST /users/:id/retweets | Yes | Yes | Yes |
| DM endpoints | No | No | Pro only |

**Important**: A 403 error usually means your API tier doesn't support that endpoint. Check your developer portal at developer.x.com.

## Tips

- Always get your user ID with `/users/me` before calling endpoints that need it (likes, retweets, follows, mentions)
- Cache the user ID — it doesn't change
- Tweet text max 280 characters — truncate or split into threads for longer content
- Rate limits vary by endpoint and tier — the API returns `429` when exceeded
- For threads, chain tweets using `reply.in_reply_to_tweet_id`
- OAuth 1.0a is required for ALL write operations (post, like, retweet, follow, DM)
- Bearer token works for read-only operations (search, mentions, timeline, user lookup)
- The `tweet.fields`, `expansions`, and `user.fields` query params control what data you get back
