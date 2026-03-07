---
name: create-poller
description: "Create a new poller plugin to monitor an external service. Use when the user asks you to watch, monitor, or poll an external source like RSS feeds, APIs, websites, or social media."
---

# Creating Poller Plugins

A poller is a TypeScript module that periodically checks an external service and feeds events into your input queue. The PollerManager handles scheduling, state persistence, and event routing.

## The Poller Interface

```typescript
import { PollerManager } from "@/autonomy/poller"

const myPoller: PollerManager.Poller = {
  name: "my-poller",
  defaultInterval: 300, // seconds between polls
  async poll(lastState) {
    // lastState is persisted across polls and restarts
    // Check your external source for new items
    // Return events + updated state
    return {
      events: [
        {
          content: "Description of what happened",
          priority: "normal", // "critical" | "high" | "normal" | "low"
          sender: "source-name",
          metadata: { /* any extra data */ },
        },
      ],
      newState: { lastSeenId: "abc123" },
    }
  },
}
```

## Where to Create

Write to `.spawnbot/pollers/<name>.ts`:

```
.spawnbot/pollers/
  rss-feed.ts
  website-monitor.ts
```

## Registration

Register the poller in `.spawnbot/pollers/index.ts` or call directly:

```typescript
import { PollerManager } from "@/autonomy/poller"

// Register with default interval
await PollerManager.register(myPoller)

// Or override the interval (seconds)
await PollerManager.register(myPoller, 60)
```

## State Management

- `lastState` is an object persisted to SQLite between polls
- Use it to track cursors like "last seen ID", "last checked timestamp", etc.
- Return `newState` from every `poll()` call — it replaces the previous state
- On first run, `lastState` is `{}`

## Key Rules

- **Return empty events array** when there's nothing new — don't generate noise
- **Use state for deduplication** — track what you've already seen
- **Set appropriate priority** — most polled events are "normal", reserve "high"/"critical" for urgent items
- **Handle errors** — the manager catches exceptions, but clean error handling prevents partial state corruption
- **Keep polls fast** — don't do heavy processing in `poll()`, just fetch and filter
- **Install dependencies first** — if your poller needs an npm package (e.g., `rss-parser`), install it before creating the file

## Example: RSS Feed Poller

```typescript
import Parser from "rss-parser"
import { PollerManager } from "@/autonomy/poller"

const parser = new Parser()

const rssPoller: PollerManager.Poller = {
  name: "rss-feed",
  defaultInterval: 600, // 10 minutes
  async poll(lastState) {
    const feedUrl = lastState.feedUrl ?? "https://example.com/feed.xml"
    const lastSeen = lastState.lastPubDate ?? 0

    const feed = await parser.parseURL(feedUrl)
    const newItems = feed.items.filter(
      (item) => new Date(item.pubDate ?? 0).getTime() > lastSeen
    )

    const events: PollerManager.PollEvent[] = newItems.map((item) => ({
      content: `New post: "${item.title}"\n${item.link}\n\n${item.contentSnippet ?? ""}`,
      priority: "normal" as const,
      sender: feed.title ?? "RSS",
      metadata: { url: item.link, title: item.title },
    }))

    const maxDate = newItems.reduce(
      (max, item) => Math.max(max, new Date(item.pubDate ?? 0).getTime()),
      lastSeen
    )

    return {
      events,
      newState: { ...lastState, lastPubDate: maxDate },
    }
  },
}

export default rssPoller
```
