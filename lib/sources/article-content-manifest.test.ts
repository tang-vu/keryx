import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import type { ArticleContentManifest, SourceItem } from "../types";
import {
  articleContentManifestId,
  articleContentManifestTypedData,
  validateArticleContentManifest,
} from "./article-content-manifest";
import { contentBodyHash, contentBytes } from "./content-receipt";

const account = privateKeyToAccount(`0x${"31".repeat(32)}`);
const plaintext = "A complete publisher-authored article with verifiable evidence. ".repeat(8);
const item: SourceItem = {
  id: "article-1",
  sourceId: "source-1",
  title: "Verified article",
  summary: "Preview",
  content: "",
  link: "https://publisher.test/article-1",
};

async function signedManifest(): Promise<ArticleContentManifest> {
  const nonce = `0x${"42".repeat(32)}` as const;
  const bodyHash = contentBodyHash(plaintext);
  const plaintextBytes = contentBytes(plaintext);
  const signature = await account.signTypedData(
    articleContentManifestTypedData({
      sourceId: item.sourceId,
      itemId: item.id,
      canonicalUrl: item.link,
      bodyHash,
      plaintextBytes,
      deliveryKind: "full_text",
      nonce,
    }),
  );
  return {
    id: articleContentManifestId(signature),
    sourceId: item.sourceId,
    itemId: item.id,
    canonicalUrl: item.link,
    bodyHash,
    plaintextBytes,
    deliveryKind: "full_text",
    signer: account.address,
    nonce,
    signature,
    createdAt: new Date().toISOString(),
  };
}

describe("publisher article content manifests", () => {
  it("accepts a registry-owner signature bound to the exact body and URL", async () => {
    await expect(
      validateArticleContentManifest({
        manifest: await signedManifest(),
        item,
        plaintext,
        expectedSigner: account.address,
      }),
    ).resolves.toEqual({ valid: true });
  });

  it("rejects body substitution after signing", async () => {
    const result = await validateArticleContentManifest({
      manifest: await signedManifest(),
      item,
      plaintext: `${plaintext}tampered`,
      expectedSigner: account.address,
    });
    expect(result).toMatchObject({ valid: false });
  });
});

