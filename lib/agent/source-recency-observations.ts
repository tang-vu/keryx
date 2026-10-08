import type { SourceItem, SourceItemIdentity } from "../types";
import { selectCurrentFeedCatalogItem } from "../sources/retained-recency-adapter";
import { createSourceRecencyFeedObserver, type SourceRecencyFeedObservation } from "../sources/source-recency-feed";
import { sourceRecencyFeedUrl, type SourceRecencyFeedEntry } from "../sources/source-recency-feed-parser";
import { sourceRecencyGap, type SourceRecencyRequirement, type SourceRecencyGap,
  type SourceRecencyFeedMetadata } from "../sources/source-recency";

export interface SourceRecencySourceView {
  readonly id: string;
  readonly name: string;
  readonly rssUrl?: string;
  readonly url?: string;
}
export type SourceRecencyCatalogLookup = (sourceId: string, exactItemUrl: string,
  signal?: AbortSignal) => Promise<SourceItem | null>;
export type SourceRecencyResolution = Readonly<{ status: "unaffected" }> |
  Readonly<{ status: "withheld"; gap: Readonly<SourceRecencyGap> }> |
  Readonly<{ status: "eligible"; selected: Readonly<SourceItem>; identity: Readonly<SourceItemIdentity>;
    observation: Readonly<SourceRecencyFeedMetadata> }>;
export interface SourceRecencyResolver {
  readonly readsUsed: number;
  resolve(source: SourceRecencySourceView, lookup: SourceRecencyCatalogLookup): Promise<SourceRecencyResolution>;
}

function portableObservation(observation: SourceRecencyFeedObservation, entry: SourceRecencyFeedEntry): Readonly<SourceRecencyFeedMetadata> {
  // Explicit allowlist: never spread a capability, catalog item, source, price or payout fields.
  return Object.freeze({ scope: "current-feed", criterion: "explicit-publication-date",
    sourceId: observation.requestScope.sourceId, feedUrl: observation.requestScope.feedUrl,
    capturedAt: observation.capturedAt, observationDigest: observation.observationDigest,
    rawBodySha256: observation.rawBodySha256, membership: "complete-document", membershipCount: observation.entries.length,
    filteredCount: 0, truncated: false, ...(observation.nativeFeedId ? { nativeFeedId: observation.nativeFeedId } : {}),
    newestEntry: Object.freeze({ title: entry.title!, itemUrl: entry.itemUrl!,
      ...(entry.nativeId ? { nativeId: Object.freeze({ field: entry.nativeId.field, rawValue: entry.nativeId.rawValue }) } : {}),
      publication: Object.freeze({ field: entry.publication.field, rawValue: entry.publication.rawValues[0], publishedAt: entry.publication.publishedAt! }),
      entryMetadataVersion: entry.entryMetadataVersion }) });
}

/**
 * Construct once from the trusted original caller requirement. Omitted/false enablement keeps
 * old holds without GET; root enables only ordinary public runs and grants existing attention.
 * Tests mock transport rather than adding any observer/public-JSON injection contract.
 */
export function createSourceRecencyResolver(requirement: SourceRecencyRequirement | null,
  options: { enabled?: boolean; maxReads: number; signal?: AbortSignal;
    wanted?: Readonly<{ sourceId: string; itemId: string; contentVersion: string }> },
): SourceRecencyResolver {
  const original = requirement ? Object.freeze({ ...requirement, feedUrls: Object.freeze([...requirement.feedUrls]),
    originalSpan: Object.freeze({ ...requirement.originalSpan }) }) : null;
  const enabled = options.enabled === true, signal = options.signal;
  const wanted = options.wanted ? Object.freeze({ ...options.wanted }) : undefined;
  const observer = createSourceRecencyFeedObserver({ maxReads: enabled ? options.maxReads : 0 });
  const outcomes = new Map<string, { binding: string; firstSource: Readonly<SourceRecencySourceView>;
    result: Promise<SourceRecencyResolution>; mismatch?: SourceRecencyResolution }>();
  const unaffected = Object.freeze({ status: "unaffected" as const });
  const withheld = (gap: SourceRecencyGap): SourceRecencyResolution => Object.freeze({ status: "withheld", gap: Object.freeze(gap) });

  async function resolveOnce(source: Readonly<SourceRecencySourceView>, lookup: SourceRecencyCatalogLookup): Promise<SourceRecencyResolution> {
    const gap = sourceRecencyGap(original, source);
    if (!gap) return unaffected;
    if (!enabled || original?.status !== "explicit-single-feed" || original.binding !== "exact-feeds" ||
      original.feedUrls.length !== 1) return withheld(gap);
    if (signal?.aborted) return withheld({ ...gap, reason: "cancelled" });
    // Legacy resource-URL equality is refusal scope. Do not invent its RSS enrollment.
    if (sourceRecencyFeedUrl(source.rssUrl ?? "") !== original.feedUrls[0]) return withheld({ ...gap, reason: "source-mismatch" });
    const read = await observer.observe({ scope: "current-feed", sourceId: source.id, feedUrl: original.feedUrls[0] }, { signal });
    if (read.status === "withheld") return withheld({ ...gap, reason: read.reason });
    const selection = await selectCurrentFeedCatalogItem({ kind: "newest-feed-entry", scope: "current-feed",
      criterion: "explicit-publication-date", sourceId: source.id, feedUrl: original.feedUrls[0], runId: observer.runId },
    read.observation, source, lookup, { signal, wanted });
    if (selection.status === "withheld") return withheld({ ...gap, reason: selection.reason,
      ...(selection.reason === "newest-entry-not-indexed" && selection.feedEntry ?
        { observation: portableObservation(read.observation, selection.feedEntry) } : {}) });
    return Object.freeze({ status: "eligible", selected: selection.selected, identity: selection.identity,
      observation: portableObservation(read.observation, selection.feedEntry) });
  }

  return Object.freeze({ get readsUsed() { return observer.readsUsed; },
    resolve(source: SourceRecencySourceView, lookup: SourceRecencyCatalogLookup): Promise<SourceRecencyResolution> {
      const snapshot = Object.freeze({ id: source.id, name: source.name,
        ...(source.rssUrl !== undefined ? { rssUrl: source.rssUrl } : {}), ...(source.url !== undefined ? { url: source.url } : {}) });
      const binding = JSON.stringify(snapshot), prior = outcomes.get(snapshot.id);
      if (prior) {
        if (prior.binding === binding) return prior.result;
        const feedUrl = sourceRecencyFeedUrl(prior.firstSource.rssUrl ?? "");
        if (!prior.mismatch) prior.mismatch = withheld({ scope: "catalog", sourceId: prior.firstSource.id,
          sourceName: prior.firstSource.name, ...(feedUrl ? { feedUrl } : {}), reason: "source-mismatch" });
        return Promise.resolve(prior.mismatch);
      }
      // Enroll the promise synchronously so CACHE/BUY/reevaluation reuse both success and failure.
      const result = Promise.resolve().then(() => resolveOnce(snapshot, lookup));
      outcomes.set(snapshot.id, { binding, firstSource: snapshot, result });
      return result;
    },
  });
}
