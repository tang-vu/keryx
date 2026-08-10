import { createHash } from "node:crypto";

import type {
  ContentDeliveryKind,
  ContentReceiptRef,
  ContentStorageMode,
  SourceItem,
} from "../types";

export const CONTENT_MANIFEST_VERSION = 1;

export function contentBodyHash(content: string): `0x${string}` {
  return `0x${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function contentBytes(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/** Conservative default for legacy/manual rows: never infer "full text" from an unlabeled body. */
export function normalizeDeliveryKind(
  value: unknown,
  content = "",
): ContentDeliveryKind {
  if (
    value === "full_text" ||
    value === "excerpt" ||
    value === "abstract" ||
    value === "metadata_only"
  ) {
    return value;
  }
  return content.trim() ? "abstract" : "metadata_only";
}

export function normalizeStorageMode(
  value: unknown,
  item: Pick<SourceItem, "ipfsCid">,
): ContentStorageMode {
  if (value === "ipfs_encrypted" || value === "db_plaintext") return value;
  return item.ipfsCid ? "ipfs_encrypted" : "db_plaintext";
}

export function contentReceipt(item: SourceItem): ContentReceiptRef {
  const deliveryKind = normalizeDeliveryKind(item.deliveryKind, item.content || item.summary);
  const storageMode = normalizeStorageMode(item.storageMode, item);
  const plaintextBytes = Math.max(
    0,
    Math.round(item.plaintextBytes ?? contentBytes(item.content || item.summary || "")),
  );
  return {
    deliveryKind,
    storageMode,
    plaintextBytes,
    ...(item.bodyHash ? { bodyHash: item.bodyHash } : {}),
    ...(item.manifest
      ? {
          manifestId: item.manifest.id,
          manifestSigner: item.manifest.signer,
          manifest: item.manifest,
        }
      : {}),
  };
}

export function isPublisherSignedFullText(item: SourceItem): boolean {
  return (
    normalizeDeliveryKind(item.deliveryKind, item.content) === "full_text" &&
    normalizeStorageMode(item.storageMode, item) === "ipfs_encrypted" &&
    Boolean(item.manifest)
  );
}
