/**
 * createSource — register a content source (creator) and ingest its items.
 * Generates a creator wallet when one isn't supplied. Used by the seed script,
 * the /register flow, and RSS ingest.
 */

import { config } from "../config";
import type { Author, Source, SourceItem } from "../types";
import type { KeryxDB } from "../db";
import { getOrCreateWallet } from "./wallet-store";

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
    createdAt: new Date().toISOString(),
  };

  await db.upsertSource(source);

  if (input.items?.length) {
    const items: SourceItem[] = input.items.map((it) => ({
      ...it,
      id: crypto.randomUUID(),
      sourceId: id,
    }));
    await db.addItems(items);
  }

  return source;
}
