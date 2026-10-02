import type { PublicReferenceDb } from "../public-references/catalog";
import { referenceItems, publicReferenceSchema } from "../public-references/catalog";
import type { GatheredContent, SourceCandidate } from "../llm";
import { selectRelevantSourceItem, sourceItemIdentity } from "../sources/source-item-asset";

/** Snapshot public evidence once before reasoning. Refreshes cannot substitute content mid-run. */
export async function discoverPublicReferences(db: PublicReferenceDb, question: string, subClaims: string[]) {
  const publicReads = new Map<string, GatheredContent>();
  const publicCandidates = new Map<string, SourceCandidate>();
  for (const stored of await db.listPublicReferences?.() ?? []) {
    const reference = publicReferenceSchema.parse(stored);
    if (!reference.active) continue;
    const item = selectRelevantSourceItem(question, subClaims, reference.tags, referenceItems(reference));
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
  return { publicReads, publicCandidates };
}
