import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillmentFixture, fixtureNow, fixtureCommit, fixtureFlush, cleanFulfillmentFixtures } from "./fulfillment-test-fixture";
import { beginFailedOriginalFulfillment, closeFulfillmentCapability, fulfillmentDirectory, fulfillmentStep, reserveFulfillmentModel } from "./fulfillment-policy";
import { canaryExecutionPaused, canaryResearchPaused, assertOrdinaryCanarySupplierAdmission, admitBusinessCanaryRun,
  reserveCanarySearch, reserveCanaryInboundSettlement, assertCanaryOriginalReserved } from "./canary-policy";
import { inspectFailedCanaryResearchIsolation, isolateFailedCanaryResearch, canaryResearchIsolationDirectory } from "./canary-research-isolation";
import { runAgent } from "../agent/run-agent";
import { HeuristicEngine } from "../llm/heuristic-engine";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), execFileSync: git }));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureNow);
  git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No provider permitted"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); cleanFulfillmentFixtures(); });
async function failedClaim() {
  const value = await fulfillmentFixture();
  const admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
  await fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "fixture", 1));
  await expect(fulfillmentStep(admitted.capability, "synthesize", async () => {
    reserveFulfillmentModel(admitted.capability, "fixture", "generation", 1); throw Error("Synthetic provider failure");
  })).rejects.toThrow("Synthetic");
  closeFulfillmentCapability(admitted.capability);
  return { ...value, admitted };
}
const bytes = (directory: string) => fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), "hex")]);
describe("expired failed original isolation", () => {
  it("restores only ordinary research, retaining the unpaid-delivery obligation and permanent consumed execution", async () => {
    const value = await failedClaim(), old = bytes(value.oldDirectory), partial = bytes(fulfillmentDirectory());
    vi.setSystemTime(value.authorization.expiresAt);
    const proof = await inspectFailedCanaryResearchIsolation(value.db);
    expect(proof).toMatchObject({ newModelHolds: 2, combinedReservedMicroUsd: 77980, originalDelivered: false, paidDeliveryObligation: "unresolved" });
    const result = await isolateFailedCanaryResearch(value.db, proof.evidenceSha256, fixtureFlush);
    expect(result).toMatchObject({ ordinaryResearchRestored: true, operatorAdmissionPaused: true, originalDelivered: false, originalRefunded: false, newSupplierAuthority: false });
    expect(canaryResearchPaused()).toBe(false); expect(() => assertOrdinaryCanarySupplierAdmission()).not.toThrow();
    expect(canaryExecutionPaused()).toBe(true);
    for (const origin of ["web", "mcp", "engine"]) expect(admitBusinessCanaryRun({ queryId: "new-interactive-query", question: "new question", origin, privateScope: false })).toBeNull();
    expect(() => reserveCanarySearch("new interactive search")).not.toThrow();
    for (const input of [
      { queryId: "new-paid-query", question: "new", origin: "a2a", privateScope: false },
      { queryId: "new-private-query", question: "new", origin: "web", privateScope: true },
      { queryId: value.old.original.queryId, question: value.old.question, origin: "engine", privateScope: false },
    ]) expect(() => admitBusinessCanaryRun(input)).toThrow();
    expect(() => reserveCanaryInboundSettlement()).toThrow(); expect(() => assertCanaryOriginalReserved()).toThrow();
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow();
    expect(() => reserveFulfillmentModel(value.admitted.capability, "fixture", "retry", 1)).toThrow();
    expect(bytes(value.oldDirectory)).toEqual(old); expect(bytes(fulfillmentDirectory())).toEqual(partial);
    expect(await isolateFailedCanaryResearch(value.db, proof.evidenceSha256, fixtureFlush)).toEqual(result);
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce();
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("requires supplier expiry and a matching native permanent claim", async () => {
    const value = await failedClaim();
    await expect(inspectFailedCanaryResearchIsolation(value.db)).rejects.toThrow();
    expect(fs.existsSync(canaryResearchIsolationDirectory())).toBe(false);
    vi.setSystemTime(value.authorization.expiresAt);
    vi.mocked(value.db.getA2aFailedOriginalFulfillment!).mockResolvedValueOnce(null);
    await expect(inspectFailedCanaryResearchIsolation(value.db)).rejects.toThrow();
    expect(canaryResearchPaused()).toBe(true);
  });
  it("admits the actual ordinary orchestrator while retaining the Operator hold", async () => {
    const value = await failedClaim(); vi.setSystemTime(value.authorization.expiresAt);
    const proof = await inspectFailedCanaryResearchIsolation(value.db);
    await isolateFailedCanaryResearch(value.db, proof.evidenceSha256, fixtureFlush);
    const engine = new HeuristicEngine(), decompose = vi.spyOn(engine, "decompose");
    const saved = vi.fn(), db = { listSources: async () => [], loadQueryMemories: async () => [],
      saveQueryMemory: async () => {}, saveQueryRun: saved, recordActivationEvent: async () => {},
      getCached: async () => null, getCachedAt: async () => null, setCached: async () => {},
      recordPayment: vi.fn(), getSourceNotify: async () => null } as unknown as KeryxDB;
    const generator = runAgent({ queryId: "interactive-isolation-fixture", question: "Explain a synthetic fixture with evidence gaps", origin: "web", budget: 0, researchMode: "quick" },
      { engine, db, gateway: { mode: "offline" } as PaymentGateway, discoverExternal: async () => [] });
    let step = await generator.next(); while (!step.done) step = await generator.next();
    expect(step.value.id).toBe("interactive-isolation-fixture"); expect(decompose).toHaveBeenCalled();
    expect(step.value.paymentMode).toBe("offline"); expect(step.value.paymentAttempts).toBe(0);
    expect(db.recordPayment).not.toHaveBeenCalled();
    expect(canaryExecutionPaused()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not isolate three held calls that could still prepare metadata", async () => {
    const value = await fulfillmentFixture(), admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    await fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "sufficiency", 1));
    await fulfillmentStep(admitted.capability, "synthesize", async () => {
      reserveFulfillmentModel(admitted.capability, "fixture", "generation", 1); reserveFulfillmentModel(admitted.capability, "fixture", "review", 1);
    });
    vi.setSystemTime(value.authorization.expiresAt);
    await expect(inspectFailedCanaryResearchIsolation(value.db)).rejects.toThrow("prepared-result recovery");
    expect(canaryResearchPaused()).toBe(true);
  });
  it("refuses a forged reviewed digest, a prepared result and uncertain native completion", async () => {
    const value = await failedClaim(); vi.setSystemTime(value.authorization.expiresAt);
    await expect(isolateFailedCanaryResearch(value.db, "f".repeat(64), fixtureFlush)).rejects.toThrow();
    expect(fs.existsSync(canaryResearchIsolationDirectory())).toBe(false);
    vi.mocked(value.db.hasA2aFailedOriginalFulfillment!).mockResolvedValueOnce(true);
    await expect(inspectFailedCanaryResearchIsolation(value.db)).rejects.toThrow();
    fs.writeFileSync(path.join(fulfillmentDirectory(), "prepared-result.json"), "{}", { mode: 0o600 });
    await expect(inspectFailedCanaryResearchIsolation(value.db)).rejects.toThrow();
  });
  it("fails closed if a retained hold changes or the isolation marker is removed", async () => {
    const value = await failedClaim(); vi.setSystemTime(value.authorization.expiresAt);
    const proof = await inspectFailedCanaryResearchIsolation(value.db);
    await isolateFailedCanaryResearch(value.db, proof.evidenceSha256, fixtureFlush);
    const hold = path.join(fulfillmentDirectory(), "model-03.json"), original = fs.readFileSync(hold);
    fs.writeFileSync(hold, JSON.stringify({ ...JSON.parse(original.toString()), inputBytes: 100 }));
    expect(canaryResearchPaused()).toBe(true); expect(() => assertOrdinaryCanarySupplierAdmission()).toThrow();
    fs.writeFileSync(hold, original); expect(canaryResearchPaused()).toBe(false);
    fs.unlinkSync(path.join(canaryResearchIsolationDirectory(), "isolated.json"));
    expect(canaryResearchPaused()).toBe(true);
  });
  it("refuses native drift across awaited observations and preserves ambiguous fsync evidence", async () => {
    const value = await failedClaim(); vi.setSystemTime(value.authorization.expiresAt);
    const proof = await inspectFailedCanaryResearchIsolation(value.db);
    vi.mocked(value.db.getA2aFailedOriginalFulfillment!).mockResolvedValueOnce(null);
    await expect(isolateFailedCanaryResearch(value.db, proof.evidenceSha256, fixtureFlush)).rejects.toThrow();
    await expect(isolateFailedCanaryResearch(value.db, proof.evidenceSha256, () => { throw Error("Fixture fsync failure"); })).rejects.toThrow("fsync");
    expect(fs.existsSync(path.join(canaryResearchIsolationDirectory(), "isolated.json"))).toBe(false);
    expect(fs.existsSync(path.join(canaryResearchIsolationDirectory(), "pending.json"))).toBe(true);
    expect(canaryExecutionPaused()).toBe(true); expect(canaryResearchPaused()).toBe(true);
    expect(() => assertOrdinaryCanarySupplierAdmission()).toThrow();
  });
  it("rolls a final publication fsync failure back to a held pending record", async () => {
    const value = await failedClaim(); vi.setSystemTime(value.authorization.expiresAt);
    const proof = await inspectFailedCanaryResearchIsolation(value.db); let flushes = 0;
    await expect(isolateFailedCanaryResearch(value.db, proof.evidenceSha256, () => {
      if (++flushes === 3) throw Error("Fixture final publication fsync failure");
    })).rejects.toThrow("final publication");
    expect(fs.existsSync(path.join(canaryResearchIsolationDirectory(), "isolated.json"))).toBe(false);
    expect(fs.existsSync(path.join(canaryResearchIsolationDirectory(), "pending.json"))).toBe(true);
    expect(canaryResearchPaused()).toBe(true);
  });
  it("retains the pending hold when native proof changes after staging", async () => {
    const value = await failedClaim(); vi.setSystemTime(value.authorization.expiresAt);
    const proof = await inspectFailedCanaryResearchIsolation(value.db);
    await expect(isolateFailedCanaryResearch(value.db, proof.evidenceSha256, () => {
      vi.mocked(value.db.hasA2aFailedOriginalFulfillment!).mockResolvedValueOnce(true);
    })).rejects.toThrow();
    expect(fs.existsSync(path.join(canaryResearchIsolationDirectory(), "isolated.json"))).toBe(false);
    expect(canaryResearchPaused()).toBe(true);
  });
});
