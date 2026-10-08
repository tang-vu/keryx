import type { PublicReferenceDb } from "../public-references/catalog";
import { referenceItems, publicReferenceSchema } from "../public-references/catalog";
import type { GatheredContent, SourceCandidate } from "../llm";
import { selectRelevantSourceItem, sourceItemIdentity } from "../sources/source-item-asset";
import { recognizeSourceRecency, sourceRecencyGap, type SourceRecencyRequirement, type SourceRecencyGap } from "../sources/source-recency";
import { retainExactItemClaimUrls } from "./operating-fee";
import type { SourceRecencyResolver } from "./source-recency-observations";
import type { SourceRecencyFeedMetadata } from "../sources/source-recency";

/** Snapshot public evidence once before reasoning. Refreshes cannot substitute content mid-run. */
export async function discoverPublicReferences(db: PublicReferenceDb, question: string, subClaims: string[],
  recency: SourceRecencyRequirement | null = recognizeSourceRecency(question), resolver?: SourceRecencyResolver) {
  const publicReads = new Map<string, GatheredContent>();
  const publicCandidates = new Map<string, SourceCandidate>();
  const recencyGaps: SourceRecencyGap[] = [];
  const recencyObservations: Readonly<SourceRecencyFeedMetadata>[] = [];
  const itemClaimUrls = new Map<string, string[]>();
  for (const stored of await db.listPublicReferences?.() ?? []) {
    const reference = publicReferenceSchema.parse(stored);
    for (const item of reference.items) retainExactItemClaimUrls(itemClaimUrls, item.link,
      [reference.url, ...(reference.rssUrl ? [reference.rssUrl] : [])]);
    if (!reference.active) continue;
    const items = referenceItems(reference);
    const resolution = resolver ? await resolver.resolve(reference, async (sourceId, link) => {
      const exact = items.filter(item => item.sourceId === sourceId && item.link === link);
      if (exact.length > 1) throw new Error("Duplicate exact public catalog item");
      return exact[0] ?? null;
    }) : undefined;
    const gap = resolution?.status === "withheld" ? resolution.gap : !resolution ? sourceRecencyGap(recency, reference) : null;
    if (gap) { recencyGaps.push(gap); continue; }
    if (resolution?.status === "eligible") recencyObservations.push(resolution.observation);
    const item = resolution?.status === "eligible" ? resolution.selected : selectRelevantSourceItem(question, subClaims, reference.tags, items);
    if (!item || !item.content.trim()) continue;
    const identity = { ...sourceItemIdentity(item), contentReceipt: undefined, sourceKind: "public-reference" as const,
      publicDeliveryKind: item.deliveryKind };
    const candidate: SourceCandidate = {
      id: reference.id, sourceId: reference.id, item: identity, sourceKind: "public-reference",
      name: `${reference.name} - ${item.title}`, description: `${reference.description} Free public feed reference; no creator payout.`,
      tags: reference.tags, fetchPrice: 0, cached: true,
      preview: `- ${item.title}: ${item.summary.slice(0, 600)}`,
    };

    publicCandidates.set(reference.id, candidate);
    publicReads.set(reference.id, { assetId: reference.id, sourceId: reference.id,
      sourceName: reference.name, ...identity, marker: "", text: item.content });

  }
  return { publicReads, publicCandidates, recencyGaps, recencyObservations, itemClaimUrls };
}
