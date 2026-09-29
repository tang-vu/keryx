import type { Address, Hex } from "viem";
import { config } from "@/lib/config";
import { getRegistrySource, sourceId } from "@/lib/registry/registry-client";
import type { Source } from "@/lib/types";

const PAGE_SIZE = 12;
const MAX_CONCURRENT_READS = 4;
const REGISTRY_TIMEOUT_MS = 4_000;

export class ListingDiscoveryError extends Error {
  constructor(public readonly publicMessage: string) {
    super(publicMessage);
  }
}

export interface CreatorListingsPage {
  listings: Source[];
  nextCursor: string | null;
  /** Count of rows on this page whose live ownership could not be established. */
  uncertain: number;
}

/** Fresh registry-verified public listing references, with bounded reads per page. */
export async function discoverCreatorListings(
  sources: Source[],
  creator: string,
  cursor: string | null = null,
): Promise<CreatorListingsPage> {
  const address = creator.toLowerCase() as Address;
  // SourceRegistry ids bind the creator to the canonical registration URL. A row without
  // off-chain URL metadata cannot be narrowed this way, so visit it through pagination.
  const candidates = sources.filter((source) => {
    if (!source.onchainId) return false;
    const urls = [source.url, source.rssUrl].filter((url): url is string => Boolean(url?.trim()));
    return urls.length === 0 || urls.some((url) =>
      sourceId(address, url).toLowerCase() === source.onchainId!.toLowerCase());
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const remaining = cursor === null ? candidates : candidates.filter((source) => source.id > cursor);
  const page = remaining.slice(0, PAGE_SIZE);
  if (page.length === 0) return { listings: [], nextCursor: null, uncertain: 0 };

  if (!config.registryAddress ||
    config.registryAddress.toLowerCase() !== config.registryReadAddress.toLowerCase()) {
    throw new ListingDiscoveryError("Creator discovery requires matching registry read and write addresses.");
  }

  const results: Array<Source | null> = new Array(page.length).fill(null);
  let uncertain = 0;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < page.length) {
      const index = nextIndex++;
      const source = page[index];
      try {
        const record = await getRegistrySource(source.onchainId as Hex, { timeoutMs: REGISTRY_TIMEOUT_MS });
        if (record?.creator.toLowerCase() === address) {
          results[index] = { ...source, active: record.active };
        } else if (record && (source.url || source.rssUrl)) {
          // A locally matching id with a different registry creator is inconsistent.
          uncertain++;
        }
      } catch {
        // No cached payout, author, or guessed creator grants access on a failed read.
        uncertain++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_READS, page.length) }, () => worker()));
  return {
    listings: results.filter((result): result is Source => result !== null),
    nextCursor: remaining.length > page.length ? page[page.length - 1].id : null,
    uncertain,
  };
}
