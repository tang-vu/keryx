import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceItem } from "../types";
import { fetchPublicText } from "../net/public-fetch";
import { ingestRssXml, type IngestedFeed } from "../ingest/rss";

const publicUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Public references require credential-free HTTPS URLs");
const itemSchema = z.object({
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
  active: z.boolean(), items: z.array(itemSchema).max(10),
  refreshedAt: z.string().datetime().optional(),
}).strict();
/** Public feed references carry no ownership, verification, wallet, pricing or registry authority. */
export type PublicReference = z.infer<typeof publicReferenceSchema>;
export const isPublicReferenceId = (id: string): boolean => id.startsWith("public:");
export interface PublicReferenceDb {
  listPublicReferences?(): Promise<PublicReference[]>;
  getPublicReference?(id: string): Promise<PublicReference | null>;
  upsertPublicReference?(reference: PublicReference): Promise<void>;
}

export async function fetchPublicReferenceFeed(url: string): Promise<IngestedFeed> {
  return ingestRssXml(await fetchPublicText(url, {
    timeoutMs: 12_000, maxBytes: 500_000, maxHops: 3,
  }), url, 10);
}

export function referenceSnapshot(reference: PublicReference, feed: IngestedFeed): PublicReference {
  const seen = new Set<string>();
  const items = feed.items.slice(0, 10).flatMap((item) => {
    // A feed can contain arbitrary link schemes. Never render those or follow article links.
    if (!item.content.trim() || !publicUrl.safeParse(item.link).success || seen.has(item.link)) return [];
    seen.add(item.link);
    return [{
      id: `public-item:${createHash("sha256").update(`${reference.id}\n${item.link}`).digest("hex")}`,
      title: item.title.slice(0, 1000), summary: item.summary.slice(0, 100_000),
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
