import type { PublicReferenceDb } from "../public-references/catalog";
import { canonicalPublicArticleUrl, referenceItems, publicReferenceSchema } from "../public-references/catalog";
import type { GatheredContent, SourceCandidate } from "../llm";
import { selectRelevantSourceItem, sourceItemIdentity } from "../sources/source-item-asset";
import { recognizeSourceRecency, sourceRecencyGap, type SourceRecencyRequirement, type SourceRecencyGap } from "../sources/source-recency";
import { retainExactItemClaimUrls } from "./operating-fee";
import type { SourceRecencyResolver } from "./source-recency-observations";
import type { SourceRecencyFeedMetadata } from "../sources/source-recency";
import { archiveSearchTerms, publicArticleAssetId, type PublicReferenceArticle } from "../public-references/archive";
import type { SourceItem } from "../types";

function retainedDiscoveryExcerpt(item: SourceItem, query: string): string {
  const body = item.content.slice(0, 200_000), lower = body.toLowerCase();
  const positions = archiveSearchTerms(query).map(term => lower.indexOf(term)).filter(position => position >= 0);
  if (!positions.length) return item.summary.slice(0, 600);
  const start = Math.max(0, Math.min(...positions) - 100);
  return body.slice(start, start + 600);
}

/** Snapshot public evidence once before reasoning. Refreshes cannot substitute content mid-run. */
export async function discoverPublicReferences(db: PublicReferenceDb, question: string, subClaims: string[],
  recency: SourceRecencyRequirement | null = recognizeSourceRecency(question), resolver?: SourceRecencyResolver) {
  const publicReads = new Map<string, GatheredContent>();
  const publicCandidates = new Map<string, SourceCandidate>();
  const recencyGaps: SourceRecencyGap[] = [];
  const recencyObservations: Readonly<SourceRecencyFeedMetadata>[] = [];
  const itemClaimUrls = new Map<string, string[]>();
  const archivedByReference = new Map<string, PublicReferenceArticle[]>();
  let archiveStatus: "completed" | "unsupported" | "unavailable" | "withheld" = db.queryPublicReferenceItems
    ? recency ? "withheld" : "completed" : "unsupported";
  if (db.queryPublicReferenceItems && !recency) {
    // Retrieve against each target so a broad question cannot fill every slot before
    // a narrower target gets a chance. This is retrieval capacity, not retained storage.
    const targets = [...new Set([question, ...subClaims])];
    const results = await Promise.allSettled(targets.map(query => db.queryPublicReferenceItems!({
      query: query.slice(0, 500), match: "any", sort: "relevance", limit: 12,
    })));
    for (const result of results) {
      if (result.status === "rejected") { archiveStatus = "unavailable"; continue; }
      for (const article of result.value.items) {
        const items = archivedByReference.get(article.referenceId) ?? [];
        if (!items.some(item => item.id === article.id)) items.push(article);
        archivedByReference.set(article.referenceId, items);
      }
    }
  }
  for (const stored of await db.listPublicReferences?.() ?? []) {
    const reference = publicReferenceSchema.parse(stored);
    for (const item of reference.items) retainExactItemClaimUrls(itemClaimUrls, item.link,
      [reference.url, ...(reference.rssUrl ? [reference.rssUrl] : [])]);
    if (!reference.active) continue;
    const items: SourceItem[] = [...referenceItems(reference)];
    for (const archived of archivedByReference.get(reference.id) ?? []) {
      const position = items.findIndex(item => item.id === archived.id
        || canonicalPublicArticleUrl(item.link) === canonicalPublicArticleUrl(archived.link));
      const retained = { ...archived, sourceId: reference.id };
      if (position < 0) items.push(retained);
      else items[position] = retained;
      retainExactItemClaimUrls(itemClaimUrls, archived.link, [reference.url, reference.rssUrl]);
    }
    const resolution = resolver ? await resolver.resolve(reference, async (sourceId, link) => {
      const exact = items.filter(item => item.sourceId === sourceId && item.link === link);
      if (exact.length > 1) throw new Error("Duplicate exact public catalog item");
      return exact[0] ?? null;
    }) : undefined;
    const gap = resolution?.status === "withheld" ? resolution.gap : !resolution ? sourceRecencyGap(recency, reference) : null;
    if (gap) { recencyGaps.push(gap); continue; }
    if (resolution?.status === "eligible") recencyObservations.push(resolution.observation);
    const selected = new Map<string, SourceItem>();
    if (resolution?.status === "eligible") selected.set(resolution.selected.id, resolution.selected);
    else for (const target of [...new Set([question, ...subClaims])]) {
      // Rank retained body matches too, without rewriting the original summary or
      // version. The matched passage remains a discovery preview until selected.
      const ranked = items.map(item => ({ ...item, summary: `${item.summary} ${retainedDiscoveryExcerpt(item, target)}` }));
      const proposal = selectRelevantSourceItem(target, [target], [], ranked);
      const item = proposal ? items.find(original => original.id === proposal.id) : undefined;
      if (item?.content.trim()) selected.set(item.id, item);
    }
    let index = 0;
    for (const item of selected.values()) {
    // Retain the original first-candidate alias for an in-flight legacy picker.
    // Every additional article has its own identity, body and evidence version.
    const assetId = index++ === 0 ? reference.id : publicArticleAssetId(reference.id, item.id);
    const identity = { ...sourceItemIdentity(item), contentReceipt: undefined, sourceKind: "public-reference" as const,
      publicDeliveryKind: item.deliveryKind };
    const candidate: SourceCandidate = {
      id: assetId, sourceId: reference.id, item: identity, sourceKind: "public-reference",
      name: `${reference.name} - ${item.title}`, description: `${reference.description} Free public feed reference; no creator payout.`,
      tags: reference.tags, fetchPrice: 0, cached: true,
      preview: `- ${item.title}: ${retainedDiscoveryExcerpt(item, [question, ...subClaims].join(" "))}`,
    };

    publicCandidates.set(assetId, candidate);
    publicReads.set(assetId, { assetId, sourceId: reference.id,
      sourceName: reference.name, ...identity, marker: "", text: item.content });
    }
  }
  return { publicReads, publicCandidates, recencyGaps, recencyObservations, itemClaimUrls,
    archiveSearch: { status: archiveStatus, matchedItems: [...archivedByReference.values()].reduce((count, items) => count + items.length, 0) } };
}
