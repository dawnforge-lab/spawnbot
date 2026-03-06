# Reddit Bot

How to create an MCP server for the Reddit API using Node.js.

## Overview

Reddit uses OAuth2 for API access. This skill covers posting, commenting, searching, browsing subreddits, and monitoring engagement via the Reddit API.

## Environment Variables

```
REDDIT_CLIENT_ID       — OAuth2 app client ID (from reddit.com/prefs/apps)
REDDIT_CLIENT_SECRET   — OAuth2 app client secret
REDDIT_REFRESH_TOKEN   — OAuth2 refresh token for the target account
REDDIT_USER_AGENT      — User agent string (e.g. "mybot/1.0")
```

Register when creating the server:
```
tool_create({
  name: "reddit-bot",
  code: "<full source>",
  env: {
    REDDIT_CLIENT_ID: "${REDDIT_CLIENT_ID}",
    REDDIT_CLIENT_SECRET: "${REDDIT_CLIENT_SECRET}",
    REDDIT_REFRESH_TOKEN: "${REDDIT_REFRESH_TOKEN}",
    REDDIT_USER_AGENT: "${REDDIT_USER_AGENT}"
  }
})
```

## Setting Up Reddit API Access

1. Go to https://www.reddit.com/prefs/apps
2. Click "create another app"
3. Select "web app" type
4. Set redirect URI to `http://localhost:8080`
5. Note the client ID (under app name) and client secret
6. Authorize the account to get a refresh token (see Authorization section below)

## OAuth2 Authentication

Reddit requires a two-step auth: get an access token using a refresh token, then use the access token for API calls. Access tokens expire after 1 hour.

```js
const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'spawnbot-reddit/1.0';

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}`,
  });

  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
  const data = await res.json();

  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // Refresh 60s early
  return accessToken;
}
```

## API Helpers

```js
const API_BASE = 'https://oauth.reddit.com';

async function redditGet(path, params = {}) {
  const token = await getAccessToken();
  const query = new URLSearchParams(params).toString();
  const url = query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reddit API ${res.status}: ${err}`);
  }
  return res.json();
}

async function redditPost(path, body = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reddit API ${res.status}: ${err}`);
  }
  return res.json();
}
```

## Reddit API Endpoints

### Identity

```js
// GET /api/v1/me — authenticated user info
const me = await redditGet('/api/v1/me');
// Returns: { name, link_karma, comment_karma, created_utc, ... }
```

### Submit a Text Post

```js
// POST /api/submit
const result = await redditPost('/api/submit', {
  sr: 'subredditname',       // subreddit (without r/)
  kind: 'self',              // 'self' for text, 'link' for URL
  title: 'Post Title',
  text: 'Post body text',
});
// Returns: { json: { data: { name: 't3_postid', url: '...' } } }
```

### Submit a Link Post

```js
const result = await redditPost('/api/submit', {
  sr: 'subredditname',
  kind: 'link',
  title: 'Post Title',
  url: 'https://example.com',
});
```

### Reply to a Post or Comment

```js
// POST /api/comment
const result = await redditPost('/api/comment', {
  thing_id: 't3_postid',    // t3_ for posts, t1_ for comments
  text: 'Reply text',
});
```

### Get Subreddit Posts

```js
// GET /r/{subreddit}/{sort} — sort: hot, new, top, rising
const data = await redditGet('/r/subredditname/hot', { limit: 25 });
// Top posts with time filter
const top = await redditGet('/r/subredditname/top', { limit: 25, t: 'week' });
// t: hour, day, week, month, year, all
```

### Search Posts

```js
// GET /r/{subreddit}/search or /search
const results = await redditGet('/search', {
  q: 'search query',
  sort: 'relevance',        // relevance, hot, top, new, comments
  t: 'week',                // hour, day, week, month, year, all
  limit: 25,
  type: 'sr,link',          // sr (subreddits), link (posts)
});
```

### Get User Info

```js
// GET /user/{username}/about
const user = await redditGet('/user/someuser/about');
// Returns: { data: { name, link_karma, comment_karma, created_utc, ... } }
```

### Get User Posts

```js
// GET /user/{username}/submitted
const posts = await redditGet('/user/someuser/submitted', {
  sort: 'new',              // hot, new, top, controversial
  limit: 25,
});
```

### Get Subreddit Info

```js
// GET /r/{subreddit}/about
const info = await redditGet('/r/subredditname/about');
// Returns: { data: { display_name, subscribers, public_description, ... } }
```

### Subscribe to Subreddit

```js
// POST /api/subscribe
await redditPost('/api/subscribe', {
  action: 'sub',            // 'sub' to join, 'unsub' to leave
  sr_name: 'subredditname',
});
```

### Get a Specific Post

```js
// GET /comments/{post_id}
const data = await redditGet('/comments/postid');
// Returns: [listing_with_post, listing_with_comments]
```

## Authorization Flow

To get a refresh token for a Reddit account, the agent can create a small authorization helper:

1. Build the auth URL:
   ```
   https://www.reddit.com/api/v1/authorize?client_id=CLIENT_ID&response_type=code&state=random&redirect_uri=http://localhost:8080&duration=permanent&scope=identity,read,submit,edit,subscribe,vote,history,mysubreddits
   ```

2. User visits the URL and authorizes the app
3. Reddit redirects to `http://localhost:8080?code=AUTH_CODE`
4. Exchange the code for tokens:
   ```js
   const res = await fetch('https://www.reddit.com/api/v1/access_token', {
     method: 'POST',
     headers: {
       'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
       'Content-Type': 'application/x-www-form-urlencoded',
     },
     body: `grant_type=authorization_code&code=${AUTH_CODE}&redirect_uri=http://localhost:8080`,
   });
   const data = await res.json();
   // data.refresh_token — save this as REDDIT_REFRESH_TOKEN
   ```

5. The refresh token is permanent — store it in `.env`

## Complete MCP Server Example

```js
import { McpServer } from '../../lib/mcp/base-server.js';
import { defineTool } from '../../lib/mcp/tool.js';

const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN;
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'spawnbot-reddit/1.0';
const API_BASE = 'https://oauth.reddit.com';

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}`,
  });
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function redditGet(path, params = {}) {
  const token = await getAccessToken();
  const query = new URLSearchParams(params).toString();
  const url = query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Reddit API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function redditPost(path, body = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Reddit API ${res.status}: ${await res.text()}`);
  return res.json();
}

function extractPosts(listing) {
  return (listing?.data?.children || []).map(c => ({
    id: c.data.id,
    title: c.data.title,
    author: c.data.author,
    subreddit: c.data.subreddit,
    score: c.data.score,
    num_comments: c.data.num_comments,
    url: c.data.url,
    selftext: c.data.selftext?.slice(0, 500),
    created_utc: c.data.created_utc,
  }));
}

const server = new McpServer({ name: 'reddit-bot', version: '0.1.0' });

server.addTools([
  defineTool({
    name: 'reddit_whoami',
    description: 'Get the authenticated Reddit account info.',
    inputSchema: { properties: {} },
    async handler() {
      const me = await redditGet('/api/v1/me');
      return { name: me.name, karma: me.link_karma + me.comment_karma, created: me.created_utc };
    },
  }),

  defineTool({
    name: 'reddit_post',
    description: 'Create a text post in a subreddit.',
    inputSchema: {
      properties: {
        subreddit: { type: 'string', description: 'Subreddit name (without r/)' },
        title: { type: 'string', description: 'Post title' },
        text: { type: 'string', description: 'Post body text' },
      },
      required: ['subreddit', 'title', 'text'],
    },
    async handler({ subreddit, title, text }) {
      const result = await redditPost('/api/submit', { sr: subreddit, kind: 'self', title, text });
      return result.json?.data || result;
    },
  }),

  defineTool({
    name: 'reddit_reply',
    description: 'Reply to a post (t3_id) or comment (t1_id).',
    inputSchema: {
      properties: {
        thing_id: { type: 'string', description: 'Post ID (t3_xxx) or comment ID (t1_xxx)' },
        text: { type: 'string', description: 'Reply text' },
      },
      required: ['thing_id', 'text'],
    },
    async handler({ thing_id, text }) {
      return await redditPost('/api/comment', { thing_id, text });
    },
  }),

  defineTool({
    name: 'reddit_browse',
    description: 'Browse a subreddit. Returns posts sorted by hot, new, top, or rising.',
    inputSchema: {
      properties: {
        subreddit: { type: 'string', description: 'Subreddit name' },
        sort: { type: 'string', description: 'Sort: hot, new, top, rising (default: hot)' },
        time: { type: 'string', description: 'Time filter for top: hour, day, week, month, year, all' },
        limit: { type: 'number', description: 'Max posts (default 25)' },
      },
      required: ['subreddit'],
    },
    async handler({ subreddit, sort = 'hot', time = 'day', limit = 25 }) {
      const params = { limit };
      if (sort === 'top') params.t = time;
      const data = await redditGet(`/r/${subreddit}/${sort}`, params);
      return extractPosts(data);
    },
  }),

  defineTool({
    name: 'reddit_search',
    description: 'Search Reddit for posts.',
    inputSchema: {
      properties: {
        query: { type: 'string', description: 'Search query' },
        subreddit: { type: 'string', description: 'Limit to subreddit (optional)' },
        sort: { type: 'string', description: 'Sort: relevance, hot, top, new, comments' },
        time: { type: 'string', description: 'Time filter: hour, day, week, month, year, all' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: ['query'],
    },
    async handler({ query, subreddit, sort = 'relevance', time = 'week', limit = 25 }) {
      const path = subreddit ? `/r/${subreddit}/search` : '/search';
      const params = { q: query, sort, t: time, limit, restrict_sr: subreddit ? 'true' : 'false' };
      const data = await redditGet(path, params);
      return extractPosts(data);
    },
  }),

  defineTool({
    name: 'reddit_subreddit_info',
    description: 'Get information about a subreddit.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Subreddit name' },
      },
      required: ['name'],
    },
    async handler({ name }) {
      const data = await redditGet(`/r/${name}/about`);
      const d = data.data;
      return {
        name: d.display_name,
        title: d.title,
        description: d.public_description,
        subscribers: d.subscribers,
        active: d.accounts_active,
        created: d.created_utc,
        nsfw: d.over18,
      };
    },
  }),
]);

server.start();
```

## Rate Limits

- Reddit allows **60 requests per minute** for OAuth2 clients
- Add a small delay between rapid-fire operations
- 429 responses mean you're rate-limited — back off and retry

## Tips

- **Fullnames**: Reddit uses `t1_` prefix for comments, `t3_` for posts, `t5_` for subreddits
- **User agent**: Reddit requires a descriptive user agent. Generic agents get throttled.
- **Refresh tokens**: They don't expire — store securely in `.env`
- **Post formatting**: Reddit uses Markdown in post/comment bodies
- **Subreddit rules**: Check subreddit rules before posting to avoid bans. Use `GET /r/{sub}/about/rules`
- **NSFW content**: Some subreddits require marking posts as NSFW. Add `nsfw: true` to submit params.
- **Flair**: Some subreddits require flair. Add `flair_id` and `flair_text` to submit params.
