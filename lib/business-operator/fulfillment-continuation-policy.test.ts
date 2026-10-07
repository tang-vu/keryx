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
import { inspectOriginalContinuation } from "./fulfillment-continuation-policy";
import { businessCanaryHostIdentity, retainedBusinessCanaryClosure } from "./canary-policy";
import { fulfillmentSha256 as hash, fulfillmentObjectSha256 as hashObject } from "../a2a/failed-original-fulfillment-protocol";
import { syntheticFulfilledRun } from "../db/a2a-fulfillment-fixture";

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
function bytes(directory: string) {
  return fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), "hex")]);
}
async function stages(capability: ContinuationCapability) {
  for (const stage of ["sufficiency", "synthesize", "review"] as const)
    await continuationModel(capability, stage, "Fixture system", `${stage} fixture`, 1, async () => ({ fixture: stage }));
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
