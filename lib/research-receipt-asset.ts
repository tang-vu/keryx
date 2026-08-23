import type { ContentReceiptRef, SourceItemIdentity } from "./types";
import type { ReceiptAsset } from "./research-receipt-types";

export function receiptAsset(value: Partial<SourceItemIdentity>): ReceiptAsset {
  return {
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
