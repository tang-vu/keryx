import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { NextRequest } from "next/server";
import { SqliteAdapter } from "./sqlite-adapter";
import { config } from "../config";
import type { Source, SourceItem } from "../types";
import type { BrowserJournalAdmission } from "./browser-authorization-journal";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import { articleContentManifestTypedData, articleContentManifestId } from "../sources/article-content-manifest-schema";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { paperDeclarationMessage, paperDecisionMessage, type PaperDeclaration, type PaperDecision, type SignedPaperDecision, type PaperState } from "../scholarly/rights-protocol";
import { paperCanResearch, paperPaidGate, paperDuplicatesPublicBody } from "../scholarly/paid-gate";
import { projectReceiptSettlement } from "../research-receipt-settlement";
import type { QueryRun } from "../types";
import { verifyPaperDeclaration } from "../scholarly/rights-authority";
import { admitSqliteBrowserJournal } from "./sqlite-browser-journal";

const { readRegistry } = vi.hoisted(() => ({ readRegistry: vi.fn() }));
vi.mock("../registry/registry-client", () => ({ getRegistrySource: readRegistry }));
const fixtures: Array<{ db: SqliteAdapter; raw?: DatabaseSync; folder: string; additional?: SqliteAdapter[] }> = [];
const nonce = () => `0x${randomBytes(32).toString("hex")}` as Hex;
const registry = "0x8888888888888888888888888888888888888888";
const originalConfig = { registryReadAddress: config.registryReadAddress, baseUrl: config.baseUrl };
beforeEach(() => { Object.assign(config, { registryReadAddress: registry, baseUrl: "http://localhost:3939" }); readRegistry.mockReset(); });
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    try { f.raw?.close(); } finally { try { for (const extra of f.additional ?? []) extra.close(); f.db.close(); } finally { rmSync(f.folder, { recursive: true, force: true }); } }
  }
  vi.restoreAllMocks(); vi.unstubAllEnvs(); Object.assign(config, originalConfig);
});
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "keryx-paper-")), file = join(folder, "test.sqlite");
  const db = new SqliteAdapter(file), resource = { db, folder, raw: undefined as DatabaseSync | undefined, additional: [] as SqliteAdapter[] };
  fixtures.push(resource);
  await db.init(); const raw = new DatabaseSync(file); resource.raw = raw;
  const author = privateKeyToAccount(generatePrivateKey()), reviewer = privateKeyToAccount(generatePrivateKey());
  vi.stubEnv("KERYX_SCHOLARLY_REVIEWERS", reviewer.address);
  const source: Source = { id: "paper", name: "Manuscript", url: "https://author.example", description: "Paper", walletAddress: author.address,
    fetchPrice: 0.000001, tags: [], authors: [{ name: "Author", walletAddress: author.address, splitWeight: 1 }],
    createdAt: new Date().toISOString(), active: true, verified: true, onchainId: nonce() };
  await db.upsertSource(source);
  const body = "Exact authorized manuscript body. ".repeat(15), bodyHash = contentBodyHash(body), manifestNonce = nonce();
  const item: SourceItem = { id: "manuscript", sourceId: source.id, title: "Paper", summary: "Free abstract", content: body, link: "https://author.example/manuscript",
    deliveryKind: "full_text", storageMode: "db_plaintext", bodyHash, plaintextBytes: contentBytes(body) };
  const signature = await author.signTypedData(articleContentManifestTypedData({ sourceId: source.id, itemId: item.id,
    canonicalUrl: item.link, bodyHash, plaintextBytes: contentBytes(body), deliveryKind: "full_text", nonce: manifestNonce }));
  item.manifest = { id: articleContentManifestId(signature), sourceId: source.id, itemId: item.id, canonicalUrl: item.link, bodyHash,
    plaintextBytes: contentBytes(body), deliveryKind: "full_text", signer: author.address, nonce: manifestNonce, signature, createdAt: new Date().toISOString() };
  await db.addItems([item]);
  const declared: PaperDeclaration = { protocol: "keryx-scholarly-rights-v1", network: "eip155:5042002", deploymentOrigin: "http://localhost:3939",
    sourceId: source.id, itemId: item.id, registry, onchainId: source.onchainId!, creator: author.address.toLowerCase(), recipient: author.address.toLowerCase(),
    priceMicros: "1", canonicalUrl: item.link, contentVersion: sourceItemContentVersion((await db.getItems(source.id))[0]), bodyHash,
    plaintextBytes: contentBytes(body), manifestId: item.manifest.id, manuscriptVersion: "author-manuscript", role: "author", doi: "10.1234/test",
    license: "Reviewed specific commercial distribution permission", permissionEvidence: "private contract reference synthetic-only",
    commercialDistribution: true, redistributionScope: "One manuscript via Keryx paid reading", attributionConditions: "Credit author",
    revocationContact: "author@example.invalid", effectiveAt: new Date(Date.now() - 60000).toISOString(),
    embargoUntil: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), nonce: nonce() };
  const submission = { declaration: declared, signature: await author.signMessage({ message: paperDeclarationMessage(declared) }) };
  const record = { creator: author.address, payoutWallet: author.address, active: true, fetchPriceUsdc6: BigInt(1), authors: [{ wallet: author.address, basisPoints: 10000 }] };
  readRegistry.mockResolvedValue(record);
  const signer = privateKeyToAccount(generatePrivateKey()).address;
  await db.upsertSessionGrant({ sessionId: "owner", sessAddr: signer, ownerAddr: "owner", cap: 0.00001,
    expiry: Date.now() + 60000, txHash: "synthetic", grantEpoch: "epoch" });
  await db.activateBrowserJournal();
  function intent(requestId = "request"): BrowserJournalAdmission {
    return { sessionId: "owner", requestId, queryId: "query", grantEpoch: "epoch", signer,
      network: "eip155:5042002", token: config.usdcAddress, gatewayContract: config.gatewayWallet,
      sourceId: source.id, offerId: null, kind: "fetch", payee: author.address, amountMicroUsdc: 1,
      requirements: { scheme: "exact", network: "eip155:5042002", asset: config.usdcAddress, amount: "1", payTo: author.address,
        maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } },
      payment: { kind: "fetch", queryId: "query", sourceId: source.id, sourceName: source.name, payer: signer, payee: author.address,
        amountUsdc: 0.000001, network: "eip155:5042002", grantEpoch: "epoch", itemId: item.id, contentVersion: declared.contentVersion } };
  }
  async function decision(outcome: PaperDecision["outcome"], overrides: Partial<PaperDecision> = {}): Promise<SignedPaperDecision> {
    const state = await db.getPaperState(source.id); if (!state) throw new Error("Submit first");
    const d: PaperDecision = { protocol: "keryx-scholarly-review-v1", declarationId: state.declarationId,
      previousDecisionId: state.decisionId, reviewer: reviewer.address.toLowerCase(), outcome,
      policyRevision: "supervised-testnet-v1", evidence: "Independent synthetic evidence comparison", rationale: "Version and permission explicitly reviewed",
      publicSummary: "Supervised testnet manuscript version reviewed", reviewedAt: new Date().toISOString(), nonce: nonce(), ...overrides };
    return { decision: d, signature: await reviewer.signMessage({ message: paperDecisionMessage(d) }) };
  }
  async function approve() { await db.submitPaper(submission); await db.reviewPaper(await decision("approved")); }
  return { db, raw, file, resource, source, item, author, reviewer, submission, declared, record, signer, intent, decision, approve };
}

it("persists signed submission, blocks pending earning, retains sticky enrollment and unrelated caches", async () => {
  const f = await fixture(); await f.db.setCached("other", "unrelated");
  const state = await f.db.submitPaper(f.submission);
  expect(state.review).toBeNull(); expect((await f.db.getSource("paper"))?.scholarlyEnrolled).toBe(true);
  expect(await f.db.getCached("other")).toBe("unrelated");
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/approval/);
  const repeat = await f.db.submitPaper(f.submission); expect(repeat.declarationId).toBe(state.declarationId);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM scholarly_declarations").get()?.n).toBe(1);
  for (const sql of ["DELETE FROM scholarly_enrollments", "DELETE FROM scholarly_declarations", "UPDATE sources SET scholarly_enrolled=0", "DELETE FROM sources WHERE id='paper'"])
    expect(() => f.raw.exec(sql)).toThrow(/retained|immutable/);
});
it("rejects signed field tampering, missing commercial scope and source/deployment replay", async () => {
  const f = await fixture();
  for (const patch of [{ sourceId: "other" }, { deploymentOrigin: "https://other.example" }, { bodyHash: nonce() }, { recipient: f.reviewer.address }])
    await expect(verifyPaperDeclaration({ ...f.submission, declaration: { ...f.declared, ...patch } })).rejects.toThrow(/signature/);
  await expect(f.db.submitPaper({ ...f.submission, declaration: { ...f.declared, redistributionScope: "" } })).rejects.toThrow();
  const changed = { ...f.declared, nonce: f.declared.nonce, doi: "10.1234/changed" };
  await f.db.submitPaper(f.submission);
  await expect(f.db.submitPaper({ declaration: changed, signature: await f.author.signMessage({ message: paperDeclarationMessage(changed) }) })).rejects.toThrow(/reused/);
});
it("requires independent allowlisted reviewer and persists exact repeat after artifact freshness expires", async () => {
  const f = await fixture(); await f.db.submitPaper(f.submission);
  vi.stubEnv("KERYX_SCHOLARLY_REVIEWERS", f.author.address);
  const self = await f.decision("approved", { reviewer: f.author.address.toLowerCase() });
  self.signature = await f.author.signMessage({ message: paperDecisionMessage(self.decision) });
  await expect(f.db.reviewPaper(self)).rejects.toThrow(/independently/);
  vi.stubEnv("KERYX_SCHOLARLY_REVIEWERS", ""); await expect(f.db.reviewPaper(await f.decision("approved"))).rejects.toThrow(/allowlist/);
  vi.stubEnv("KERYX_SCHOLARLY_REVIEWERS", f.reviewer.address);
  const approved = await f.decision("approved"), first = await f.db.reviewPaper(approved);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 86400_000);
  expect((await f.db.reviewPaper(approved)).decisionId).toBe(first.decisionId);
  vi.restoreAllMocks();
});
it("atomically admits original browser terms with rights references; revocation blocks new reads and preserves exposed snapshot", async () => {
  const f = await fixture(); await f.approve();
  expect(await paperCanResearch(f.db, f.source, false)).toBe(false);
  expect(await paperCanResearch(f.db, f.source, true)).toBe(true);
  const result = await f.db.admitBrowserJournal(f.intent()); expect(result.status).toBe("admitted");
  if (result.status !== "admitted") throw new Error("Expected admission");
  expect(result.journal.payment.scholarlyApprovalId).toBe((await f.db.getPaperState("paper"))?.decisionId);
  expect(await f.db.getPaperAdmission(result.journal.nonce)).toBeNull();
  expect(await f.db.exposeBrowserJournal("owner", "request")).toBe(true);
  const snapshot = await f.db.getPaperAdmission(result.journal.nonce); expect(snapshot?.payer).toBe(f.signer.toLowerCase());
  await f.db.reviewPaper(await f.decision("revoked"));
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
  await expect(f.db.admitBrowserJournal(f.intent("second"))).rejects.toThrow(/approval/);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0.000001);
  expect(await f.db.getPaperAdmission(result.journal.nonce)).toEqual(snapshot);
  const request = (authorization: Record<string, unknown>) => new NextRequest("http://localhost/api/source/paper/item/manuscript", {
    headers: { "payment-signature": Buffer.from(JSON.stringify({ authorization, signature: "not-validated-by-this-gate" })).toString("base64") } });
  const auth = { nonce: result.journal.nonce, from: f.signer, to: f.author.address, value: "1" };
  expect(await paperPaidGate(f.db, f.source, request(auth), { kind: "fetch", item: f.item, payee: f.author.address, amountMicros: 1 })).toBeNull();
  for (const patch of [{ nonce: nonce() }, { from: f.reviewer.address }, { to: f.reviewer.address }, { value: "2" }])
    expect((await paperPaidGate(f.db, f.source, request({ ...auth, ...patch }), { kind: "fetch", item: f.item, payee: f.author.address, amountMicros: 1 }))?.status).toBe(409);
  expect(await f.db.cancelPreparedBrowserJournal("owner", "request")).toBe(false);
});
it("refuses bundles, arbitrary SDK headers, wrong versions, stale registry failure and unreviewed recipient changes", async () => {
  const f = await fixture(); await f.approve();
  const req = new NextRequest("http://localhost/api/source/paper");
  expect((await paperPaidGate(f.db, f.source, req, { kind: "fetch", payee: f.author.address, amountMicros: 1, bundle: true }))?.status).toBe(409);
  readRegistry.mockRejectedValue(new Error("RPC offline"));
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/RPC/);
  readRegistry.mockResolvedValue({ ...f.record, payoutWallet: f.reviewer.address });
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/policy/);
  readRegistry.mockResolvedValue(f.record);
  await expect(f.db.admitBrowserJournal({ ...f.intent(), payment: { ...f.intent().payment, contentVersion: "wrong" } })).rejects.toThrow(/version/);
  await f.db.addItems([{ ...f.item, summary: "Changed version" }]);
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0);
});
it("serializes revocation and source mutation during RPC against new authorization admission", async () => {
  const f = await fixture(); await f.approve();
  const revoke = await f.decision("revoked");
  const second = new SqliteAdapter(f.file); f.resource.additional.push(second); await second.init();
  readRegistry.mockImplementationOnce(async () => { await second.reviewPaper(revoke); return f.record; });
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/approval|changed/);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM browser_authorization_intents").get()?.n).toBe(0);
  const updated = { ...f.declared, nonce: nonce() };
  await f.db.submitPaper({ declaration: updated, signature: await f.author.signMessage({ message: paperDeclarationMessage(updated) }) });
  await f.db.reviewPaper(await f.decision("approved"));
  readRegistry.mockImplementationOnce(async () => { await f.db.upsertSource({ ...f.source, verified: false }); return f.record; });
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/changed/);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0);
});
it("fences old journal writers and rolls back failed rights snapshot without reserving or leaving writer capability", async () => {
  const f = await fixture(); await f.approve();
  expect(() => admitSqliteBrowserJournal(f.raw, f.intent())).toThrow(/scholarly admission/);
  f.raw.exec("CREATE TRIGGER fault BEFORE INSERT ON scholarly_admissions BEGIN SELECT RAISE(ABORT,'fault'); END");
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/fault/);
  for (const table of ["browser_authorization_intents", "scholarly_admissions", "scholarly_writer", "browser_journal_writer"])
    expect(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n).toBe(0);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0);
});
it("rejects ineffective permissions and simultaneous stale review decisions; no auto-review from DOI", async () => {
  const f = await fixture();
  const future = { ...f.declared, nonce: nonce(), embargoUntil: new Date(Date.now() + 60000).toISOString() };
  await f.db.submitPaper({ declaration: future, signature: await f.author.signMessage({ message: paperDeclarationMessage(future) }) });
  await expect(f.db.reviewPaper(await f.decision("approved"))).rejects.toThrow(/effective/);
  await f.db.submitPaper(f.submission);
  const approve = await f.decision("approved"), reject = await f.decision("rejected");
  const results = await Promise.allSettled([f.db.reviewPaper(approve), f.db.reviewPaper(reject)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(f.raw.prepare("SELECT COUNT(*) n FROM scholarly_decisions").get()?.n).toBe(1);
});
it("denies a sticky enrolled source on an unsupported backend while preserving legacy sources", async () => {
  const f = await fixture();
  const unsupported = { getItems: f.db.getItems.bind(f.db) } as unknown as SqliteAdapter;
  expect(await paperCanResearch(unsupported, { ...f.source, scholarlyEnrolled: true }, true)).toBe(false);
  expect((await paperPaidGate(unsupported, { ...f.source, scholarlyEnrolled: true }, new NextRequest("http://localhost"), { kind: "fetch", payee: f.author.address, amountMicros: 1 }))?.status).toBe(503);
  expect(await paperCanResearch(unsupported, f.source, false)).toBe(true);
});
it("blocks draft earning before upload, and does not promote an ordinary source by corrupt rights lookup", async () => {
  const f = await fixture();
  await f.db.beginPaperEnrollment("paper", f.author.address);
  expect(await f.db.getPaperState("paper")).toBeNull();
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/scholarly admission/);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0);
  vi.spyOn(f.db, "getPaperState").mockRejectedValue(new Error("corrupt"));
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
});
it("bounds citation admission, rejects duplicate nonce/reservation, exports approval provenance without private evidence", async () => {
  const f = await fixture(); await f.approve();
  const value = f.intent(); value.kind = "citation"; value.payment.kind = "citation";
  const admitted = await f.db.admitBrowserJournal(value);
  expect(admitted.status).toBe("admitted");
  await expect(f.db.admitBrowserJournal(value)).rejects.toThrow(/UNIQUE/);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0.000001);
  expect(await f.db.exposeBrowserJournal("owner", "request")).toBe(true);
  const snapshot = projectReceiptSettlement({ id: "query", paymentMode: "real", settledPayments: 0, pendingPayments: 1 } as QueryRun,
    await f.db.listPendingPayments(10));
  expect(snapshot.creatorPayments[0].scholarlyRights?.approvalId).toBe((await f.db.getPaperState("paper"))?.decisionId);
  expect(snapshot.status).toBe("pending"); expect(snapshot.settledCreatorUsdc).toBe(0);
  expect(JSON.stringify(snapshot)).not.toContain("private contract"); expect(JSON.stringify(snapshot)).not.toContain("revocationContact");
  const excessive = f.intent("large"); excessive.kind = "citation"; excessive.payment.kind = "citation";
  excessive.amountMicroUsdc = Math.round(config.maxCitationUsdc * 1e6) + 1; excessive.payment.amountUsdc = excessive.amountMicroUsdc / 1e6;
  excessive.requirements.amount = String(excessive.amountMicroUsdc);
  await expect(f.db.admitBrowserJournal(excessive)).rejects.toThrow(/terms/);
});
it("separates free exact bodies from metadata, and refuses expired permission without new payment", async () => {
  const f = await fixture(); await f.approve();
  expect(await paperDuplicatesPublicBody(f.db, f.source, [f.item.content])).toBe(true);
  expect(await paperDuplicatesPublicBody(f.db, f.source, [f.declared.doi, f.item.summary])).toBe(false);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.declared.expiresAt) + 1);
  expect(await paperCanResearch(f.db, f.source, true)).toBe(false);
  await expect(f.db.admitBrowserJournal(f.intent())).rejects.toThrow(/effective/);
  expect((await f.db.getSessionGrant("owner"))?.spent).toBe(0);
});
it("rejects review signature tampering and mutable split policy even when every wallet is the same recipient", async () => {
  const f = await fixture(); await f.db.submitPaper(f.submission);
  const review = await f.decision("approved");
  await expect(f.db.reviewPaper({ ...review, decision: { ...review.decision, outcome: "rejected" } })).rejects.toThrow(/signature/);
  readRegistry.mockResolvedValue({ ...f.record, authors: [{ wallet: f.author.address, basisPoints: 5000 }, { wallet: f.author.address, basisPoints: 5000 }] });
  await expect(f.db.reviewPaper(review)).rejects.toThrow(/single recipient/);
});
it("lets drafts submit without occupying capacity; independently approved effective sources occupy only four slots", async () => {
  const f = await fixture(), states: PaperState[] = [];
  for (let index = 0; index < 5; index++) {
    const source = { ...f.source, id: `paper-${index}`, onchainId: nonce(), url: `https://author.example/${index}` };
    await f.db.upsertSource(source); await f.db.beginPaperEnrollment(source.id, f.author.address);
    const content = `${f.item.content} version ${index}`, bodyHash = contentBodyHash(content), plaintextBytes = contentBytes(content), manifestNonce = nonce();
    const item = { ...f.item, id: `manuscript-${index}`, sourceId: source.id, link: `${source.url}/manuscript`, content, bodyHash, plaintextBytes };
    const signature = await f.author.signTypedData(articleContentManifestTypedData({ sourceId: source.id, itemId: item.id, canonicalUrl: item.link,
      bodyHash, plaintextBytes, deliveryKind: "full_text", nonce: manifestNonce }));
    item.manifest = { ...f.item.manifest!, id: articleContentManifestId(signature), sourceId: source.id, itemId: item.id, canonicalUrl: item.link,
      bodyHash, plaintextBytes, signature, nonce: manifestNonce };
    await f.db.addItems([item]);
    const declaration = { ...f.declared, sourceId: source.id, itemId: item.id, onchainId: source.onchainId, canonicalUrl: item.link,
      bodyHash, plaintextBytes, contentVersion: sourceItemContentVersion(item), manifestId: item.manifest.id,
      doi: index === 0 ? "https://doi.org/10.1234%2FTEST" : `10.1234/capacity${index}`, nonce: nonce() };
    const state = await f.db.submitPaper({ declaration, signature: await f.author.signMessage({ message: paperDeclarationMessage(declaration) }) });
    states.push(state);
  }
  async function review(index: number, outcome: PaperDecision["outcome"]) {
    const state = (await f.db.getPaperState(states[index].sourceId))!;
    const decision: PaperDecision = { protocol: "keryx-scholarly-review-v1", declarationId: state.declarationId, previousDecisionId: state.decisionId,
      reviewer: f.reviewer.address.toLowerCase(), outcome, policyRevision: "supervised-testnet-v1", evidence: "Synthetic independently reviewed permission",
      rationale: "Exact version and recipient checked", publicSummary: "Testnet manuscript reviewed", reviewedAt: new Date().toISOString(), nonce: nonce() };
    return f.db.reviewPaper({ decision, signature: await f.reviewer.signMessage({ message: paperDecisionMessage(decision) }) });
  }
  // An unreviewed copied DOI cannot prevent the legitimate source from submitting or being approved.
  await f.approve();
  expect(states[0].submission.declaration.doi).toBe(f.declared.doi);
  await expect(review(0, "approved")).rejects.toThrow(/same body, location or DOI/);
  for (let index = 1; index < 4; index++) await review(index, "approved");
  await expect(review(4, "approved")).rejects.toThrow(/four currently effective approved/);
  await f.db.reviewPaper(await f.decision("suspended"));
  expect((await review(4, "approved")).review?.decision.outcome).toBe("approved");
  await review(1, "suspended");
  expect((await review(0, "approved")).review?.decision.outcome).toBe("approved");
});
