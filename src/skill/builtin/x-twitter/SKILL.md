---
name: x-twitter
description: "X/Twitter API integration using tweepy. Post tweets, threads, reply, like, retweet, check mentions, read DMs, search tweets, and track followers. Use when the user asks about X, Twitter, tweeting, or social media posting."
---

# X/Twitter via Tweepy

Full X API access: post tweets, threads, replies, likes, retweets, DMs, mentions, search, and follower tracking. Uses OAuth 1.0a for user actions and Bearer token for read-only endpoints.

## Setup

### 1. Create an X Developer App

Go to https://developer.x.com/en/portal/dashboard
- Create a project and app
- Enable OAuth 1.0a (read and write)
- Note: API Key, API Secret, and Bearer Token

### 2. Install Tweepy

```bash
pip install tweepy python-dotenv requests
```

### 3. Configure

Store in `.env`:
```
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_BEARER_TOKEN=your_bearer_token
```

### 4. Authorize Account (One-Time)

Create an authorization script that:
1. Uses OAuth 1.0a PIN-based or callback flow
2. Gets access token + access token secret for the target account
3. Saves to `~/.config/x-bot/authorized_account.json`:

```json
{
  "username": "your_handle",
  "user_id": "123456789",
  "access_token": "...",
  "access_token_secret": "..."
}
```

## Authentication Pattern

```python
import tweepy

# v2 Client (most operations)
client = tweepy.Client(
    bearer_token=os.getenv("TWITTER_BEARER_TOKEN"),
    consumer_key=os.getenv("TWITTER_API_KEY"),
    consumer_secret=os.getenv("TWITTER_API_SECRET"),
    access_token=saved_access_token,
    access_token_secret=saved_access_token_secret,
)

# v1.1 API (media upload only)
auth = tweepy.OAuth1UserHandler(api_key, api_secret)
auth.set_access_token(access_token, access_token_secret)
api_v1 = tweepy.API(auth)
```

## Operations

### Post Tweet

```python
# Simple tweet
response = client.create_tweet(text="Hello world!")
tweet_id = response.data["id"]

# Tweet with image (requires v1.1 API for media upload)
import requests
img = requests.get("https://example.com/image.jpg")
with open("/tmp/tweet_image.jpg", "wb") as f:
    f.write(img.content)
media = api_v1.media_upload("/tmp/tweet_image.jpg")
client.create_tweet(text="Check this out!", media_ids=[media.media_id])
```

### Thread

```python
tweets = ["First tweet in thread", "Second tweet", "Third tweet"]
prev_id = None
for text in tweets:
    resp = client.create_tweet(text=text, in_reply_to_tweet_id=prev_id)
    prev_id = resp.data["id"]
```

### Reply, Like, Retweet, Follow

```python
client.create_tweet(text="Great post!", in_reply_to_tweet_id=tweet_id)
client.like(tweet_id=tweet_id)
client.retweet(tweet_id=tweet_id)
client.follow_user(target_user_id=user_id)
```

### Get Mentions

```python
resp = client.get_users_mentions(
    id=user_id,
    max_results=20,
    tweet_fields=["created_at", "public_metrics", "conversation_id"],
    expansions=["author_id"],
    user_fields=["username", "name", "public_metrics"],
)
for tweet in resp.data or []:
    print(tweet.text, tweet.public_metrics)
```

### Direct Messages

```python
# Read DMs
resp = client.get_dm_events(
    max_results=20,
    dm_event_fields=["id", "text", "sender_id", "created_at", "dm_conversation_id"],
)

# Send DM
client.create_direct_message(participant_id=user_id, text="Hello!")
```

### Timeline

```python
resp = client.get_home_timeline(
    max_results=20,
    tweet_fields=["created_at", "public_metrics"],
    expansions=["author_id"],
    user_fields=["username", "name"],
)
```

### Search

```python
resp = client.search_recent_tweets(
    query="search terms",
    max_results=20,
    tweet_fields=["created_at", "public_metrics"],
    expansions=["author_id"],
    user_fields=["username", "name", "description"],
)
```

### Followers

```python
resp = client.get_users_followers(
    id=user_id,
    max_results=100,
    user_fields=["username", "name", "description", "public_metrics"],
)
```

## Data Fields

**Tweet:** `id`, `text`, `created_at`, `author_id`, `public_metrics` (`like_count`, `retweet_count`, `reply_count`, `quote_count`)

**User:** `id`, `username`, `name`, `description`, `public_metrics` (`followers_count`, `following_count`, `tweet_count`)

**DM:** `id`, `text`, `sender_id`, `created_at`, `dm_conversation_id`

## Creating the Tool

When you need X capabilities, use the `create-tool` skill to build X tools in `tools/`. Since tweepy is a Python library, the tool should shell out to a Python helper script. Consider creating:

1. `x-post` — post a tweet (text, optional image URL)
2. `x-thread` — post a thread (array of texts)
3. `x-mentions` — check recent mentions
4. `x-search` — search recent tweets
5. `x-reply` — reply to a tweet

Each tool should read `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_BEARER_TOKEN` from `process.env` and load account tokens from the saved JSON file.

## API Tier Notes

- **Free tier**: Post tweets, read own timeline (limited)
- **Basic tier** ($100/mo): Mentions, search, DMs, more volume
- **Pro tier** ($5000/mo): Full access, higher limits

Some endpoints return 403 if your app doesn't have the required access level — this is an API tier issue, not a code bug.

## Important Notes

- Tweet max length: 280 characters (or 25,000 for X Premium)
- Media upload uses v1.1 API (`api.media_upload()`), tweeting uses v2 (`client.create_tweet()`)
- Replace `\n` with actual newlines in tweet text (LLMs often escape them)
- Rate limits vary by endpoint and tier — tweepy handles 429 retries automatically
