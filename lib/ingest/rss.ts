/**
 * RSS ingest — turn any feed (a blog, or an RSSHub-generated feed for almost any site)
 * into purchasable Keryx content. Free preview = title + summary; paid content = full text.
 */

import Parser from "rss-parser";
import type { SourceItem } from "../types";

const parser = new Parser({ timeout: 15000 });

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface IngestedFeed {
  feedTitle: string;
  feedDescription: string;
  link: string;
  items: Omit<SourceItem, "id" | "sourceId">[];
}

export async function ingestRss(rssUrl: string, max = 10): Promise<IngestedFeed> {
  const feed = await parser.parseURL(rssUrl);
  const items = (feed.items ?? []).slice(0, max).map((it) => {
    const full = stripHtml(
      (it as { "content:encoded"?: string })["content:encoded"] ??
        it.content ??
        it.contentSnippet ??
        "",
    );
    const summary = stripHtml(it.contentSnippet ?? it.content ?? "").slice(0, 280);
    return {
      title: it.title?.trim() || "Untitled",
      summary: summary || full.slice(0, 280),
      content: full || summary,
      link: it.link ?? "",
      publishedAt: it.isoDate ?? it.pubDate ?? undefined,
    };
  });
  return {
    feedTitle: feed.title?.trim() || rssUrl,
    feedDescription: stripHtml(feed.description ?? "").slice(0, 400),
    link: feed.link ?? rssUrl,
    items,
  };
}
