import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const termsMock = vi.hoisted(() => vi.fn());
vi.mock("../registry/source-fetch-payto", () => ({ sourceFetchTerms: termsMock }));

import type { SourceItem, Source } from "../types";
import type { KeryxDB } from "../db/keryx-db";
import type { SourceClaim } from "./public-source-claim";
import { config } from "../config";
import { sourceClaimReceipt } from "./source-claim-access";
import { encryptContent } from "../ipfs/content-crypto";
import { contentBodyHash, contentBytes } from "./content-receipt";
import { resolveSourceItemContent, resolveFreeSourceItemContent } from "./resolve-source-item-content";

const body = "Exact paid article body.";
const item: SourceItem = {
  id: "article-1",
  sourceId: "source-1",
  title: "Article",
  summary: "Safe preview",
  content: body,
  link: "https://publisher.test/article-1",
  bodyHash: contentBodyHash(body),
  plaintextBytes: contentBytes(body),
};
const settle = { payer: "0xbuyer", transaction: "circle-receipt" };

describe("post-settlement content receipt validation", () => {
  it("serves a body that matches its hash and byte receipt", async () => {
    await expect(
      resolveSourceItemContent(item, settle, { allowSummaryFallback: false }),
    ).resolves.toBe(body);
  });

  it("fails exact-article delivery closed when stored content no longer matches", async () => {
    await expect(
      resolveSourceItemContent(
        { ...item, content: `${body} tampered` },
        settle,
        { allowSummaryFallback: false },
      ),
    ).rejects.toThrow("content receipt hash");
  });

  it("degrades a legacy bundle leg to preview instead of discarding the whole response", async () => {
    await expect(
      resolveSourceItemContent(
        { ...item, content: `${body} tampered` },
        settle,
        { allowSummaryFallback: true },
      ),
    ).resolves.toBe(item.summary);
  });

  it("decrypts the private DB ciphertext fallback only inside the paid resolver", async () => {
    const previous = process.env.CONTENT_MASTER_KEY;
    process.env.CONTENT_MASTER_KEY = "89".repeat(32);
    try {
      const envelope = encryptContent(body);
      await expect(
        resolveSourceItemContent(
          {
            ...item,
            content: envelope.cipherB64,
            storageMode: "db_encrypted",
            itemKeyEnc: envelope.wrappedKeyB64,
            itemIv: envelope.ivB64,
            itemAuthTag: envelope.authTagB64,
            itemWrapIv: envelope.wrapIvB64,
          },
          settle,
          { allowSummaryFallback: false },
        ),
      ).resolves.toBe(body);
    } finally {
      if (previous === undefined) delete process.env.CONTENT_MASTER_KEY;
      else process.env.CONTENT_MASTER_KEY = previous;
    }
  });
});

describe("creator-authorized zero-price exact delivery", () => {
  const wallet = `0x${"11".repeat(20)}`, registry = `0x${"88".repeat(20)}`, onchainId = `0x${"cc".repeat(32)}`;
  const previous = { baseUrl: config.baseUrl, registryReadAddress: config.registryReadAddress };
  beforeEach(() => {
    Object.assign(config, { baseUrl: "https://keryx.cc", registryReadAddress: registry });
    termsMock.mockReset().mockResolvedValue({ authority: "onchain", stale: false, active: true, listPriceUsdc: 0, creator: wallet, payTo: wallet });
  });
  afterEach(() => { Object.assign(config, previous); });
  function fixture(currentItem = item) {
    const source: Source = { id: item.sourceId, name: "Publisher", url: "https://publisher.test/", walletAddress: wallet,
      description: "Publisher", fetchPrice: 0, authors: [], tags: [], onchainId, active: true, verified: true,
      sourceClaimId: "a".repeat(64), createdAt: new Date().toISOString() };
    const claim: SourceClaim = { id: source.sourceClaimId!, canonicalUrl: source.url, ownerWallet: wallet,
      network: config.networkId, deploymentOrigin: "https://keryx.cc", registryAddress: registry,
      verifiedAt: new Date().toISOString(), effectiveAt: new Date().toISOString(), revision: 2, mode: "free",
      distributionPermission: false, linkedSourceId: source.id, onchainId };
    const partial: Partial<KeryxDB> = { getSource: vi.fn(async () => source), getItem: vi.fn(async () => currentItem),
      getSourceClaimForSource: vi.fn(async () => claim), recordPayment: vi.fn(async () => {}) };
    return { db: partial as KeryxDB, source, claim };
  }
  it("decrypts exact encrypted content at live zero price without a fabricated settlement or payment record", async () => {
    const previousKey = process.env.CONTENT_MASTER_KEY; process.env.CONTENT_MASTER_KEY = "89".repeat(32);
    try {
      const envelope = encryptContent(body), encrypted = { ...item, content: envelope.cipherB64, storageMode: "db_encrypted" as const,
        itemKeyEnc: envelope.wrappedKeyB64, itemIv: envelope.ivB64, itemAuthTag: envelope.authTagB64, itemWrapIv: envelope.wrapIvB64 };
      const { db, source, claim } = fixture(encrypted);
      await expect(resolveFreeSourceItemContent(db, source, encrypted, sourceClaimReceipt(claim))).resolves.toBe(body);
      expect(db.recordPayment).not.toHaveBeenCalled(); expect(termsMock).toHaveBeenCalledWith(source, { refresh: true });
    } finally { if (previousKey === undefined) delete process.env.CONTENT_MASTER_KEY; else process.env.CONTENT_MASTER_KEY = previousKey; }
  });
  it("rejects changed content before authority lookup and stale control or same-price policy revisions before delivery", async () => {
    const changed = fixture({ ...item, bodyHash: contentBodyHash("Changed exact body"), content: "Changed exact body" });
    await expect(resolveFreeSourceItemContent(changed.db, changed.source, item, sourceClaimReceipt(changed.claim))).rejects.toThrow("version changed");
    expect(termsMock).not.toHaveBeenCalled();
    const { db, source, claim } = fixture(), expected = sourceClaimReceipt(claim);
    claim.revision++;
    await expect(resolveFreeSourceItemContent(db, source, item, expected)).rejects.toThrow("changed after discovery");
    claim.verifiedAt = new Date(Date.now() - 24 * 3600_000 - 1000).toISOString();
    await expect(resolveFreeSourceItemContent(db, source, item, sourceClaimReceipt(claim))).rejects.toThrow("authority is unavailable");
    expect(db.recordPayment).not.toHaveBeenCalled();
  });
});
