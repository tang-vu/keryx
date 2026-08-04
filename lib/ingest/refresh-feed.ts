/**
 * Feed refresh — re-ingest a source's RSS feed after registration so new posts become
 * purchasable. Registration ingests a feed exactly once; without a refresh path, a listed
 * blog is frozen at its register-day snapshot and new posts can never be discovered, read,
 * cited, or paid.
 *
 * Dedupe is by item link against what the DB already holds (the same rule the registry claim
 * path uses in prepare-registration). Items without a link are skipped: they cannot be
 * deduped, so re-adding them on every refresh would shelve duplicates.
 */

import { ingestRss, type IngestedFeed } from "./rss";
import type { Source, SourceItem } from "@/lib/types";

/** The narrow slice of KeryxDB refresh needs — keeps the module trivially testable. */
export interface RefreshDb {
  getItems(sourceId: string): Promise<SourceItem[]>;
  addItems(items: SourceItem[]): Promise<void>;
}

export interface RefreshOutcome {
  sourceId: string;
  name: string;
  /** New posts written this pass. */
  added: number;
  /** Items the source holds after the pass. */
  total: number;
  /** Ingest failed (network, malformed feed) — nothing was written. */
  error?: string;
}

type Ingest = (rssUrl: string) => Promise<IngestedFeed>;

/** Preserve the transport cause Undici attaches below its generic `fetch failed` wrapper. */
function feedError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

/** Re-fetch one source's feed and add anything the DB has never seen. Never throws for
 *  feed-side problems — those come back as { error } so a sweep can record them per-source. */
export async function refreshSourceFeed(
  db: RefreshDb,
  source: Pick<Source, "id" | "name" | "rssUrl">,
  ingest: Ingest = ingestRss,
): Promise<RefreshOutcome> {
  const existing = await db.getItems(source.id);
  const base = { sourceId: source.id, name: source.name, total: existing.length };
  if (!source.rssUrl?.trim()) return { ...base, added: 0, error: "source has no feed" };

  let feed: IngestedFeed;
  try {
    feed = await ingest(source.rssUrl.trim());
  } catch (err) {
    return { ...base, added: 0, error: feedError(err) };
  }

  const seen = new Set(existing.map((i) => i.link).filter(Boolean));
  const unseen = feed.items.filter((it) => it.link && !seen.has(it.link));
  if (unseen.length > 0) {
    await db.addItems(
      unseen.map((it) => ({ ...it, id: crypto.randomUUID(), sourceId: source.id })),
    );
  }
  return { ...base, added: unseen.length, total: existing.length + unseen.length };
}

/** Sweep every refreshable source, sequentially — this runs from the always-on daemon against
 *  third-party blog hosts, so it must look like a polite crawler, not a burst. */
export async function refreshAllFeeds(
  db: RefreshDb & { listSources(): Promise<Source[]> },
  ingest: Ingest = ingestRss,
): Promise<RefreshOutcome[]> {
  // listSources() already excludes deactivated rows. Unverified rows are excluded here too:
  // nobody has proven they own that feed, and a squatter's listing must not make Keryx crawl it.
  const sources = (await db.listSources()).filter(
    (s) => s.verified !== false && s.rssUrl?.trim(),
  );
  const out: RefreshOutcome[] = [];
  for (const s of sources) out.push(await refreshSourceFeed(db, s, ingest));
  return out;
}
