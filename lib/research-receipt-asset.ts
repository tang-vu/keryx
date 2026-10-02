import type { ContentReceiptRef, SourceItemIdentity } from "./types";
import type { ReceiptAsset } from "./research-receipt-types";

export function receiptAsset(value: Partial<SourceItemIdentity>): ReceiptAsset {
  return {
    ...(value.webProvenance ? { webProvenance: { ...value.webProvenance } } : {}),
    ...(value.scholarly ? { scholarly: {
      provider: value.scholarly.provider, recordUrl: value.scholarly.recordUrl, retrievedAt: value.scholarly.retrievedAt,
      title: value.scholarly.title, authors: [...value.scholarly.authors],
      authorCount: value.scholarly.authorCount, authorsTruncated: value.scholarly.authorsTruncated,
      ...(value.scholarly.authorNames ? { authorNames: value.scholarly.authorNames.map(name => ({ given: name.given, family: name.family, literal: name.literal })) } : {}),
      doi: value.scholarly.doi, arxivId: value.scholarly.arxivId, workType: value.scholarly.workType,
      journal: value.scholarly.journal, publishedDate: value.scholarly.publishedDate, volume: value.scholarly.volume,
      issue: value.scholarly.issue, pages: value.scholarly.pages, peerReview: value.scholarly.peerReview,
      evidenceScope: value.scholarly.evidenceScope,
    } } : {}),
    ...(value.sourceKind === "public-reference" ? { sourceKind: value.sourceKind, publicDeliveryKind: value.publicDeliveryKind } : {}),
    ...(value.itemId ? { itemId: value.itemId } : {}),
    ...(value.itemTitle ? { itemTitle: value.itemTitle } : {}),
    ...(value.itemUrl ? { itemUrl: value.itemUrl } : {}),
    ...(value.contentVersion ? { contentVersion: value.contentVersion } : {}),
    ...(value.itemPublishedAt ? { itemPublishedAt: value.itemPublishedAt } : {}),
    ...(value.contentReceipt
      ? { contentReceipt: publicContentReceipt(value.contentReceipt) }
      : {}),
  };
}

/** Copy only the already-public receipt shape so future internal fields cannot leak by reference. */
function publicContentReceipt(value: ContentReceiptRef): ContentReceiptRef {
  return {
    deliveryKind: value.deliveryKind,
    storageMode: value.storageMode,
    plaintextBytes: value.plaintextBytes,
    ...(value.bodyHash ? { bodyHash: value.bodyHash } : {}),
    ...(value.manifestId ? { manifestId: value.manifestId } : {}),
    ...(value.manifestSigner ? { manifestSigner: value.manifestSigner } : {}),
    ...(value.manifest
      ? {
          manifest: {
            id: value.manifest.id,
            sourceId: value.manifest.sourceId,
            itemId: value.manifest.itemId,
            canonicalUrl: value.manifest.canonicalUrl,
            bodyHash: value.manifest.bodyHash,
            plaintextBytes: value.manifest.plaintextBytes,
            deliveryKind: value.manifest.deliveryKind,
            signer: value.manifest.signer,
            nonce: value.manifest.nonce,
            signature: value.manifest.signature,
            createdAt: value.manifest.createdAt,
          },
        }
      : {}),
  };
}
