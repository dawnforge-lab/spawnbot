import Parser from "rss-parser"
import { PollerManager } from "@/autonomy/poller"

const parser = new Parser()

export interface RssPollerConfig {
  /** Feed URL to poll */
  url: string
  /** Override default interval in seconds */
  interval?: number
  /** Human-readable label for this feed */
  label?: string
}

export function createRssPoller(config: RssPollerConfig): PollerManager.Poller {
  const label = config.label ?? new URL(config.url).hostname

  return {
    name: `rss/${label}`,
    defaultInterval: config.interval ?? 600,
    async poll(lastState) {
      const lastSeen = (lastState.lastPubDate as number) ?? 0

      const feed = await parser.parseURL(config.url)
      const newItems = feed.items.filter(
        (item) => new Date(item.pubDate ?? 0).getTime() > lastSeen,
      )

      const events: PollerManager.PollEvent[] = newItems.map((item) => ({
        content: `New post from ${feed.title ?? label}: "${item.title}"\n${item.link}\n\n${item.contentSnippet ?? ""}`,
        priority: "normal" as const,
        sender: feed.title ?? label,
        metadata: { url: item.link, title: item.title, feed: config.url },
      }))

      const maxDate = newItems.reduce(
        (max, item) => Math.max(max, new Date(item.pubDate ?? 0).getTime()),
        lastSeen,
      )

      return {
        events,
        newState: { lastPubDate: maxDate },
      }
    },
  }
}
