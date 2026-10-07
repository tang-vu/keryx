import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillmentFixture, fixtureNow, fixtureCommit, fixtureFlush, cleanFulfillmentFixtures } from "./fulfillment-test-fixture";
import { beginFailedOriginalFulfillment, closeFulfillmentCapability, fulfillmentDirectory, fulfillmentProviderLedger,
  fulfillmentStep, reserveFulfillmentModel } from "./fulfillment-policy";
import { beginOriginalContinuation, closeContinuationCapability, continuationAuthorizationSchema,
  continuationDirectory, continuationModel, continuationProviderLedger, readContinuationAuthorization,
  assertContinuationSupplierAdmission, continuationSupplierSignal, prepareContinuationResult,
  completePreparedContinuation, verifyPreparedContinuation, retainedContinuationDeliveryResolution,
  recordContinuationDiagnostic, type ContinuationAuthorization, type ContinuationCapability } from "./fulfillment-continuation-policy";
import { inspectOriginalContinuation, activateOriginalContinuationEpoch } from "./fulfillment-continuation-policy";
import { fixedPaths } from "./continuation-epoch";
import { businessCanaryHostIdentity, retainedBusinessCanaryClosure } from "./canary-policy";
import { fulfillmentSha256 as hash, fulfillmentObjectSha256 as hashObject } from "../a2a/failed-original-fulfillment-protocol";
import { syntheticFulfilledRun } from "../db/a2a-fulfillment-fixture";
import { renderFulfilledOriginalAnswer } from "../a2a/original-fulfillment-answer";

const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: git }));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureNow);
  git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No network in continuation policy tests"); }));
});
afterEach(() => { cleanFulfillmentFixtures(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const receipt = "2026-10-07T12:00:00.000Z", expiresAt = "2026-10-08T12:00:00.000Z";
async function fixture() {
  const value = await fulfillmentFixture(), original = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
  await fulfillmentStep(original.capability, "sufficiency", async () => reserveFulfillmentModel(original.capability, "fixture", "old sufficiency", 1));
  await fulfillmentStep(original.capability, "synthesize", async () => reserveFulfillmentModel(original.capability, "fixture", "old generation", 1));
  closeFulfillmentCapability(original.capability); vi.setSystemTime(receipt);
  const ledger = fulfillmentProviderLedger(value.binding), tariffFile = path.join(value.root, "current-tariff.txt");
  fs.writeFileSync(tariffFile, "Synthetic current tariff capture", { mode: 0o600 });
  fs.mkdirSync(continuationDirectory(), { mode: 0o700 });
  const authorization: ContinuationAuthorization = { format: "keryx-original-continuation-authorization-v1",
    approvalId: "operator-business-20261006", approvedAt: receipt, ownerAuthorizationReceivedAt: receipt,
    ownerAuthorizationSha256: hash("Synthetic explicit owner permission"), expiresAt, maximumDurationMs: 86_400_000,
    executionHostSha256: businessCanaryHostIdentity(), executorCommit: fixtureCommit,
    originalAuthorizationSha256: value.authorizationDigest, originalClaimSha256: hash(fs.readFileSync(path.join(fulfillmentDirectory(), "claim.json"))),
    nativeClaimSha256: hashObject(original.claim), originalFulfillmentProviderLedgerSha256: ledger.sha256,
    policySha256: value.old.policySha256, failedClosureSha256: value.old.failedClosureSha256,
    originalEvidenceSha256: value.old.originalEvidenceSha256, originalProviderLedgerSha256: value.old.originalProviderLedgerSha256,
    inputSemanticSha256: value.packet.inputSemanticSha256, packetSha256: value.packet.packetSha256,
    tariffFile, tariffBodySha256: hash(fs.readFileSync(tariffFile)), tariffRetrievedAt: receipt,
    tariffUrl: "https://api-docs.deepseek.com/quick_start/pricing/", tariffInputUsdPerMillion: 0.30, tariffOutputUsdPerMillion: 1.20,
    provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", reserveMicroUsd: 20_660,
    maximumNewModelCalls: 8, historicalReservedMicroUsd: 77_980, maximumCombinedMicroUsd: 243_260,
    searches: "forbidden", creatorPayments: "forbidden", newInboundPayment: "forbidden" };
  const file = path.join(value.root, "continuation-authorization.json");
  fs.writeFileSync(file, JSON.stringify(authorization), { mode: 0o600 });
  return { ...value, original, file, sha256: hash(fs.readFileSync(file)), continuationAuthorization: authorization };
}
async function epochFixture() {
  const value = await fixture(), parentDirectory = continuationDirectory();
  for (let index = 0; index < 4; index++) {
    const admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await continuationModel(admitted.capability, "sufficiency", "Fixture system", "sufficiency fixture", 1, async () => ({ fixture: true }));
    await continuationModel(admitted.capability, "synthesize", "Fixture system", "synthesize fixture", 1, async () => ({ fixture: true }));
    if (index < 3) {
      await continuationModel(admitted.capability, "review", "Fixture system", "review fixture", 1, async () => ({ fixture: true }));
      recordContinuationDiagnostic(admitted.capability, { phase: "assemble", category: "quality" });
    }
    closeContinuationCapability(admitted.capability);
  }
  const parent = continuationProviderLedger(), parentBytes = bytes(parentDirectory), nextCommit = "d".repeat(40);
  git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${nextCommit}\n`);
  const authorization: ContinuationAuthorization = { ...value.continuationAuthorization,
    format: "keryx-original-continuation-authorization-v2", executorCommit: nextCommit,
    historicalReservedMicroUsd: 243_260, maximumNewModelCalls: 6, maximumCombinedMicroUsd: 400_000,
    parentAuthorizationFile: value.file, parentAuthorizationSha256: value.sha256,
    parentProviderLedgerSha256: parent.sha256,
    parentLedgerHeadSha256: hash(fs.readFileSync(path.join(parentDirectory, "ledger-head.json"))),
    contextProtocol: "full-selected-bodies-required-sufficiency-v1" };
  const epochFile = path.join(value.root, "epoch-authorization.json");
  fs.writeFileSync(epochFile, JSON.stringify(authorization), { mode: 0o600 });
  return { ...value, parentDirectory, parentBytes, parent, epochFile, epochSha256: hash(fs.readFileSync(epochFile)), epochAuthorization: authorization };
}
function bytes(directory: string) {
  return fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), "hex")]);
}
async function stages(capability: ContinuationCapability) {
  for (const stage of ["sufficiency", "synthesize", "review"] as const)
    await continuationModel(capability, stage, "Fixture system", `${stage} fixture`, 1, async () => ({ fixture: stage }));
}
function preparedRun(admitted: Awaited<ReturnType<typeof beginOriginalContinuation>>, coverage = 0.9) {
  const run = syntheticFulfilledRun(admitted.claim).run;
  run.createdAt = receipt; run.durationMs = Date.parse(receipt) - Date.parse(admitted.claim.failedOrder.startedAt!);
  run.citations[0].sourceId = run.evidence![0].sourceId = "public:fulfillment:document-1";
  run.claimCoverage![0].coverage = coverage;
  run.originalFulfillment!.providerLedgerSha256 = continuationProviderLedger().sha256;
  run.answer = renderFulfilledOriginalAnswer({ question: run.question, answer: "", statements: run.originalFulfillment!.statements,
    evidenceGaps: run.originalFulfillment!.evidenceGaps,
    ledger: { evidence: run.evidence!, claimCoverage: run.claimCoverage!, acceptedMarkers: new Set(["S1"]), droppedEvidence: 0, droppedCitations: [] } });
  return run;
}
describe("additive same-original supplier continuation", () => {
  it("observes fresh native authority and window without creating an execution intent", async () => {
    const value = await fixture(), before = bytes(value.oldDirectory), retained = bytes(fulfillmentDirectory());
    expect(await inspectOriginalContinuation(value.db, value.file, value.sha256)).toMatchObject({ supplierWindowLive: true,
      newModelCalls: 0, combinedReservedMicroUsd: 77_980, prepared: false, nativeCompleted: false, executionIntentRetained: false,
      providerRequests: 0, payments: 0 });
    expect(fs.readdirSync(continuationDirectory())).toEqual([]);
    expect(bytes(value.oldDirectory)).toEqual(before); expect(bytes(fulfillmentDirectory())).toEqual(retained);
  });
  it("retains the original claim, settlement and both old registries while granting a separate bounded capability", async () => {
    const value = await fixture(), old = bytes(value.oldDirectory), additive = bytes(fulfillmentDirectory());
    const admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    expect(admitted.claim).toEqual(value.original.claim); expect(admitted.binding.original).toEqual(value.binding);
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce();
    await stages(admitted.capability); closeContinuationCapability(admitted.capability);
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 3, oldAdditiveModelCalls: 2, combinedReservedMicroUsd: 139_960 });
    expect(bytes(value.oldDirectory)).toEqual(old); expect(bytes(fulfillmentDirectory())).toEqual(additive);
    expect(value.order.status).toBe("failed"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["originalAuthorizationSha256", "originalClaimSha256", "nativeClaimSha256", "packetSha256",
    "originalFulfillmentProviderLedgerSha256", "executionHostSha256"] as const)("refuses changed %s before supplier execution", async field => {
    const value = await fixture(); fs.writeFileSync(value.file, JSON.stringify({ ...value.continuationAuthorization, [field]: "a".repeat(64) }));
    await expect(beginOriginalContinuation(value.db, value.file, hash(fs.readFileSync(value.file)), fixtureFlush)).rejects.toThrow();
    expect(fs.readdirSync(continuationDirectory())).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects source, authorization digest, expired windows and newly inflated quota", async () => {
    const value = await fixture();
    await expect(beginOriginalContinuation(value.db, value.file, "b".repeat(64), fixtureFlush)).rejects.toThrow("authorization changed");
    git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${"d".repeat(40)}\n`);
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow("source changed");
    git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
    vi.setSystemTime(expiresAt);
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow("expired");
    expect(readContinuationAuthorization(value.file, value.sha256).authorization.expiresAt).toBe(expiresAt);
    expect(continuationAuthorizationSchema.safeParse({ ...value.continuationAuthorization, maximumNewModelCalls: 9 }).success).toBe(false);
    expect(continuationAuthorizationSchema.safeParse({ ...value.continuationAuthorization, expiresAt: "2026-10-09T12:00:00.000Z" }).success).toBe(false);
  });
  it("refuses counterfeit dispatch, concurrent stages and lock takeover even by a second genuine begin", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    expect(() => assertContinuationSupplierAdmission({} as ContinuationCapability)).toThrow("revoked");
    await expect(continuationModel({} as ContinuationCapability, "sufficiency", "s", "u", 1, async () => ({}))).rejects.toThrow("opaque");
    let resolve!: (value: Record<string, unknown>) => void;
    const active = continuationModel(admitted.capability, "sufficiency", "s", "u", 1, () => new Promise(done => { resolve = done; }));
    await expect(continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => ({}))).rejects.toThrow("opaque");
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow();
    resolve({ fixture: true }); await active; closeContinuationCapability(admitted.capability);
    expect(continuationProviderLedger().newModelCalls).toBe(1);
  });
  it("reuses only exact successful JSON checkpoints in a fresh additive attempt without replaying requests", async () => {
    const value = await fixture(), first = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush), action = vi.fn(async () => ({ fixture: "checkpoint" }));
    await continuationModel(first.capability, "sufficiency", "s", "u", 1, action); closeContinuationCapability(first.capability);
    const second = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    expect(await continuationModel(second.capability, "sufficiency", "s", "u", 1, action)).toEqual({ fixture: "checkpoint" });
    closeContinuationCapability(second.capability); expect(action).toHaveBeenCalledOnce();
    const third = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await continuationModel(third.capability, "sufficiency", "s", "changed", 1, action); closeContinuationCapability(third.capability);
    expect(action).toHaveBeenCalledTimes(2); expect(continuationProviderLedger().newModelCalls).toBe(2);
  });
  it("retains failed holds and a fixed diagnostic, then budgets a fresh request instead of replaying its old hold", async () => {
    const value = await fixture(), first = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await expect(continuationModel(first.capability, "sufficiency", "s", "u", 1, async () => { throw Error("secret provider raw exception"); })).rejects.toThrow();
    expect(() => assertContinuationSupplierAdmission(first.capability)).toThrow("revoked");
    recordContinuationDiagnostic(first.capability, { phase: "sufficiency", category: "transport" });
    closeContinuationCapability(first.capability);
    expect(bytes(continuationDirectory()).map(([, raw]) => Buffer.from(raw, "hex").toString("utf8")).join("\n")).not.toContain("secret provider");
    const second = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await continuationModel(second.capability, "sufficiency", "s", "u", 1, async () => ({ fixture: true })); closeContinuationCapability(second.capability);
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 2, combinedReservedMicroUsd: 119_300 });
  });
  it("refreshes a quality-rejected generation and reviews it independently even when the prompt is identical", async () => {
    const value = await fixture(), originalBytes = bytes(value.oldDirectory), oldAdditiveBytes = bytes(fulfillmentDirectory());
    const action = vi.fn(async () => ({ fixture: "normalized stage output" }));
    const first = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    for (const stage of ["sufficiency", "synthesize", "review"] as const)
      await continuationModel(first.capability, stage, "system", stage, 1, action);
    expect(() => prepareContinuationResult(first.capability, preparedRun(first, 0.1))).toThrow("required support");
    recordContinuationDiagnostic(first.capability, { phase: "assemble", category: "quality" });
    closeContinuationCapability(first.capability);
    const retainedCalls = bytes(continuationDirectory()).filter(([name]) => name.startsWith("call-"));
    const second = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    for (const stage of ["sufficiency", "synthesize", "review"] as const)
      await continuationModel(second.capability, stage, "system", stage, 1, action);
    expect(action).toHaveBeenCalledTimes(5); // Sufficiency cached; generation and independent review are fresh.
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 5, combinedReservedMicroUsd: 181_280 });
    expect(prepareContinuationResult(second.capability, preparedRun(second)).claimId).toBe(value.original.claim.claimId);
    expect(bytes(continuationDirectory()).filter(([name]) => retainedCalls.some(([oldName]) => oldName === name))).toEqual(retainedCalls);
    expect(bytes(value.oldDirectory)).toEqual(originalBytes); expect(bytes(fulfillmentDirectory())).toEqual(oldAdditiveBytes);
  });
  it("cannot manufacture a quality-refresh diagnostic before the three reviewed stages are complete", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    expect(() => recordContinuationDiagnostic(admitted.capability, { phase: "assemble", category: "quality" })).toThrow("completed independent review");
    expect(continuationProviderLedger().diagnostics).toEqual([]); closeContinuationCapability(admitted.capability);
  });
  it("stops an acknowledged low mandatory assessment without another attempt or generation hold", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    expect(() => recordContinuationDiagnostic(admitted.capability, { phase: "sufficiency", category: "quality" })).toThrow("acknowledged assessment");
    await continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => ({ perClaim: [{ coverage: 0.1 }] }));
    recordContinuationDiagnostic(admitted.capability, { phase: "sufficiency", category: "quality" }); closeContinuationCapability(admitted.capability);
    const retained = bytes(continuationDirectory());
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow("unchanged context");
    expect(bytes(continuationDirectory())).toEqual(retained); expect(continuationProviderLedger().newModelCalls).toBe(1);
  });
  it("keeps the rejected-checkpoint barrier after an intervening fresh-generation transport failure", async () => {
    const value = await fixture(), first = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await stages(first.capability); recordContinuationDiagnostic(first.capability, { phase: "assemble", category: "quality" });
    closeContinuationCapability(first.capability);
    const second = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await continuationModel(second.capability, "sufficiency", "Fixture system", "sufficiency fixture", 1, async () => ({}));
    await expect(continuationModel(second.capability, "synthesize", "Fixture system", "synthesize fixture", 1,
      async () => { throw Error("fixture generation transport failure"); })).rejects.toThrow();
    recordContinuationDiagnostic(second.capability, { phase: "synthesize", category: "transport" }); closeContinuationCapability(second.capability);
    const third = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush), action = vi.fn(async () => ({ fixture: "new pair" }));
    for (const stage of ["sufficiency", "synthesize", "review"] as const)
      await continuationModel(third.capability, stage, "Fixture system", `${stage} fixture`, 1, action);
    expect(action).toHaveBeenCalledTimes(2); // Never falls back to the quality-rejected first pair.
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 6, combinedReservedMicroUsd: 201_940 });
    closeContinuationCapability(third.capability);
  });
  it("charges every quality refresh and refuses the ninth hold without reusing a rejected reviewer", async () => {
    const value = await fixture();
    for (let attempt = 0; attempt < 3; attempt++) {
      const admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
      await stages(admitted.capability); recordContinuationDiagnostic(admitted.capability, { phase: "assemble", category: "quality" });
      closeContinuationCapability(admitted.capability);
      expect(continuationProviderLedger().newModelCalls).toBe(3 + attempt * 2);
    }
    const fourth = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await continuationModel(fourth.capability, "sufficiency", "Fixture system", "sufficiency fixture", 1, async () => ({}));
    await continuationModel(fourth.capability, "synthesize", "Fixture system", "synthesize fixture", 1, async () => ({ fixture: "fresh eighth call" }));
    const review = vi.fn(async () => ({ fixture: "unfunded review" }));
    await expect(continuationModel(fourth.capability, "review", "Fixture system", "review fixture", 1, review)).rejects.toThrow("exhausted");
    closeContinuationCapability(fourth.capability);
    expect(review).not.toHaveBeenCalled();
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 8, combinedReservedMicroUsd: 243_260 });
    expect(fs.existsSync(path.join(continuationDirectory(), "prepared-result.json"))).toBe(false);
  });
  it("bounds eight additive holds by all historical reservations without releasing failures", async () => {
    const value = await fixture();
    for (let index = 0; index < 8; index++) {
      const admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
      await expect(continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => { throw Error("fixture transport"); })).rejects.toThrow();
      closeContinuationCapability(admitted.capability);
    }
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 8, combinedReservedMicroUsd: 243_260 });
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow("exhausted");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["hold", "checkpoint", "outcome", "head"])("rejects deleted %s bytes without resetting the next additive allowance", async kind => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => ({ fixture: true })); closeContinuationCapability(admitted.capability);
    const file = kind === "head" ? "ledger-head.json" : `call-01${kind === "hold" ? "" : `-${kind}`}.json`;
    fs.unlinkSync(path.join(continuationDirectory(), file));
    expect(() => continuationProviderLedger()).toThrow("ledger head");
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow("ledger head");
  });
  it("retains a crashed/fsync-uncertain execution intent and never takes it over by age", async () => {
    const value = await fixture();
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, () => { throw Error("fixture directory flush lost"); })).rejects.toThrow("flush lost");
    expect(fs.existsSync(path.join(continuationDirectory(), "execution-lock.json"))).toBe(true);
    vi.setSystemTime("2026-10-07T20:00:00.000Z");
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow();
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not release the lock when normal attempt closure acknowledgement is uncertain", async () => {
    const value = await fixture(); let failClosure = false;
    const admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, () => {
      if (failClosure && fs.existsSync(path.join(continuationDirectory(), "attempt-01-outcome.json"))) throw Error("fixture closure flush lost");
    });
    await continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => ({ fixture: true }));
    failClosure = true; expect(() => closeContinuationCapability(admitted.capability)).toThrow("closure flush lost");
    expect(fs.existsSync(path.join(continuationDirectory(), "execution-lock.json"))).toBe(true);
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow();
  });
  it("rejects post-hold deadline expiry before dispatch without releasing its durable reservation", async () => {
    const value = await fixture(); let expire = false;
    const admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, () => {
      if (expire) vi.setSystemTime(expiresAt);
    });
    expire = true; const action = vi.fn(async () => ({ fixture: true }));
    await expect(continuationModel(admitted.capability, "sufficiency", "s", "u", 1, action)).rejects.toThrow("expired");
    closeContinuationCapability(admitted.capability);
    expect(action).not.toHaveBeenCalled(); expect(continuationProviderLedger().newModelCalls).toBe(1);
  });
  it("revokes and aborts an in-flight request, retaining its lock until the action has settled", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    let resolve!: (value: Record<string, unknown>) => void; let signal!: AbortSignal;
    const active = continuationModel(admitted.capability, "sufficiency", "s", "u", 1, () => {
      signal = continuationSupplierSignal(admitted.capability, 120_000);
      return new Promise(done => { resolve = done; });
    });
    closeContinuationCapability(admitted.capability); expect(signal.aborted).toBe(true);
    expect(fs.existsSync(path.join(continuationDirectory(), "execution-lock.json"))).toBe(true);
    resolve({ fixture: "after revocation" }); await expect(active).rejects.toThrow("revocation");
    expect(fs.existsSync(path.join(continuationDirectory(), "execution-lock.json"))).toBe(false);
    expect(continuationProviderLedger().newModelCalls).toBe(1);
  });
  it("caller mutation of returned binding cannot enlarge the private capability's allowance", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    admitted.binding.authorization.maximumNewModelCalls = 100;
    admitted.binding.authorization.packetSha256 = "a".repeat(64);
    await continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => ({ fixture: true }));
    closeContinuationCapability(admitted.capability);
    expect(continuationProviderLedger().holds[0].hold.packetSha256).toBe(value.packet.packetSha256);
  });
  it("aborts revocation and exact supplier expiry while keeping the dispatched hold consumed", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    vi.setSystemTime("2026-10-08T11:59:59.990Z");
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(duration => { setTimeout(() => controller.abort(), duration); return controller.signal; });
    await expect(continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => {
      const signal = continuationSupplierSignal(admitted.capability, 120_000);
      await vi.advanceTimersByTimeAsync(10); expect(signal.aborted).toBe(true);
      expect(() => assertContinuationSupplierAdmission(admitted.capability)).toThrow("expired");
      return { fixture: "too late" };
    })).rejects.toThrow();
    closeContinuationCapability(admitted.capability); expect(continuationProviderLedger().newModelCalls).toBe(1);
    expect(fs.existsSync(path.join(continuationDirectory(), "call-01-checkpoint.json"))).toBe(false);
  });
  it("prepares and idempotently delivers only the exact same native claim, recovering lost acknowledgement after expiry", async () => {
    const value = await fixture(), admitted = await beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush);
    await stages(admitted.capability);
    const run = syntheticFulfilledRun(admitted.claim).run;
    run.createdAt = receipt;
    run.durationMs = Date.parse(receipt) - Date.parse(admitted.claim.failedOrder.startedAt!);
    // The general native fixture names a different document; adapt only this synthetic public identity.
    run.citations[0].sourceId = run.evidence![0].sourceId = "public:fulfillment:document-1";
    run.originalFulfillment!.providerLedgerSha256 = continuationProviderLedger().sha256;
    const completion = prepareContinuationResult(admitted.capability, run);
    const proof = await verifyPreparedContinuation(value.db);
    expect(completion.claimId).toBe(value.original.claim.claimId); expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    await expect(completePreparedContinuation(value.db, "a".repeat(64), fixtureFlush)).rejects.toThrow("digest changed");
    const complete = vi.mocked(value.db.completeA2aFailedOriginalFulfillment!), implementation = complete.getMockImplementation()!;
    complete.mockImplementationOnce(async input => { await implementation(input); throw Error("fixture acknowledgement lost"); });
    await expect(completePreparedContinuation(value.db, proof.preparedResultSha256, fixtureFlush)).rejects.toThrow("acknowledgement lost");
    expect(retainedContinuationDeliveryResolution(value.old)).toBeNull(); vi.setSystemTime("2026-10-09T12:00:00.000Z");
    expect(await completePreparedContinuation(value.db, proof.preparedResultSha256, fixtureFlush)).toMatchObject({ deliveryCompleted: true, noNewInboundPayment: true });
    expect(await completePreparedContinuation(value.db, proof.preparedResultSha256, fixtureFlush)).toMatchObject({ deliveryCompleted: true });
    expect(retainedContinuationDeliveryResolution(value.old)).toEqual({ outcome: "verified-fulfilled-original", admissionPaused: false,
      paidDeliveryObligation: "resolved", deliveryCompleted: true, refunded: false, noNewInboundPayment: true });
    expect(retainedBusinessCanaryClosure()).toEqual(retainedContinuationDeliveryResolution(value.old));
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("separate source-bound additive supplier epoch", () => {
  it("retains every exhausted parent byte and claim while accounting for a fresh request", async () => {
    const value = await epochFixture(), old = bytes(value.oldDirectory), original = bytes(fulfillmentDirectory());
    expect(await inspectOriginalContinuation(value.db, value.epochFile, value.epochSha256)).toMatchObject({ newModelCalls: 0,
      combinedReservedMicroUsd: 243_260, nativeCompleted: false, providerRequests: 0, payments: 0 });
    await expect(beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush)).rejects.toThrow("not active");
    expect(await activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush)).toMatchObject({ activated: true,
      newModelCalls: 0, combinedReservedMicroUsd: 243_260, nativeClaimChanged: false });
    git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow("superseded");
    git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${"d".repeat(40)}\n`);
    const admitted = await beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush), action = vi.fn(async () => ({ fresh: true }));
    await continuationModel(admitted.capability, "sufficiency", "Fixture system", "sufficiency fixture", 1, action); closeContinuationCapability(admitted.capability);
    expect(action).toHaveBeenCalledOnce();
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 1, oldAdditiveModelCalls: 10, combinedReservedMicroUsd: 263_920 });
    expect(bytes(value.parentDirectory)).toEqual(value.parentBytes); expect(bytes(value.oldDirectory)).toEqual(old);
    expect(bytes(fulfillmentDirectory())).toEqual(original); expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce();
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    await expect(activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush)).rejects.toThrow();
  }, 60_000);
  it("consumes six fresh failures without releasing or borrowing the parent's eight holds", async () => {
    const value = await epochFixture();
    await activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    for (let index = 0; index < 6; index++) {
      const admitted = await beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush);
      await expect(continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => { throw Error("Synthetic fresh failure"); })).rejects.toThrow();
      closeContinuationCapability(admitted.capability);
    }
    const retained = bytes(continuationDirectory());
    expect(continuationProviderLedger()).toMatchObject({ newModelCalls: 6, combinedReservedMicroUsd: 367_220 });
    await expect(beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush)).rejects.toThrow("exhausted");
    expect(bytes(continuationDirectory())).toEqual(retained); expect(bytes(value.parentDirectory)).toEqual(value.parentBytes);
  }, 60_000);
  it("refuses parent changes, grant inflation and missing active journal instead of parent fallback", async () => {
    const value = await epochFixture();
    expect(continuationAuthorizationSchema.safeParse({ ...value.epochAuthorization, maximumNewModelCalls: 7 }).success).toBe(false);
    expect(continuationAuthorizationSchema.safeParse({ ...value.epochAuthorization, maximumCombinedMicroUsd: 500_000 }).success).toBe(false);
    await activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    const paths = fixedPaths(value.root);
    fs.unlinkSync(path.join(paths.epochDirectory, "authorization.json"));
    expect(() => continuationDirectory()).toThrow();
    await expect(beginOriginalContinuation(value.db, value.file, value.sha256, fixtureFlush)).rejects.toThrow();
    expect(bytes(value.parentDirectory)).toEqual(value.parentBytes);
  }, 60_000);
  it("rejects a changed parent raw ledger before any new epoch intent or model dispatch", async () => {
    const value = await epochFixture(); fs.unlinkSync(path.join(value.parentDirectory, "call-01.json"));
    await expect(activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush)).rejects.toThrow("ledger head");
    expect(fs.existsSync(fixedPaths(value.root).anchorDirectory)).toBe(false); expect(fetch).not.toHaveBeenCalled();
  }, 60_000);
  it("rejects a whole journal restored to its initial snapshot against the external frontier", async () => {
    const value = await epochFixture(); await activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    const directory = continuationDirectory(), initial = bytes(directory);
    expect(directory).toBe(fixedPaths(value.root).epochDirectory);
    const admitted = await beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    await continuationModel(admitted.capability, "sufficiency", "s", "u", 1, async () => ({ fixture: true })); closeContinuationCapability(admitted.capability);
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name); expect(path.dirname(file)).toBe(directory);
      expect(fs.lstatSync(file).isFile()).toBe(true); fs.unlinkSync(file);
    }
    for (const [name, raw] of initial) fs.writeFileSync(path.join(directory, name), Buffer.from(raw, "hex"), { mode: 0o600 });
    expect(() => continuationDirectory()).toThrow();
    await expect(beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush)).rejects.toThrow();
    expect(bytes(value.parentDirectory)).toEqual(value.parentBytes); expect(fetch).not.toHaveBeenCalled();
  }, 60_000);
  it("keeps an external update fence and execution lock when held-byte publication is uncertain", async () => {
    const value = await epochFixture(); await activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    const paths = fixedPaths(value.root), action = vi.fn(async () => ({ fixture: true }));
    const admitted = await beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, directory => {
      if (directory === paths.epochDirectory && fs.existsSync(path.join(directory, "call-01.json"))) throw Error("Synthetic hold publication lost");
    });
    await expect(continuationModel(admitted.capability, "sufficiency", "s", "u", 1, action)).rejects.toThrow("publication lost");
    expect(action).not.toHaveBeenCalled(); expect(fs.existsSync(paths.ledgerUpdateLockFile)).toBe(true);
    expect(fs.existsSync(path.join(paths.epochDirectory, "execution-lock.json"))).toBe(true);
    expect(() => continuationDirectory()).toThrow();
    await expect(beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush)).rejects.toThrow();
    expect(bytes(value.parentDirectory)).toEqual(value.parentBytes);
  }, 60_000);
  it("delivers the exact same original after fresh reviewed stages, preserving every parent hold", async () => {
    const value = await epochFixture();
    await activateOriginalContinuationEpoch(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    const admitted = await beginOriginalContinuation(value.db, value.epochFile, value.epochSha256, fixtureFlush);
    await stages(admitted.capability); const run = preparedRun(admitted);
    prepareContinuationResult(admitted.capability, run);
    const proof = await verifyPreparedContinuation(value.db);
    vi.setSystemTime("2026-10-09T12:00:00.000Z");
    expect(await completePreparedContinuation(value.db, proof.preparedResultSha256, fixtureFlush)).toMatchObject({ deliveryCompleted: true, noNewInboundPayment: true });
    expect(retainedContinuationDeliveryResolution(value.old)).toMatchObject({ deliveryCompleted: true, admissionPaused: false });
    expect(bytes(value.parentDirectory)).toEqual(value.parentBytes); expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce();
  }, 60_000);
});
