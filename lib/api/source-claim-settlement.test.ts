import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn(), settle: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("@circle-fin/x402-batching/server", () => ({ BatchFacilitatorClient: class { verify = mocks.verify; settle = mocks.settle; } }));
import { settleThenServe, type PaidOptions } from "../x402-server";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { createSqliteStorage } from "../db/storage-identity-provision";
import { openVerifiedSqliteStorage, assertVerifiedSqliteConnection } from "../db/storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "../db/enrolled-sqlite-schema-profile";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "../db/storage-identity";
import { sourceClaimReceipt } from "../sources/source-claim-access";
import type { SourceClaim } from "../sources/public-source-claim";
import type { HostedTreasuryPolicy } from "../payments/hosted-treasury-policy";

const owner = `0x${"22".repeat(20)}`, signer = `0x${"11".repeat(20)}`, registryAddress = `0x${"88".repeat(20)}`;
const onchainId = `0x${"cc".repeat(32)}`;
const previous = { baseUrl: config.baseUrl, networkId: config.networkId, profile: config.profile, usdcAddress: config.usdcAddress,
  gatewayWallet: config.gatewayWallet, registryReadAddress: config.registryReadAddress };
const cleanup: (() => void)[] = [];
beforeEach(() => { mocks.db.mockReset(); mocks.verify.mockReset().mockResolvedValue({ isValid: true, payer: signer }); mocks.settle.mockReset(); });
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); Object.assign(config, previous); vi.restoreAllMocks(); });

async function fixture(profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  const folder = mkdtempSync(join(tmpdir(), "keryx-claim-settlement-")), file = join(folder, "ledger.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  Object.assign(config, { baseUrl: "https://keryx.cc", networkId: profile.networkId, profile,
    usdcAddress: profile.usdcAddress, gatewayWallet: profile.gatewayWallet, registryReadAddress: registryAddress });
  let db: SqliteAdapter, identity: StorageIdentity | undefined;
  if (!profile.testnet) {
    identity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: profile.networkId,
      profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
      enrolledAt: new Date().toISOString(), provenanceDigest: "aa".repeat(32) };
    await createSqliteStorage(file, identity);
    const connection = openVerifiedSqliteStorage(file, identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) });
    cleanup.push(() => connection.close());
    db = SqliteAdapter.assembleConnectionCore(connection.db, identity, () => { assertVerifiedSqliteConnection(connection.db); });
  } else { db = new SqliteAdapter(file); cleanup.push(() => db.close()); await db.init(); }
  await db.upsertSource({ id: "managed", name: "Publisher", url: "https://publisher.example/", walletAddress: owner,
    description: "Feed", fetchPrice: 0.000001, onchainId, active: true, verified: true, tags: [], authors: [], createdAt: new Date().toISOString() });
  const challenge = await db.issueSourceClaimChallenge({ wallet: owner, canonicalUrl: "https://publisher.example/", deploymentOrigin: "https://keryx.cc", network: profile.networkId });
  const verified = await db.verifySourceClaim({ challengeId: challenge.id, wallet: owner, proofDigest: "bb".repeat(32) });
  const linked = await db.bindSourceClaim({ claimId: verified.id, wallet: owner, expectedRevision: verified.revision,
    sourceId: "managed", onchainId, registryAddress });
  const claim = await db.updateSourceClaimPolicy({ claimId: linked.id, wallet: owner, expectedRevision: linked.revision, mode: "paid", distributionPermission: true });
  mocks.db.mockResolvedValue(db);
  return { db, file, identity, claim };
}
function options(claim: SourceClaim): PaidOptions {
  return { priceUsdc: 0.000001, payTo: owner, endpoint: `/api/source/managed?claimId=${claim.id}&claimRevision=${claim.revision}`,
    resourceSourceId: "managed", resourceKind: "fetch", sourceClaim: { sourceId: "managed", receipt: sourceClaimReceipt(claim), kind: "fetch" } };
}
function paidRequest(claim: SourceClaim, nonce: string): NextRequest {
  const payload = { authorization: { from: signer, to: owner, value: "1", nonce }, signature: "synthetic-test-no-signing" };
  return new NextRequest(`https://keryx.cc${options(claim).endpoint}`, { headers: { "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") } });
}
function sellerCount(file: string): number {
  const raw = new DatabaseSync(file); try { return Number(raw.prepare("SELECT count(*) n FROM research_purchase_authorizations").get()?.n); }
  finally { raw.close(); }
}
async function hostedOriginal(db: SqliteAdapter, identity: StorageIdentity, claim: SourceClaim, nonce: string) {
  const profile = ARC_MAINNET_PROFILE, now = Math.floor(Date.now() / 1000);
  const policy: HostedTreasuryPolicy = { format: "keryx-hosted-treasury-policy-v1", network: "eip155:5042",
    storageIdentityDigest: storageIdentityDigest(identity), origin: "https://keryx.cc", signer,
    lifetimeCapMicroUsdc: "5", queryCapMicroUsdc: "2", expiresAtSeconds: now + 3600 };
  await db.admitHostedTreasuryPolicy(policy, "public");
  return db.admitHostedAuthorization({ policy, context: { queryId: nonce, sourceId: "managed", kind: "fetch", itemId: null,
    privateJob: null, queryBudgetMicroUsdc: "2", sourceClaim: sourceClaimReceipt(claim) },
    accounting: await db.hostedTreasuryAccounting(signer), availableMicroUsdc: "5", payload: {
      domain: { name: "GatewayWalletBatched", version: "1", chainId: profile.chainId, verifyingContract: profile.gatewayWallet },
      primaryType: "TransferWithAuthorization", types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ] }, message: { from: signer, to: owner, value: "1", validAfter: String(now - 600), validBefore: String(now + 691200), nonce },
    } });
}

describe("claimed-source seller settlement admission", () => {
  it("admits an unchanged current native policy before mocked settlement", async () => {
    const { claim, file } = await fixture();
    mocks.settle.mockResolvedValue({ success: true, transaction: "synthetic-circle-test", payer: signer, network: ARC_TESTNET_PROFILE.networkId });
    const produce = vi.fn(() => ({ ok: true }));
    const result = await settleThenServe(paidRequest(claim, `0x${"33".repeat(32)}`), options(claim), produce);
    expect(result.status).toBe(200); expect(sellerCount(file)).toBe(1); expect(mocks.settle).toHaveBeenCalledTimes(1); expect(produce).toHaveBeenCalledTimes(1);
  });
  it("refuses a same-price revision committed while read-only facilitator verification is awaited", async () => {
    const { db, claim, file } = await fixture();
    let complete!: (value: { isValid: boolean; payer: string }) => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    mocks.verify.mockImplementation(() => { started(); return new Promise(resolve => { complete = resolve; }); });
    const produce = vi.fn(), pending = settleThenServe(paidRequest(claim, `0x${"44".repeat(32)}`), options(claim), produce);
    await waiting;
    await db.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision, mode: "paid", distributionPermission: true });
    complete({ isValid: true, payer: signer });
    expect((await pending).status).toBe(500); expect(sellerCount(file)).toBe(0); expect(mocks.settle).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
  });
  it("refuses a newer unsigned policy for a hosted original before its first seller admission", async () => {
    const { db, identity, claim, file } = await fixture(ARC_MAINNET_PROFILE);
    const nonce = `0x${"55".repeat(32)}`;
    await hostedOriginal(db, identity!, claim, nonce);
    const newer = await db.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision, mode: "paid", distributionPermission: true });
    const claimSpy = vi.spyOn(db, "claimResearchPurchase"), produce = vi.fn();
    expect((await settleThenServe(paidRequest(newer, nonce), options(newer), produce)).status).toBe(500);
    await expect(claimSpy.mock.results.at(-1)?.value).rejects.toThrow("original hosted");
    expect(sellerCount(file)).toBe(0); expect(mocks.settle).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
    const raw = new DatabaseSync(file);
    try { expect(JSON.parse(String(raw.prepare("SELECT original FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)?.original)).context.sourceClaim).toEqual(sourceClaimReceipt(claim)); }
    finally { raw.close(); }
  }, 30000);
});
