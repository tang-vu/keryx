import { decryptContent, hasContentKey } from "../ipfs/content-crypto";
import { fetchByCid, hasPinata } from "../ipfs/pinata-client";
import type { SourceItem } from "../types";
import { validateArticleContentManifest } from "./article-content-manifest";
import { contentBodyHash, contentBytes } from "./content-receipt";

interface ResolveOptions {
  /** Legacy source bundles may degrade one broken article to its free summary. */
  allowSummaryFallback: boolean;
  /** Live SourceRegistry creator used to re-check an attached publisher proof after decryption. */
  expectedManifestSigner?: string;
}

/** Resolve paid text after settlement. Never logs plaintext or key material. */
export async function resolveSourceItemContent(
  item: SourceItem,
  settle: { payer: string; transaction: string },
  options: ResolveOptions,
): Promise<string> {
  if (item.storageMode === "db_encrypted") {
    const completeEnvelope = Boolean(
      item.content && item.itemKeyEnc && item.itemIv && item.itemAuthTag,
    );
    if (!completeEnvelope || !hasContentKey()) {
      return fallbackOrThrow(item, options, "encrypted database article is not decryptable");
    }
    try {
      const plaintext = decryptContent(
        item.content,
        item.itemKeyEnc!,
        item.itemIv!,
        item.itemAuthTag!,
        item.itemWrapIv,
      );
      const invalid = await invalidReceiptReason(item, plaintext, options.expectedManifestSigner);
      if (invalid) throw new Error(invalid);
      return plaintext;
    } catch (error) {
      console.error(
        `[content] encrypted DB read failed for item ${item.id}:`,
        error instanceof Error ? error.message : String(error),
      );
      return fallbackOrThrow(item, options, "encrypted database article decryption failed");
    }
  }

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
        item.itemWrapIv,
      );
      const invalid = await invalidReceiptReason(item, plaintext, options.expectedManifestSigner);
      if (invalid) throw new Error(invalid);
      console.log(
        `[ipfs] decrypted item ${item.id} for payer ${settle.payer} tx ${settle.transaction}`,
      );
      return plaintext;
    } catch (error) {
      console.error(
        `[ipfs] decrypt failed for item ${item.id}:`,
        error instanceof Error ? error.message : String(error),
      );
      return fallbackOrThrow(item, options, "article decryption failed");
    }
  }

  if (item.content) {
    const invalid = await invalidReceiptReason(item, item.content, options.expectedManifestSigner);
    if (!invalid) return item.content;
    return fallbackOrThrow(item, options, invalid);
  }
  if (options.allowSummaryFallback && item.summary) return item.summary;
  throw new Error(`article ${item.id} has no deliverable content`);
}

async function invalidReceiptReason(
  item: SourceItem,
  plaintext: string,
  expectedManifestSigner?: string,
): Promise<string | null> {
  if (item.bodyHash && item.bodyHash !== contentBodyHash(plaintext)) {
    return "article body does not match its content receipt hash";
  }
  if (
    item.plaintextBytes !== undefined &&
    item.plaintextBytes !== contentBytes(plaintext)
  ) {
    return "article body does not match its content receipt byte count";
  }
  if (item.manifest && expectedManifestSigner) {
    const validity = await validateArticleContentManifest({
      manifest: item.manifest,
      item,
      plaintext,
      expectedSigner: expectedManifestSigner,
    });
    if (!validity.valid) return validity.reason;
  }
  return null;
}

function fallbackOrThrow(
  item: SourceItem,
  options: ResolveOptions,
  reason: string,
): string {
  if (options.allowSummaryFallback && item.summary) return item.summary;
  throw new Error(`${reason} (${item.id})`);
}
