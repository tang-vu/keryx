/**
 * Is a cached copy of a source still the source?
 *
 * The agent may reuse content it already paid for — that is the honest half of "cache": no creator
 * should be charged twice for the same text. But `cache_items` holds exactly one blob per source
 * with no expiry, so "already paid once" silently became "never pay again". Measured on production:
 * one source was weighed in 396 dispatches, read 383 times, and bought **zero** times — every read
 * served a copy taken before it published anything it has published since. Two things break at once:
 * the fetch-toll rail dies the moment a source is first bought, and the answers are synthesized from
 * text the source has moved past, while the freshness note on the archive tells readers it moved.
 *
 * The rule here is the narrowest one that fixes both: a cached copy is fresh until the source
 * publishes something newer than the copy. Nothing is invalidated on a timer — an inactive feed's
 * cache stays valid forever, which is correct, because nothing about it has changed. The cost is
 * therefore self-limiting: one fresh toll per source per batch of new posts, not one per dispatch.
 *
 * The date rules match answers-freshness deliberately (same `clampedNewest`): publication dates
 * only, future dates ignored (a feed with a bad timezone must not force a re-buy every run), and
 * undated items never count — they cannot prove they are new.
 */

import { clampedNewest } from "../answers-freshness";
import type { SourceItem } from "../types";

/**
 * True when `cachedAt` is a usable copy to read for free. False means "nothing cached" or
 * "the source published since" — both of which should send the agent to a paid fetch.
 */
export function isCacheFresh(
  cachedAt: string | null,
  newestPublished: string | undefined,
  now: number,
): boolean {
  if (!cachedAt) return false;
  const cached = Date.parse(cachedAt);
  if (!Number.isFinite(cached)) return false; // unreadable timestamp: re-buy rather than guess
  const newest = clampedNewest(newestPublished, now);
  if (newest === null) return true; // nothing dated can prove the copy is behind
  return newest <= cached;
}

/** Newest publication date among a source's items. `getItems` returns newest-first. */
export function newestPublishedAt(items: SourceItem[]): string | undefined {
  for (const item of items) if (item.publishedAt) return item.publishedAt;
  return undefined;
}
