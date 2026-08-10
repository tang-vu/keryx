import { recoverTypedDataAddress, type Hex } from "viem";

import type { ArticleContentManifest, SourceItem } from "../types";
import { contentBodyHash, contentBytes } from "./content-receipt";
import {
  articleContentManifestId,
  articleContentManifestTypedData,
} from "./article-content-manifest-schema";

export {
  ARTICLE_CONTENT_MANIFEST_CHAIN_ID,
  ARTICLE_CONTENT_MANIFEST_DOMAIN,
  ARTICLE_CONTENT_MANIFEST_TYPES,
  articleContentManifestId,
  articleContentManifestTypedData,
} from "./article-content-manifest-schema";
export const MAX_ARTICLE_CONTENT_BYTES = 1_000_000;
export const MIN_FULL_TEXT_BYTES = 200;

export async function recoverArticleContentManifestSigner(
  manifest: ArticleContentManifest,
): Promise<string> {
  return recoverTypedDataAddress({
    ...articleContentManifestTypedData({
      sourceId: manifest.sourceId,
      itemId: manifest.itemId,
      canonicalUrl: manifest.canonicalUrl,
      bodyHash: manifest.bodyHash as Hex,
      plaintextBytes: manifest.plaintextBytes,
      deliveryKind: manifest.deliveryKind,
      nonce: manifest.nonce as Hex,
    }),
    signature: manifest.signature as Hex,
  });
}

export async function validateArticleContentManifest(args: {
  manifest: ArticleContentManifest;
  item: SourceItem;
  plaintext: string;
  expectedSigner: string;
}): Promise<{ valid: true } | { valid: false; reason: string }> {
  const { manifest, item, plaintext, expectedSigner } = args;
  if (
    manifest.sourceId !== item.sourceId ||
    manifest.itemId !== item.id ||
    manifest.canonicalUrl !== item.link
  ) {
    return { valid: false, reason: "manifest does not belong to this article" };
  }
  if (manifest.deliveryKind !== "full_text") {
    return { valid: false, reason: "publisher uploads must declare full_text delivery" };
  }
  const bytes = contentBytes(plaintext);
  if (bytes < MIN_FULL_TEXT_BYTES || bytes > MAX_ARTICLE_CONTENT_BYTES) {
    return {
      valid: false,
      reason: `full text must be ${MIN_FULL_TEXT_BYTES}-${MAX_ARTICLE_CONTENT_BYTES} UTF-8 bytes`,
    };
  }
  if (manifest.plaintextBytes !== bytes || manifest.bodyHash !== contentBodyHash(plaintext)) {
    return { valid: false, reason: "manifest hash or byte count does not match the article body" };
  }
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.bodyHash) ||
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.nonce) ||
    !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(manifest.signature)
  ) {
    return { valid: false, reason: "manifest hash, nonce, or signature is malformed" };
  }

  let recovered: string;
  try {
    recovered = await recoverArticleContentManifestSigner(manifest);
  } catch {
    return { valid: false, reason: "manifest signature is invalid" };
  }
  if (
    recovered.toLowerCase() !== expectedSigner.toLowerCase() ||
    manifest.signer.toLowerCase() !== expectedSigner.toLowerCase()
  ) {
    return { valid: false, reason: "manifest was not signed by the registry creator" };
  }
  if (articleContentManifestId(manifest.signature as Hex).toLowerCase() !== manifest.id.toLowerCase()) {
    return { valid: false, reason: "manifest id does not match its signature" };
  }
  return { valid: true };
}
