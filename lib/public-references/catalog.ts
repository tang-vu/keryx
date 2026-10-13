import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceItem } from "../types";
import { fetchPublicText } from "../net/public-fetch";
import { ingestRssXml, type IngestedFeed } from "../ingest/rss";
import { ingestYoutubeMetadata, isApprovedYoutubeFeed } from "./youtube-feed";
import { canonicalUrl } from "../web-research/url-identity";
import type { PublicReferenceArchiveDb } from "./archive";

// These bound one transport/parse batch, never the lifetime size of the library.
export const PUBLIC_FEED_MAX_BYTES = 5_000_000;
export const PUBLIC_FEED_BATCH_ITEMS = 1000;
export const canonicalPublicArticleUrl = canonicalUrl;
export function publicReferenceItemId(referenceId: string, link: string): string {
  const canonical = canonicalPublicArticleUrl(link);
  if (!canonical) throw new Error("Invalid public article URL");
  return `public-item:${createHash("sha256").update(`${referenceId}\n${canonical}`).digest("hex")}`;
}

const publicUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Public references require credential-free HTTPS URLs");
export const publicReferenceItemSchema = z.object({
  id: z.string().regex(/^public-item:[a-f0-9]{64}$/),
  title: z.string().max(1000), summary: z.string().max(100_000),
  content: z.string().max(500_000), link: publicUrl,
  publishedAt: z.string().datetime().optional(),
  deliveryKind: z.enum(["full_text", "excerpt", "abstract", "metadata_only"]),
}).strict();
export const publicReferenceSchema = z.object({
  id: z.string().regex(/^public:[a-z0-9-]{1,80}$/),
  name: z.string().min(1).max(200), url: publicUrl, rssUrl: publicUrl,
  description: z.string().max(1000), tags: z.array(z.string().max(100)).max(20),
  active: z.boolean(), items: z.array(publicReferenceItemSchema).max(PUBLIC_FEED_BATCH_ITEMS),
  refreshedAt: z.string().datetime().optional(),
  archivedItemCount: z.number().int().nonnegative().optional(),
}).strict();
/** Public feed references carry no ownership, verification, wallet, pricing or registry authority. */
export type PublicReference = z.infer<typeof publicReferenceSchema>;
export const isPublicReferenceId = (id: string): boolean => id.startsWith("public:");
export interface PublicReferenceDb extends PublicReferenceArchiveDb {
  listPublicReferences?(): Promise<PublicReference[]>;
  getPublicReference?(id: string): Promise<PublicReference | null>;
  upsertPublicReference?(reference: PublicReference): Promise<void | { added: number; updated: number }>;
}

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
