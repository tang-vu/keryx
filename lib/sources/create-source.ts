/**
 * createSource — register a content source (creator) and ingest its items.
 * Generates a creator wallet when one isn't supplied. Used by the seed script,
 * the /register flow, and RSS ingest.
 *
 * Item content is encrypted with AES-256-GCM before durable storage. Pinata deployments keep
 * ciphertext on IPFS; otherwise the private DB content column keeps ciphertext plus the same
 * envelope. Decryption only happens inside settleThenServe's produce() after x402 settles.
 *
 * Explicit offline development may store labeled plaintext. A production or treasury-funded
 * process fails closed when CONTENT_MASTER_KEY is missing.
 */

import { config } from "../config";
import type { Author, Source, SourceItem } from "../types";
import type { KeryxDB } from "../db";
import { getOrCreateWallet } from "./wallet-store";
import { storeSourceItems } from "./store-source-item";

export interface CreateSourceInput {
  name: string;
  url: string;
  description: string;
  rssUrl?: string;
  tags?: string[];
  fetchPrice?: number;
  walletAddress?: string; // creator-supplied; generated if omitted
  authors?: { name: string; walletAddress?: string; splitWeight: number }[];
  items?: Omit<SourceItem, "id" | "sourceId">[];
  /** Feed-ownership gate. Omitted → true (operator-curated seed + offline dev are trusted).
   *  Public web submissions pass false until they prove control of the feed. */
  verified?: boolean;
  /** Free-preview depth ("full" | "excerpt" | "locked"). Omitted → "full". */
  previewDepth?: import("./preview-depth").PreviewDepth;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "source"
  );
}

export async function createSource(
  db: KeryxDB,
  input: CreateSourceInput,
): Promise<Source> {
  const id = `${slugify(input.name)}-${crypto.randomUUID().slice(0, 6)}`;
  const walletAddress =
    input.walletAddress ?? getOrCreateWallet(id).address;

  const authors: Author[] = (input.authors?.length
    ? input.authors
    : [{ name: input.name, walletAddress, splitWeight: 1 }]
  ).map((a, i) => ({
    name: a.name,
    walletAddress:
      a.walletAddress ?? getOrCreateWallet(`${id}:author-${i}`).address,
    splitWeight: a.splitWeight,
  }));

  const source: Source = {
    id,
    name: input.name,
    url: input.url,
    description: input.description,
    rssUrl: input.rssUrl,
    walletAddress,
    fetchPrice: input.fetchPrice ?? config.defaultFetchPrice,
    tags: input.tags ?? [],
    authors,
    // Trusted by default (seed/offline); the public register route passes false until proven.
    verified: input.verified ?? true,
    previewDepth: input.previewDepth,
    createdAt: new Date().toISOString(),
  };

  // Complete every external encryption/pin operation before publishing the source row. A missing
  // production storage dependency must not leave a half-registered publication with no articles.
  const items: SourceItem[] = input.items?.length
    ? await storeSourceItems(
      input.items.map((it) => ({ ...it, id: crypto.randomUUID(), sourceId: id })),
    )
    : [];

  await db.upsertSource(source);
  if (items.length) await db.addItems(items);

  return source;
}
