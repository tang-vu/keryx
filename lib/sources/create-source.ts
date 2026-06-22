/**
 * createSource — register a content source (creator) and ingest its items.
 * Generates a creator wallet when one isn't supplied. Used by the seed script,
 * the /register flow, and RSS ingest.
 *
 * When PINATA_JWT + CONTENT_MASTER_KEY are set, item.content is encrypted with
 * AES-256-GCM and pinned to Pinata IPFS. The plaintext content field is cleared
 * (empty string) so it never lands in the DB in plaintext. Decryption only happens
 * inside settleThenServe's produce() after x402 settles.
 *
 * When either env var is unset (offline dev), content is stored as plaintext in the
 * DB — same behavior as before this phase.
 */

import { config } from "../config";
import type { Author, Source, SourceItem } from "../types";
import type { KeryxDB } from "../db";
import { getOrCreateWallet } from "./wallet-store";
import { hasPinata, pinEncrypted } from "../ipfs/pinata-client";
import { encryptContent, hasContentKey } from "../ipfs/content-crypto";

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
    createdAt: new Date().toISOString(),
  };

  await db.upsertSource(source);

  if (input.items?.length) {
    const ipfsActive = hasPinata() && hasContentKey();
    const items: SourceItem[] = await Promise.all(
      input.items.map(async (it) => {
        const itemId = crypto.randomUUID();
        if (!ipfsActive || !it.content) {
          // Offline dev or empty content — store plaintext in DB as before.
          return { ...it, id: itemId, sourceId: id };
        }

        try {
          const envelope = encryptContent(it.content);
          const cipherBuf = Buffer.from(envelope.cipherB64, "base64");
          const cid = await pinEncrypted(cipherBuf, `keryx-item-${itemId}.enc`);
          // Plaintext content cleared — it lives on IPFS as ciphertext only.
          return {
            ...it,
            id: itemId,
            sourceId: id,
            content: "",       // never stored in DB when IPFS path is active
            ipfsCid: cid,
            itemKeyEnc: envelope.wrappedKeyB64,
            itemIv: envelope.ivB64,
            itemAuthTag: envelope.authTagB64,
          };
        } catch (err) {
          // Encryption/pin failure: fall back to plaintext DB storage and log.
          // Content is still served — just not IPFS-gated for this item.
          console.warn(`[ipfs] encrypt+pin failed for item ${itemId}, falling back to DB:`, err);
          return { ...it, id: itemId, sourceId: id };
        }
      }),
    );
    await db.addItems(items);
  }

  return source;
}
