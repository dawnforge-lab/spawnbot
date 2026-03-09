---
name: reddit
description: "Reddit API integration using PRAW. Post, comment, search, browse subreddits, track karma, and monitor engagement. Use when the user asks about Reddit, posting to subreddits, or reading Reddit content."
---

# Reddit via PRAW (Python Reddit API Wrapper)

Full Reddit API access: post, comment, vote, search, browse, and monitor. Uses OAuth2 with refresh tokens for permanent access.

## Setup

### 1. Create a Reddit App

Go to https://www.reddit.com/prefs/apps/
- Click "create another app..."
- Select **"web app"** type
- Set redirect URI to `http://localhost:8080`
- Note the `client_id` (under app name) and `client_secret`

### 2. Install PRAW

```bash
pip install praw python-dotenv
```

### 3. Configure

Store in `.env`:
```
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_REDIRECT_URI=http://localhost:8080
REDDIT_USER_AGENT=spawnbot-reddit/1.0
```

### 4. Authorize (One-Time per Account)

Create an authorization script that:
1. Creates a PRAW Reddit instance with client credentials
2. Generates an auth URL with scopes: `identity`, `read`, `submit`, `edit`, `subscribe`, `vote`, `history`, `mysubreddits`
3. Starts a local HTTP server on the redirect URI port
4. User opens the auth URL in browser and approves
5. Captures the callback code and exchanges for a refresh token
6. Saves refresh token to `~/.config/reddit/tokens/<username>.json`

The refresh token works indefinitely — no re-authorization needed.

## Authentication Pattern

```python
import praw

reddit = praw.Reddit(
    client_id=os.getenv("REDDIT_CLIENT_ID"),
    client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
    refresh_token=saved_refresh_token,
    redirect_uri=os.getenv("REDDIT_REDIRECT_URI", "http://localhost:8080"),
    user_agent=os.getenv("REDDIT_USER_AGENT", "spawnbot-reddit/1.0"),
)
```

## Operations

### Post

```python
# Text post
sub = reddit.subreddit("subreddit_name")
submission = sub.submit(title="Title", selftext="Body text")

# Link post
submission = sub.submit(title="Title", url="https://example.com")

# With flair
submission = sub.submit(title="Title", selftext="Body", flair_text="Discussion")
```

### Comment

```python
# Reply to post
submission = reddit.submission(id="post_id")
comment = submission.reply("Comment text")

# Reply to comment
comment = reddit.comment(id="comment_id")
reply = comment.reply("Reply text")
```

Note: Strip `t3_` prefix from post IDs and `t1_` prefix from comment IDs.

### Read

```python
# Top posts from subreddit (time_filter: hour, day, week, month, year, all)
for post in reddit.subreddit("python").top(time_filter="day", limit=10):
    print(post.title, post.score, post.num_comments)

# Hot posts
for post in reddit.subreddit("python").hot(limit=10):
    print(post.title)

# Search posts (within subreddit or all)
for post in reddit.subreddit("python").search("asyncio", sort="relevance", limit=10):
    print(post.title)

# Search all of Reddit
for post in reddit.subreddit("all").search("query", sort="relevance", limit=10):
    print(post.title, post.subreddit.display_name)

# Get specific submission by ID or URL
submission = reddit.submission(id="abc123")
submission = reddit.submission(url="https://reddit.com/r/...")
```

### User Info

```python
# Authenticated user
user = reddit.user.me()
print(user.name, user.link_karma, user.comment_karma)

# Any user
redditor = reddit.redditor("username")
redditor._fetch()
print(redditor.link_karma, redditor.comment_karma)

# User's post/comment history
for post in reddit.redditor("username").submissions.new(limit=10):
    print(post.title)
for comment in reddit.redditor("username").comments.new(limit=10):
    print(comment.body[:100])
```

### Subreddit Info

```python
sub = reddit.subreddit("python")
sub._fetch()
print(sub.display_name, sub.subscribers, sub.public_description)

# Rules
for rule in sub.rules:
    print(rule.short_name, rule.description[:100])

# Trending subreddits
for sub in reddit.subreddits.popular(limit=10):
    print(sub.display_name, sub.subscribers)
```

### Subscribe

```python
reddit.subreddit("python").subscribe()
```

## Post/Comment Data Fields

**Post:** `id`, `title`, `selftext`, `url`, `subreddit`, `author`, `score`, `upvote_ratio`, `num_comments`, `created_utc`

**Comment:** `id`, `body`, `subreddit`, `author`, `score`, `created_utc`, `link_title`

**User:** `name`, `link_karma`, `comment_karma`, `created_utc`, `has_verified_email`, `is_mod`

## Multi-Account Support

Store multiple refresh tokens and switch between them:
```python
# Save tokens per account in ~/.config/reddit/tokens/<username>.json
# Load the appropriate refresh token when creating the PRAW instance
```

## Creating the Tool

When you need Reddit capabilities, use the `create-tool` skill to build Reddit tools in `tools/`. Since PRAW is a Python library, the tool should shell out to a Python helper script. Consider creating:

1. `reddit-post` — create text or link posts (subreddit, title, body/url)
2. `reddit-read` — get top/hot/new posts from a subreddit
3. `reddit-comment` — reply to posts or comments
4. `reddit-search` — search posts across Reddit or within a subreddit

Each tool should read `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` from `process.env` and load the refresh token from the saved token file.

## Rate Limits

Reddit API allows ~60 requests/minute with OAuth2. PRAW handles rate limiting automatically.

## Important Notes

- Always read subreddit rules before posting (`sub.rules`)
- Respect subreddit-specific posting requirements (flair, post types)
- Reddit has site-wide rules against spam, vote manipulation, and ban evasion
- New accounts have posting restrictions in many subreddits (karma thresholds)
