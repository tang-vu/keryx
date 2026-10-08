import type { SourceItem, SourceItemIdentity } from "../types";
import { sourceItemIdentity } from "./source-item-asset";
import { sourceRecencyFeedUrl, type SourceRecencyFeedEntry } from "./source-recency-feed-parser";
import { isObservedSourceRecencyFeed, type SourceRecencyFeedObservation } from "./source-recency-feed";

export interface CurrentFeedRecencyRequirement {
  readonly kind: "newest-feed-entry";
  readonly scope: "current-feed";
  readonly criterion: "explicit-publication-date";
  readonly sourceId: string;
  readonly feedUrl: string;
  readonly runId: string;
}
type WithheldReason = "observation-unqualified" | "requirement-unqualified" | "source-mismatch" |
  "run-mismatch" | "invalid-observation-time" | "empty-feed" | "entry-identity-unqualified" |
  "publication-unqualified" | "ambiguous-newest" | "catalog-lookup-failed" | "catalog-lookup-unqualified" |
  "newest-entry-not-indexed" | "catalog-entry-conflict" | "wanted-version-conflict" | "cancelled";
export interface CurrentFeedSelectionMetadata {
  readonly scope: "current-feed";
  readonly criterion: "explicit-publication-date";
  readonly sourceId: string;
  readonly feedUrl: string;
  readonly capturedAt: string;
  readonly observationDigest: string;
  readonly membershipCount: number;
}
export type CurrentFeedCatalogSelection = Readonly<{ status: "withheld"; reason: WithheldReason;
  observation?: Readonly<CurrentFeedSelectionMetadata>; feedEntry?: SourceRecencyFeedEntry }> |
  Readonly<CurrentFeedSelectionMetadata & { status: "eligible"; selected: Readonly<SourceItem>;
    identity: Readonly<SourceItemIdentity>; feedEntry: SourceRecencyFeedEntry }>;

function freezeObject<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeObject(child);
    Object.freeze(value);
  }
  return value;
}

/** Cancel a pending lookup locally even when a backend cannot interrupt its underlying query. */
function boundedLookup<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const onAbort = () => fail(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => fail(new Error("Catalog lookup deadline")), 2000);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/**
 * Trusted catalog callback resolves exactly one source/link to its actual current item or null.
 * It must refuse duplicate rows. An array is never a completeness assertion; only the observed
 * document establishes the current feed's membership. Registry source/payee/price authority
 * stays with the existing caller, and this helper cannot mint any of it from feed metadata.
 */
export async function selectCurrentFeedCatalogItem(requirement: CurrentFeedRecencyRequirement,
  observation: SourceRecencyFeedObservation,
  source: Readonly<{ id: string; rssUrl?: string }>,
  lookup: (sourceId: string, exactItemUrl: string, signal?: AbortSignal) => Promise<SourceItem | null>,
  options: { signal?: AbortSignal; wanted?: Readonly<{ sourceId: string; itemId: string; contentVersion: string }> } = {},
): Promise<CurrentFeedCatalogSelection> {
  let metadata: Readonly<CurrentFeedSelectionMetadata> | undefined, qualifiedWinner: SourceRecencyFeedEntry | undefined;
  const withheld = (reason: WithheldReason): CurrentFeedCatalogSelection => Object.freeze({ status: "withheld", reason,
    ...(metadata ? { observation: metadata } : {}), ...(qualifiedWinner ? { feedEntry: qualifiedWinner } : {}) });
  if (!isObservedSourceRecencyFeed(observation)) return withheld("observation-unqualified");
  if (!requirement || requirement.kind !== "newest-feed-entry" || requirement.scope !== "current-feed" ||
    requirement.criterion !== "explicit-publication-date") return withheld("requirement-unqualified");
  if (requirement.runId !== observation.requestScope.runId) return withheld("run-mismatch");
  if (requirement.sourceId !== source.id || source.id !== observation.requestScope.sourceId ||
    sourceRecencyFeedUrl(requirement.feedUrl) !== observation.requestScope.feedUrl ||
    sourceRecencyFeedUrl(source.rssUrl ?? "") !== observation.requestScope.feedUrl) return withheld("source-mismatch");
  const capturedAt = Date.parse(observation.capturedAt), startedAt = Date.parse(observation.readStartedAt);
  if (!Number.isFinite(capturedAt) || !Number.isFinite(startedAt) || startedAt > capturedAt || capturedAt > Date.now())
    return withheld("invalid-observation-time");
  metadata = Object.freeze({ scope: "current-feed", criterion: "explicit-publication-date", sourceId: source.id,
    feedUrl: observation.requestScope.feedUrl, capturedAt: observation.capturedAt,
    observationDigest: observation.observationDigest, membershipCount: observation.entries.length });
  if (options.signal?.aborted) return withheld("cancelled");
  if (!observation.entries.length) return withheld("empty-feed");
  const ids = new Set<string>(), links = new Set<string>();
  let selected: SourceRecencyFeedEntry | undefined, newest = -Infinity, tied = false;
  for (const entry of observation.entries) {
    if (!entry.itemUrl || entry.issues.length || links.has(entry.itemUrl)) return withheld("entry-identity-unqualified");
    links.add(entry.itemUrl);
    if (entry.nativeId) {
      const id = `${entry.nativeId.field}:${entry.nativeId.rawValue}`;
      if (ids.has(id)) return withheld("entry-identity-unqualified");
      ids.add(id);
    }
    const time = entry.publication.status === "valid" && entry.publication.publishedAt ? Date.parse(entry.publication.publishedAt) : NaN;
    if (!Number.isFinite(time) || time > capturedAt) return withheld("publication-unqualified");
    if (time > newest) { selected = entry; newest = time; tied = false; }
    else if (time === newest) tied = true;
  }
  if (tied) return withheld("ambiguous-newest");
  qualifiedWinner = selected;
  if (typeof lookup !== "function") return withheld("catalog-lookup-unqualified");
  const sourceId = source.id, wanted = options.wanted ? { ...options.wanted } : undefined;
  let item: SourceItem | null;
  try { item = await boundedLookup(lookup(sourceId, selected!.itemUrl!, options.signal), options.signal); }
  catch { return withheld(options.signal?.aborted ? "cancelled" : "catalog-lookup-failed"); }
  if (options.signal?.aborted) return withheld("cancelled");
  if (item === null) return withheld("newest-entry-not-indexed");
  if (!item || Array.isArray(item) || typeof item.id !== "string" || !item.id || item.id.length > 200 ||
    item.sourceId !== sourceId || sourceRecencyFeedUrl(item.link) !== selected!.itemUrl ||
    item.title !== selected!.title || item.publishedAt !== selected!.publication.publishedAt ||
    typeof item.summary !== "string" || typeof item.content !== "string") return withheld("catalog-entry-conflict");
  // Snapshot the actual selected item so later mutation cannot alter the bound content version.
  let actual: Readonly<SourceItem>, identity: Readonly<SourceItemIdentity>;
  try { actual = freezeObject(structuredClone(item)); identity = freezeObject(sourceItemIdentity(actual)); }
  catch { return withheld("catalog-entry-conflict"); }
  if (wanted && (wanted.sourceId !== sourceId || wanted.itemId !== identity.itemId ||
    wanted.contentVersion !== identity.contentVersion)) return withheld("wanted-version-conflict");
  return Object.freeze({ ...metadata, status: "eligible",
    selected: actual, identity, feedEntry: selected! });
}
