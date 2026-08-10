import { config } from "../config";
import { encryptContent, hasContentKey } from "../ipfs/content-crypto";
import { hasPinata, pinEncrypted } from "../ipfs/pinata-client";
import type { SourceItem } from "../types";
import {
  contentBodyHash,
  contentBytes,
  normalizeDeliveryKind,
} from "./content-receipt";

export interface StoreSourceItemOptions {
  /** Publisher uploads and real-settlement deployments never fall back to plaintext. */
  requireEncrypted?: boolean;
  pin?: typeof pinEncrypted;
}

/** True only for a server that can actually settle real payments. Offline development stays easy. */
export function realContentStorageRequired(): boolean {
  return (
    process.env.KERYX_FORCE_OFFLINE !== "1" &&
    (process.env.NODE_ENV === "production" || Boolean(config.funderKey))
  );
}

/**
 * Turn an ingested/plaintext item into its durable representation. Every registration and refresh
 * path uses this one boundary so IPFS policy cannot drift by entry point.
 */
export async function storeSourceItem(
  item: SourceItem,
  options: StoreSourceItemOptions = {},
): Promise<SourceItem> {
  const content = item.content ?? "";
  const hasContent = content.trim().length > 0;
  const deliveryKind = normalizeDeliveryKind(item.deliveryKind, content);
  const plaintextBytes = hasContent ? contentBytes(content) : (item.plaintextBytes ?? 0);
  const bodyHash = hasContent ? contentBodyHash(content) : item.bodyHash;
  const base: SourceItem = {
    ...item,
    content,
    deliveryKind,
    plaintextBytes,
    ...(bodyHash ? { bodyHash } : {}),
  };

  // Already-encrypted rows are immutable inputs to this helper, not candidates for a second pin.
  if (item.ipfsCid && !content) {
    return { ...base, storageMode: "ipfs_encrypted" };
  }
  if (!hasContent) return { ...base, storageMode: "db_plaintext" };

  const requireEncrypted = options.requireEncrypted ?? realContentStorageRequired();
  if (!hasPinata() || !hasContentKey()) {
    if (requireEncrypted) {
      throw new Error("encrypted content storage is required but Pinata or CONTENT_MASTER_KEY is unavailable");
    }
    return { ...base, storageMode: "db_plaintext" };
  }

  try {
    const envelope = encryptContent(content);
    const cid = await (options.pin ?? pinEncrypted)(
      Buffer.from(envelope.cipherB64, "base64"),
      `keryx-item-${item.id}.enc`,
    );
    return {
      ...base,
      content: "",
      ipfsCid: cid,
      itemKeyEnc: envelope.wrappedKeyB64,
      itemIv: envelope.ivB64,
      itemAuthTag: envelope.authTagB64,
      itemWrapIv: envelope.wrapIvB64,
      storageMode: "ipfs_encrypted",
    };
  } catch (error) {
    if (requireEncrypted) throw error;
    console.warn(
      `[content] encrypt+pin failed for item ${item.id}; storing explicit offline plaintext`,
      error instanceof Error ? error.message : String(error),
    );
    return { ...base, storageMode: "db_plaintext" };
  }
}

export async function storeSourceItems(
  items: SourceItem[],
  options?: StoreSourceItemOptions,
): Promise<SourceItem[]> {
  // Sequential pinning stays below Pinata's request limit and contains one failure to this batch.
  const stored: SourceItem[] = [];
  for (const item of items) stored.push(await storeSourceItem(item, options));
  return stored;
}
