import { decryptContent, hasContentKey } from "../ipfs/content-crypto";
import { fetchByCid, hasPinata } from "../ipfs/pinata-client";
import type { SourceItem } from "../types";
import { validateArticleContentManifest } from "./article-content-manifest";
import { contentBodyHash, contentBytes } from "./content-receipt";
import type { KeryxDB } from "../db/keryx-db";
import type { Source, SourceClaimReceipt } from "../types";
import { sourceFetchTerms } from "../registry/source-fetch-payto";
import { sourceClaimAccess } from "./source-claim-access";
import { sourceItemContentVersion } from "./source-item-asset";

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
  return resolveDeliveredContent(item, { kind: "paid", ...settle }, options);
}

/** A creator's current zero price authorizes delivery without an x402 payment or fake receipt. */
export async function resolveFreeSourceItemContent(
  db: KeryxDB, source: Source, item: SourceItem,
  expectedClaim?: SourceClaimReceipt | null,
): Promise<string> {
  if (source.id.startsWith("public:") || item.sourceId !== source.id || source.scholarlyEnrolled)
    throw new Error("This source cannot use creator-free delivery");
  const current = await db.getSource(source.id);
  const currentItem = await db.getItem(source.id, item.id);
  if (!current || !currentItem || current.active === false || current.verified === false ||
      sourceItemContentVersion(currentItem) !== sourceItemContentVersion(item))
    throw new Error("Free source or exact article version changed");
  const terms = await sourceFetchTerms(current, { refresh: true });
  const access = await sourceClaimAccess(db, current, terms,
    expectedClaim === undefined ? {} : { expected: expectedClaim });
  if (!terms.active || terms.listPriceUsdc !== 0 || !access.readAllowed)
    throw new Error("The creator has not authorized a free read of this article");
  return resolveDeliveredContent(currentItem, { kind: "free" }, {
    allowSummaryFallback: false, expectedManifestSigner: terms.creator,
  });
}

async function resolveDeliveredContent(
  item: SourceItem,
  access: { kind: "paid"; payer: string; transaction: string } | { kind: "free" },
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
        access.kind === "paid" ? `[ipfs] decrypted item ${item.id} for payer ${access.payer} tx ${access.transaction}`
          : `[ipfs] delivered creator-authorized free item ${item.id}`,
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
