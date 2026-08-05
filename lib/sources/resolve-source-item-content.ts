import { decryptContent, hasContentKey } from "../ipfs/content-crypto";
import { fetchByCid, hasPinata } from "../ipfs/pinata-client";
import type { SourceItem } from "../types";

interface ResolveOptions {
  /** Legacy source bundles may degrade one broken article to its free summary. */
  allowSummaryFallback: boolean;
}

/** Resolve paid text after settlement. Never logs plaintext or key material. */
export async function resolveSourceItemContent(
  item: SourceItem,
  settle: { payer: string; transaction: string },
  options: ResolveOptions,
): Promise<string> {
  if (item.ipfsCid) {
    const completeEnvelope = Boolean(item.itemKeyEnc && item.itemIv && item.itemAuthTag);
    if (!completeEnvelope || !hasPinata() || !hasContentKey()) {
      return fallbackOrThrow(item, options, "encrypted article is not decryptable on this server");
    }

    try {
      const cipherBuf = await fetchByCid(item.ipfsCid);
      const plaintext = decryptContent(
        cipherBuf.toString("base64"),
        item.itemKeyEnc!,
        item.itemIv!,
        item.itemAuthTag!,
      );
      console.log(
        `[ipfs] decrypted item ${item.id} for payer ${settle.payer} tx ${settle.transaction}`,
      );
      return plaintext;
    } catch (error) {
      console.error(`[ipfs] decrypt failed for item ${item.id}:`, error);
      return fallbackOrThrow(item, options, "article decryption failed");
    }
  }

  const plaintext = item.content || item.summary;
  if (plaintext) return plaintext;
  throw new Error(`article ${item.id} has no deliverable content`);
}

function fallbackOrThrow(
  item: SourceItem,
  options: ResolveOptions,
  reason: string,
): string {
  if (options.allowSummaryFallback && item.summary) return item.summary;
  throw new Error(`${reason} (${item.id})`);
}
