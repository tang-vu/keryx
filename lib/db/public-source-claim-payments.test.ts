import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "./sqlite-adapter";
import { config } from "../config";
import type { SourceClaimReceipt } from "../types";
import type { SourceClaim } from "../sources/public-source-claim";
import type { BrowserJournalAdmission } from "./browser-authorization-journal";
import { claimSupabaseResearchPurchase, type ResearchPurchaseClaim } from "./research-monthly";

const owner = "0x2222222222222222222222222222222222222222", signer = "0x1111111111111111111111111111111111111111";
const registryAddress = "0x8888888888888888888888888888888888888888", onchainId = `0x${"c".repeat(64)}`;
const previous = { baseUrl: config.baseUrl, registryReadAddress: config.registryReadAddress };
const fixtures: { db: SqliteAdapter; file: string; folder: string }[] = [];
beforeEach(() => { Object.assign(config, { baseUrl: "https://keryx.cc", registryReadAddress: registryAddress }); });
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.db.close(); rmSync(fixture.folder, { recursive: true, force: true }); } Object.assign(config, previous); });
function receipt(claim: SourceClaim): SourceClaimReceipt {
  return { id: claim.id, revision: claim.revision, mode: claim.mode, effectiveAt: claim.effectiveAt, verifiedAt: claim.verifiedAt };
}
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "keryx-claim-payment-")), file = join(folder, "ledger.sqlite"), db = new SqliteAdapter(file);
  fixtures.push({ db, file, folder }); await db.init();
  await db.upsertSource({ id: "managed", name: "Owner", url: "https://publisher.example/", rssUrl: "https://publisher.example/rss",
    walletAddress: owner, description: "Publisher feed", fetchPrice: 0.01, onchainId, active: true, verified: true, tags: [],
    authors: [{ name: "Owner", walletAddress: owner, splitWeight: 1 }], createdAt: new Date().toISOString() });
  const challenge = await db.issueSourceClaimChallenge({ wallet: owner, canonicalUrl: "https://publisher.example/", rssUrl: "https://publisher.example/rss",
    deploymentOrigin: "https://keryx.cc", network: config.networkId });
  const verified = await db.verifySourceClaim({ challengeId: challenge.id, wallet: owner, proofDigest: "b".repeat(64) });
  const linked = await db.bindSourceClaim({ claimId: verified.id, wallet: owner, expectedRevision: verified.revision,
    sourceId: "managed", onchainId, registryAddress });
  const claim = await db.updateSourceClaimPolicy({ claimId: linked.id, wallet: owner, expectedRevision: linked.revision, mode: "paid", distributionPermission: true });
  await db.upsertSessionGrant({ sessionId: "session", sessAddr: signer, ownerAddr: owner, cap: 0.000005,
    expiry: Date.now() + 60_000, grantEpoch: "epoch", txHash: "synthetic-only" });
  await db.activateBrowserJournal();
  return { db, file, claim };
}
function purchase(claim: SourceClaim, authorizationId = "original"): ResearchPurchaseClaim {
  return { network: config.networkId, payer: signer, payee: owner, authorizationId, purpose: "resource", requestHash: "a".repeat(64),
    amountMicros: 1, resourceSourceId: "managed", sourceClaim: { sourceId: "managed", receipt: receipt(claim), kind: "fetch" } };
}
function browser(claim: SourceClaim, requestId = "original", kind: "fetch" | "citation" = "fetch"): BrowserJournalAdmission {
  const sourceClaim = receipt(claim);
  return { sessionId: "session", requestId, queryId: "query", grantEpoch: "epoch", signer, network: config.networkId,
    token: config.usdcAddress, gatewayContract: config.gatewayWallet, sourceId: "managed", offerId: null, kind, payee: owner, amountMicroUsdc: 1,
    requirements: { scheme: "exact", network: config.networkId, asset: config.usdcAddress, amount: "1", payTo: owner, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } },
    paymentContext: { sourceClaim }, payment: { kind, queryId: "query", sourceId: "managed", sourceName: "Owner", payer: signer, payee: owner,
      amountUsdc: 0.000001, network: config.networkId, grantEpoch: "epoch", sourceClaim } };
}
describe("atomic source claim financial admission", () => {
  it("preserves original seller replay after disabling, rejecting new or rewritten authorizations", async () => {
    const { db, claim, file } = await fixture(), original = purchase(claim);
    await db.claimResearchPurchase(original);
    const disabled = await db.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision, mode: "free", distributionPermission: false });
    await expect(db.claimResearchPurchase(original)).resolves.toBeUndefined();
    await expect(db.claimResearchPurchase(purchase(claim, "fresh"))).rejects.toThrow("policy");
    await expect(db.claimResearchPurchase(purchase(disabled))).rejects.toThrow("Original");
    const raw = new DatabaseSync(file);
    try { expect(raw.prepare("SELECT count(*) n FROM research_purchase_authorizations").get()?.n).toBe(1); }
    finally { raw.close(); }
  });
  it("rejects missing managed seller receipt and leaves both economic and policy stores untouched", async () => {
    const { db, claim, file } = await fixture(), value = purchase(claim); delete value.sourceClaim;
    await expect(db.claimResearchPurchase(value)).rejects.toThrow();
    const raw = new DatabaseSync(file);
    try {
      expect(raw.prepare("SELECT count(*) n FROM research_purchase_authorizations").get()?.n).toBe(0);
      expect(raw.prepare("SELECT count(*) n FROM sync_state WHERE key LIKE '%purchase-policy:%'").get()?.n).toBe(0);
    } finally { raw.close(); }
  });
  it("retains managed identity after binding deletion, refusing missing-receipt admission and legacy imports", async () => {
    const { db, claim, file } = await fixture(), raw = new DatabaseSync(file);
    try {
      raw.prepare("DELETE FROM sync_state WHERE key LIKE '%:source:%'").run();
      for (const retainedBy of ["permanent-marker", "linked-claim", "linked-history"] as const) {
        if (retainedBy === "linked-claim") raw.prepare("DELETE FROM sync_state WHERE key LIKE '%:marker:%'").run();
        if (retainedBy === "linked-history") raw.prepare("DELETE FROM sync_state WHERE key LIKE '%:claim:%'").run();
        const catalog = await db.listSources();
        expect(catalog.find(source => source.id === "managed")?.sourceClaimId).toBe(claim.id);
        await expect(db.getSourceClaimForSource("managed")).rejects.toThrow("binding is unavailable");
        const missing = purchase(claim, retainedBy); delete missing.sourceClaim;
        await expect(db.claimResearchPurchase(missing)).rejects.toThrow("binding is unavailable");
        const unsigned = browser(claim, retainedBy); delete unsigned.payment.sourceClaim; delete unsigned.paymentContext!.sourceClaim;
        await expect(db.admitBrowserJournal(unsigned)).rejects.toThrow("binding is unavailable");
        await expect(db.upsertSource(catalog[0])).rejects.toThrow("binding is unavailable");
        expect(raw.prepare("SELECT count(*) n FROM research_purchase_authorizations").get()?.n).toBe(0);
        expect(raw.prepare("SELECT count(*) n FROM browser_authorization_intents").get()?.n).toBe(0);
        expect((await db.getSessionGrant("session"))?.spent).toBe(0);
      }
    } finally { raw.close(); }
  });
  it("uses current writer state before browser capacity reservation, retaining exposed originals", async () => {
    const { db, claim } = await fixture(), admitted = await db.admitBrowserJournal(browser(claim));
    expect(admitted.status).toBe("admitted");
    await db.exposeBrowserJournal("session", "original");
    await db.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision, mode: "free", distributionPermission: false });
    await expect(db.admitBrowserJournal(browser(claim, "fresh"))).rejects.toThrow("policy");
    expect((await db.getSessionGrant("session"))?.spent).toBe(0.000001);
    expect((await db.getBrowserJournal("session", "original"))?.phase).toBe("exposed");
    expect((await db.getBrowserJournal("session", "original"))?.payment.sourceClaim).toEqual(receipt(claim));
  });
  it("declines an independently committed same-price policy change before the new nonce/write", async () => {
    const { db, file, claim } = await fixture(), second = new SqliteAdapter(file);
    try {
      await second.init();
      await second.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision,
        mode: "paid", distributionPermission: true });
      await expect(db.admitBrowserJournal(browser(claim))).rejects.toThrow("policy");
      await expect(db.claimResearchPurchase(purchase(claim))).rejects.toThrow("policy");
      expect((await db.getSessionGrant("session"))?.spent).toBe(0);
      expect(await db.getBrowserJournal("session", "original")).toBeNull();
    } finally { second.close(); }
  });
  it("refuses an unsigned policy-query rewrite against the retained browser original before first seller admission", async () => {
    const { db, claim, file } = await fixture(), original = await db.admitBrowserJournal(browser(claim));
    if (original.status !== "admitted") throw new Error("Fixture admission failed");
    const newer = await db.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision,
      mode: "paid", distributionPermission: true });
    await expect(db.claimResearchPurchase(purchase(newer, original.journal.nonce))).rejects.toThrow("original browser");
    const raw = new DatabaseSync(file);
    try { expect(raw.prepare("SELECT count(*) n FROM research_purchase_authorizations").get()?.n).toBe(0); }
    finally { raw.close(); }
  });
  it("requires matching payment/context snapshots and admits only citation for citation-only policy", async () => {
    const { db, claim } = await fixture(), wrong = browser(claim); wrong.payment.sourceClaim = { ...receipt(claim), revision: 1 };
    await expect(db.admitBrowserJournal(wrong)).rejects.toThrow("context");
    const citation = await db.updateSourceClaimPolicy({ claimId: claim.id, wallet: owner, expectedRevision: claim.revision, mode: "citation-only", distributionPermission: true });
    await expect(db.admitBrowserJournal(browser(citation, "fetch"))).rejects.toThrow("policy");
    expect((await db.admitBrowserJournal(browser(citation, "cite", "citation"))).status).toBe("admitted");
  });
  it("fails closed after registry replacement and rejects unsupported Supabase admission", async () => {
    const { db, claim } = await fixture();
    Object.assign(config, { registryReadAddress: "0x9999999999999999999999999999999999999999" });
    await expect(db.admitBrowserJournal(browser(claim))).rejects.toThrow("policy");
    await expect(claimSupabaseResearchPurchase({} as never, purchase(claim))).rejects.toThrow("unsupported");
  });
});
