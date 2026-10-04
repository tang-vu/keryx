import { describe, expect, it, vi } from "vitest";
vi.mock("../config", async () => ({ config: { ...(await vi.importActual<typeof import("../config")>("../config")).config,
  baseUrl: "https://keryx.cc", networkId: "eip155:5042002" } }));
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import type { Source } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";
import type { SourceClaim } from "./public-source-claim";
import { SOURCE_CLAIM_PROOF_MAX_AGE_MS } from "./public-source-claim";
import { contentBodyHash } from "./content-receipt";
import { publicDuplicateOfOwnedItem, sourceClaimAccess, sourceClaimReceipt } from "./source-claim-access";

const now = Date.now();
const wallet = `0x${"11".repeat(20)}`;
const registryId = `0x${"22".repeat(32)}`;
const source: Source = { id: "owned", sourceClaimId: "a".repeat(64), onchainId: registryId,
  name: "Owned", url: "https://publisher.example/", description: "Owned analysis", walletAddress: wallet,
  fetchPrice: 0, tags: [], authors: [], createdAt: new Date(now - 1000).toISOString(), verified: true };
const terms: SourceFetchTerms = { payTo: wallet, creator: wallet, listPriceUsdc: 0,
  authority: "onchain", active: true, stale: false };
const base: SourceClaim = { id: "a".repeat(64), canonicalUrl: source.url, ownerWallet: wallet,
  deploymentOrigin: new URL(config.baseUrl).origin, network: config.networkId,
  linkedSourceId: source.id, onchainId: registryId, mode: "free", distributionPermission: false,
  revision: 2, effectiveAt: new Date(now - 1000).toISOString(), verifiedAt: new Date(now - 1000).toISOString() };
const db = (claim: SourceClaim | null) => ({ getSourceClaimForSource: async () => claim }) as unknown as KeryxDB;

describe("read-time source claim authority", () => {
  it("keeps verification free and withholds citation earnings", async () => {
    const access = await sourceClaimAccess(db(base), source, terms, { now });
    expect(access.readAllowed).toBe(true); expect(access.rewardAllowed).toBe(false);
  });
  it("requires separate permission and the matching creator-set price", async () => {
    const citation = { ...base, mode: "citation-only" as const, distributionPermission: true };
    expect((await sourceClaimAccess(db(citation), source, terms, { now })).rewardAllowed).toBe(true);
    expect((await sourceClaimAccess(db(citation), source, { ...terms, listPriceUsdc: 0.01 }, { now })).readAllowed).toBe(false);
    const paid = { ...citation, mode: "paid" as const };
    expect((await sourceClaimAccess(db(paid), source, { ...terms, listPriceUsdc: 0.01 }, { now })).rewardAllowed).toBe(true);
    expect((await sourceClaimAccess(db({ ...paid, distributionPermission: false }), source, { ...terms, listPriceUsdc: 0.01 }, { now })).readAllowed).toBe(false);
    expect((await sourceClaimAccess(db(base), source, { ...terms, listPriceUsdc: 0.01 }, { now })).readAllowed).toBe(false);
  });
  it("does not apply mid-run activation to an earlier free or public snapshot", async () => {
    const enabled = { ...base, revision: 3, mode: "citation-only" as const, distributionPermission: true };
    await expect(sourceClaimAccess(db(enabled), source, terms, { expected: sourceClaimReceipt(base), now })).rejects.toThrow("changed after discovery");
    await expect(sourceClaimAccess(db(enabled), source, terms, { expected: null, now })).rejects.toThrow("changed after discovery");
    await expect(sourceClaimAccess(db({ ...enabled, effectiveAt: new Date(now + 1).toISOString() }), source, terms, { now })).rejects.toThrow("authority");
    expect((await sourceClaimAccess(db(enabled), source, terms, { expected: sourceClaimReceipt(enabled), now })).rewardAllowed).toBe(true);
  });
  it.each([
    { ...base, verifiedAt: new Date(now - SOURCE_CLAIM_PROOF_MAX_AGE_MS - 1).toISOString() },
    { ...base, verifiedAt: new Date(now + 1).toISOString() },
    { ...base, network: "eip155:999" },
    { ...base, deploymentOrigin: "https://another.example" },
    { ...base, ownerWallet: `0x${"33".repeat(20)}` },
    { ...base, linkedSourceId: "foreign" },
    { ...base, onchainId: `0x${"33".repeat(32)}` },
    { ...base, canonicalUrl: "https://another.example/" },
  ])("fails closed on changed or aged authority", async claim => {
    await expect(sourceClaimAccess(db(claim), source, terms, { now })).rejects.toThrow();
  });
  it("requires fresh on-chain authority even on the testnet profile", async () => {
    for (const changed of [{ ...terms, authority: "database" as const }, { ...terms, stale: true }, { ...terms, active: false }])
      await expect(sourceClaimAccess(db(base), source, changed, { now })).rejects.toThrow("authority");
  });
  it("cannot lose a managed binding through unsupported storage or import", async () => {
    await expect(sourceClaimAccess(db(null), source, terms)).rejects.toThrow("retained claim");
    await expect(sourceClaimAccess({} as KeryxDB, source, terms)).rejects.toThrow("retained claim");
    const legacy = { ...source, sourceClaimId: undefined };
    expect((await sourceClaimAccess(db(null), legacy, terms)).rewardAllowed).toBe(true);
  });
});

describe("public/owned duplicate evidence", () => {
  const text = "The exact original source body, including its version-specific numbers.";
  const item = { link: "https://publisher.example/article", content: "encrypted", storageMode: "db_encrypted", bodyHash: contentBodyHash(text) };
  it("matches only an exact body at the same canonical article URL", () => {
    expect(publicDuplicateOfOwnedItem(item, { itemUrl: item.link + "#section", text }, contentBodyHash)).toBe(true);
    expect(publicDuplicateOfOwnedItem(item, { itemUrl: item.link, text: text + " Updated." }, contentBodyHash)).toBe(false);
    expect(publicDuplicateOfOwnedItem(item, { itemUrl: "https://another.example/article", text }, contentBodyHash)).toBe(false);
    expect(publicDuplicateOfOwnedItem({ ...item, bodyHash: undefined }, { itemUrl: item.link, text }, contentBodyHash)).toBe(false);
  });
});
