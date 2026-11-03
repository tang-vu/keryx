import type { SourceItem } from "../types";
import { fetchPublicText } from "../net/public-fetch";
import { ingestRssXml, type IngestedFeed } from "../ingest/rss";
import { ingestYoutubeMetadata, isApprovedYoutubeFeed } from "./youtube-feed";
import { PUBLIC_FEED_MAX_BYTES, PUBLIC_FEED_BATCH_ITEMS } from "./limits";

import { canonicalPublicArticleUrl, publicReferenceItemId, publicReferenceSchema, type PublicReference } from "./catalog-contract";
export { canonicalPublicArticleUrl, publicReferenceItemId, publicReferenceItemSchema, publicReferenceSchema, isPublicReferenceId,
  PUBLIC_FEED_MAX_BYTES, PUBLIC_FEED_BATCH_ITEMS, type PublicReference, type PublicReferenceDb } from "./catalog-contract";

export async function fetchPublicReferenceFeed(url: string, fetchText: typeof fetchPublicText = fetchPublicText): Promise<IngestedFeed> {
  const xml = await fetchText(url, {
    timeoutMs: 12_000, maxBytes: PUBLIC_FEED_MAX_BYTES, maxHops: 3,
  });
  if (isApprovedYoutubeFeed(url)) return ingestYoutubeMetadata(xml, url);
  // Read one sentinel beyond the processing batch. A bigger feed must not be
  // reported as a complete refresh after silently discarding its older entries.
  const feed = await ingestRssXml(xml, url, PUBLIC_FEED_BATCH_ITEMS + 1);
  if (feed.items.length > PUBLIC_FEED_BATCH_ITEMS) throw new Error("Public feed exceeds one processing batch; use resumable historical backfill");
  return feed;
}

export function referenceSnapshot(reference: PublicReference, feed: IngestedFeed): PublicReference {
  const seen = new Set<string>();
  if (feed.items.length > PUBLIC_FEED_BATCH_ITEMS) throw new Error("Public feed batch exceeds processing capacity");
  const items = feed.items.flatMap((item) => {
    // A feed can contain arbitrary link schemes. Never render those or follow article links.
    const link = canonicalPublicArticleUrl(item.link);
    if (!item.content.trim() || !link || seen.has(link)) return [];
    seen.add(link);
    return [{
      id: publicReferenceItemId(reference.id, link),
      title: item.title.slice(0, 1000), summary: item.summary.slice(0, 100_000),
      // The current preview keeps the publisher's exact URL for newest-entry
      // observation. The archive separately binds its canonical dedupe identity.
      content: item.content.slice(0, 500_000), link: item.link,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      deliveryKind: item.deliveryKind ?? "excerpt" as const,
    }];
  });
  return publicReferenceSchema.parse({ ...reference, items, refreshedAt: new Date().toISOString() });
}

/** Adapter for article selection/version hashing only; never passed to paid storage or delivery. */
export function referenceItems(reference: PublicReference): SourceItem[] {
  return reference.items.map((item) => ({ ...item, sourceId: reference.id }));
}
