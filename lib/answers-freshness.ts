/**
 * Answer freshness — has the material under an archived answer moved on since it settled?
 *
 * A dispatch is a finished record: it read what its sources held that minute, paid for it, and
 * stopped. The sources keep publishing. Nothing in Keryx noticed, so a two-week-old answer read
 * exactly like one minted five minutes ago — the archive's one real quality risk now that it is
 * the way strangers arrive.
 *
 * This module answers the narrow, provable question: **how many posts have the sources this answer
 * cited published since it settled?** Nothing here judges whether those posts would change the
 * answer — that costs a paid re-read, which is the reader's call to make, not ours to guess. The
 * signal is a count and an invitation, never a verdict on the answer's correctness.
 *
 * Deliberate limits, so the note can never overclaim:
 *  - **Publication dates, not ingest dates.** `source_items` records when a post was published,
 *    which is what a reader means by "new" anyway. A source that backfills old posts after the
 *    dispatch therefore stays quiet here.
 *  - **Items dated in the future are ignored** (see `clampedNewest`). Feeds do get timezones
 *    wrong, and one bad date must not pin an answer to "stale" forever.
 *  - **Undated items don't count.** They cannot prove they are new.
 *  - **Only sources still on sale count.** A delisted source's new posts are not material anyone
 *    can buy, so inviting a re-ask over them would be a dead end.
 *    (Callers filter the ids; see app/dispatch/[id]/page.tsx.)
 */

import type { Citation, QueryRun } from "./types";
import type { KeryxDB } from "./db/keryx-db";
import { checkCitedVersions, type CitedVersionCheck } from "./answers-version-audit";

/** One cited source that has published since the dispatch. */
export interface FreshSource {
  sourceId: string;
  name: string;
  /** Posts published after the dispatch settled (and not dated in the future). */
  newItems: number;
}

/** What the freshness note on a dispatch renders from. */
export interface Freshness {
  /** Distinct cited sources considered — the denominator the note quotes. */
  citedCount: number;
  /**
   * How many of those list a feed, i.e. how many Keryx actually re-reads. Silence from a source
   * nobody polls is not evidence it published nothing, so "still current" may only be claimed over
   * these. Without this the note would reassure a reader about sources it never checked.
   */
  watchedCount: number;
  /** Total new posts across those sources. */
  newItems: number;
  /** Only the sources that moved, busiest first, then by name for a stable order. */
  sources: FreshSource[];
  /** Citations new enough to carry both item id and exact paid content version. */
  versionedCitations: number;
  /** Exact versions that still match Keryx's current indexed article asset. */
  currentVersions: number;
  /** Same article identity, but its currently indexed immutable version has changed. */
  supersededVersions: number;
  /** Exact citation receipts whose current article asset could not be loaded. */
  unavailableVersions: number;
  /** Per-citation machine-readable version audit. Historical source-level citations are omitted. */
  versions: CitedVersionCheck[];
  /** Source records that failed to load. Missing/deactivated sources are not failures. */
  unavailableSourceChecks: number;
  /** Whether the publication-date query completed. */
  publicationCheck: "complete" | "unavailable" | "not_applicable";
}

/**
 * The distinct sources a dispatch cited, in first-cited order. A source can carry several
 * citation markers in one answer; the freshness note counts sources, not markers.
 */
export function citedSourceIds(citations: Citation[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const c of citations) {
    if (!c.sourceId || seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);
    ids.push(c.sourceId);
  }
  return ids;
}

/**
 * Fold per-source counts (from `countItemsPublishedBetween`) onto the citations of one dispatch.
 * `counts` is expected to be keyed by source id and already windowed to (settled, now]; sources
 * absent from it simply have not published.
 */
export function freshnessOf(
  citations: Citation[],
  counts: Record<string, number>,
  watched: ReadonlySet<string> = new Set(),
  versions: CitedVersionCheck[] = [],
  checks: {
    unavailableSourceChecks?: number;
    publicationCheck?: Freshness["publicationCheck"];
  } = {},
): Freshness {
  const names = new Map<string, string>();
  for (const c of citations) if (c.sourceId && !names.has(c.sourceId)) names.set(c.sourceId, c.sourceName);

  const sources: FreshSource[] = [];
  for (const [sourceId, name] of names) {
    const newItems = counts[sourceId] ?? 0;
    if (newItems > 0) sources.push({ sourceId, name, newItems });
  }
  sources.sort((a, b) => b.newItems - a.newItems || a.name.localeCompare(b.name));

  return {
    citedCount: names.size,
    watchedCount: [...names.keys()].filter((id) => watched.has(id)).length,
    newItems: sources.reduce((n, s) => n + s.newItems, 0),
    sources,
    versionedCitations: versions.length,
    currentVersions: versions.filter((item) => item.status === "current").length,
    supersededVersions: versions.filter((item) => item.status === "superseded").length,
    unavailableVersions: versions.filter((item) => item.status === "unavailable").length,
    versions,
    unavailableSourceChecks: checks.unavailableSourceChecks ?? 0,
    publicationCheck: checks.publicationCheck ?? "not_applicable",
  };
}

const EMPTY: Freshness = {
  citedCount: 0,
  watchedCount: 0,
  newItems: 0,
  sources: [],
  versionedCitations: 0,
  currentVersions: 0,
  supersededVersions: 0,
  unavailableVersions: 0,
  versions: [],
  unavailableSourceChecks: 0,
  publicationCheck: "not_applicable",
};

/**
 * Read the freshness of one dispatch. Type-only DB import, so this stays testable with a plain
 * object standing in for the adapter.
 *
 * Sources that are gone, deactivated or unverified are dropped before anything is counted: those
 * are exactly the sources a re-ask could not buy from, so counting their posts would advertise
 * material nobody can reach. That also makes `citedCount` the honest denominator — "2 of the 3
 * sources this answer cited" means three sources are still on sale.
 */
export async function loadFreshness(
  db: KeryxDB,
  run: Pick<QueryRun, "citations" | "createdAt">,
  now: number = Date.now(),
): Promise<Freshness> {
  const citations = run.citations ?? [];
  const ids = citedSourceIds(citations);
  if (ids.length === 0) return EMPTY;

  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        return { source: await db.getSource(id), unavailable: false };
      } catch {
        return { source: null, unavailable: true };
      }
    }),
  );
  const unavailableSourceChecks = rows.filter((row) => row.unavailable).length;
  const live = rows
    .map((row) => row.source)
    .filter((s) => s && s.active !== false && s.verified !== false);
  const onSale = new Set(live.map((s) => s!.id));
  if (onSale.size === 0) {
    return unavailableSourceChecks > 0
      ? { ...EMPTY, unavailableSourceChecks }
      : EMPTY;
  }
  // A source with no feed is one Keryx never re-reads, so its silence proves nothing.
  const watched = new Set(live.filter((s) => s!.rssUrl).map((s) => s!.id));

  const liveCitations = citations.filter((c) => onSale.has(c.sourceId));
  const [countResult, versions] = await Promise.all([
    db
      .countItemsPublishedBetween([...onSale], run.createdAt, new Date(now).toISOString())
      .then((counts) => ({ counts, available: true as const }))
      .catch(() => ({ counts: {} as Record<string, number>, available: false as const })),
    checkCitedVersions(db, liveCitations),
  ]);
  return freshnessOf(
    liveCitations,
    countResult.counts,
    watched,
    versions,
    {
      unavailableSourceChecks,
      publicationCheck: countResult.available ? "complete" : "unavailable",
    },
  );
}

/**
 * List-view form of the same question, answered from one "newest post per source" map instead of a
 * count query per row — a ledger of 50 dispatches must not cost 50 queries.
 *
 * True when any cited source's newest usable post lands after `runCreatedAt`. Says *that* something
 * new exists, never how much.
 */
export function hasNewMaterial(
  citations: Citation[],
  newestBySource: Record<string, string>,
  runCreatedAt: string,
  now: number = Date.now(),
): boolean {
  const settled = Date.parse(runCreatedAt);
  if (!Number.isFinite(settled)) return false; // an unreadable run date proves nothing
  return citedSourceIds(citations).some((id) => {
    const newest = clampedNewest(newestBySource[id], now);
    return newest !== null && newest > settled;
  });
}

/**
 * Parse a stored publication date, rejecting anything unusable: absent, unparseable, or dated in
 * the future. Returned as epoch ms so callers compare numbers, not strings of mixed shape.
 */
export function clampedNewest(published: string | undefined, now: number): number | null {
  if (!published) return null;
  const at = Date.parse(published);
  if (!Number.isFinite(at) || at > now) return null;
  return at;
}
