/** Public catalog data contract only. No network, storage or financial authority. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalUrl } from "../web-research/url-identity";
import { PUBLIC_FEED_BATCH_ITEMS } from "./limits";
import type { PublicReferenceArchiveDb } from "./archive";
export { PUBLIC_FEED_MAX_BYTES, PUBLIC_FEED_BATCH_ITEMS } from "./limits";
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
