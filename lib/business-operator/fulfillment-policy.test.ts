import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillmentFixture, fixtureNow, fixtureCommit, fixtureFlush, cleanFulfillmentFixtures } from "./fulfillment-test-fixture";
import { beginFailedOriginalFulfillment, closeFulfillmentCapability, fulfillmentDirectory, fulfillmentProviderLedger,
  fulfillmentStep, readFulfillmentAuthorization, reserveFulfillmentModel, retainedFulfillmentDeliveryResolution } from "./fulfillment-policy";
import { fulfillmentSupplierSignal, assertFulfillmentSupplierAdmission } from "./fulfillment-policy";
import { canaryExecutionPaused, configuredBusinessCanary, assertOrdinaryCanarySupplierAdmission } from "./canary-policy";
const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: git }));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureNow);
  git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in policy tests"); }));
});
afterEach(() => { cleanFulfillmentFixtures(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("one-shot failed-original fulfillment authority", () => {
  it("accepts only the reviewed three-call additive authorization, irrespective of the historical ceiling", async () => {
    const value = await fulfillmentFixture();
    fs.writeFileSync(value.authorizationFile, JSON.stringify({ ...value.authorization, maximumNewModelCalls: 10 }));
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow();
    expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(canaryExecutionPaused()).toBe(true);
  });
  it("reads exact retained old authority without releasing admission or writing any ledger", async () => {
    const value = await fulfillmentFixture(), before = fs.readdirSync(value.oldDirectory).map(name => [name, fs.readFileSync(path.join(value.oldDirectory, name), "hex")]);
    expect(readFulfillmentAuthorization(value.authorizationFile, value.authorizationDigest).authority.original).toEqual(value.old.original);
    expect(configuredBusinessCanary()).toBeNull(); expect(canaryExecutionPaused()).toBe(true);
    expect(() => assertOrdinaryCanarySupplierAdmission()).toThrow("held");
    expect(retainedFulfillmentDeliveryResolution(value.old)).toBeNull();
    expect(fs.readdirSync(fulfillmentDirectory())).toEqual([]);
    expect(fs.readdirSync(value.oldDirectory).map(name => [name, fs.readFileSync(path.join(value.oldDirectory, name), "hex")])).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains exclusive intent and native same-original claim before granting any model capability", async () => {
    const value = await fulfillmentFixture();
    const admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce();
    expect(fs.readdirSync(fulfillmentDirectory()).sort()).toEqual(["authorization.json", "claim.json"]);
    expect(() => reserveFulfillmentModel(admitted.capability, "fixture", "outside scope", 1)).toThrow("opaque");
    await fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "data", 1));
    await fulfillmentStep(admitted.capability, "synthesize", async () => {
      reserveFulfillmentModel(admitted.capability, "fixture", "generation", 1);
      reserveFulfillmentModel(admitted.capability, "fixture", "review", 1);
      expect(() => reserveFulfillmentModel(admitted.capability, "fixture", "extra", 1)).toThrow("opaque");
    });
    expect(fulfillmentProviderLedger()).toMatchObject({ newModelCalls: 3, reservedMicroUsd: 61980, combinedReservedMicroUsd: 98640 });
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow("already retained");
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce();
    expect(value.order.status).toBe("failed"); expect(canaryExecutionPaused()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("cannot manufacture or reuse a revoked capability or replay a semantic step", async () => {
    const value = await fulfillmentFixture(), admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    expect(() => reserveFulfillmentModel({} as typeof admitted.capability, "x", "x", 1)).toThrow("opaque");
    await expect(fulfillmentStep(admitted.capability, "synthesize", async () => true)).rejects.toThrow("step refused");
    await expect(fulfillmentStep(admitted.capability, "sufficiency", async () => { throw Error("synthetic outage"); })).rejects.toThrow("synthetic outage");
    await expect(fulfillmentStep(admitted.capability, "sufficiency", async () => true)).rejects.toThrow("revoked");
    closeFulfillmentCapability(admitted.capability);
    expect(fulfillmentProviderLedger().newModelCalls).toBe(0);
  });
  it.each(["input", "document", "tariff", "old-hold", "closure"])("refuses changed %s bytes before a claim or request", async kind => {
    const value = await fulfillmentFixture();
    const file = kind === "input" ? value.authorization.inputFile : kind === "document" ? path.join(value.root, "document-1.txt") :
      kind === "tariff" ? value.authorization.tariffFile : path.join(value.oldDirectory, kind === "old-hold" ? "model-01.json" : "closed.json");
    fs.appendFileSync(file, " ");
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow();
    expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(canaryExecutionPaused()).toBe(true);
  });
  it("keeps metadata observation available after the fixed supplier deadline but refuses supplier admission", async () => {
    const value = await fulfillmentFixture(); vi.setSystemTime("2026-10-07T00:00:00.000Z");
    expect(readFulfillmentAuthorization(value.authorizationFile, value.authorizationDigest).authorization.expiresAt).toBe("2026-10-07T00:00:00.000Z");
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow("expired");
    expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled(); expect(canaryExecutionPaused()).toBe(true);
  });
  it("refuses source mismatch before any durable intent", async () => {
    const value = await fulfillmentFixture(); git.mockReturnValue("d".repeat(40));
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow("clean reviewed commit");
    expect(fs.readdirSync(fulfillmentDirectory())).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it("retains native-claim acknowledgement uncertainty and cannot execute again", async () => {
    const value = await fulfillmentFixture(); vi.mocked(value.db.claimA2aFailedOriginalFulfillment!).mockRejectedValue(Error("synthetic acknowledgement loss"));
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow("acknowledgement loss");
    expect(fs.existsSync(path.join(fulfillmentDirectory(), "claim.json"))).toBe(true);
    await expect(beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush)).rejects.toThrow("already retained");
    expect(value.db.claimA2aFailedOriginalFulfillment).toHaveBeenCalledOnce(); expect(canaryExecutionPaused()).toBe(true);
  });
  it("does not dispatch after a durable reservation crosses expiry, retaining its full cost", async () => {
    const value = await fulfillmentFixture(); let syncs = 0;
    const admitted = await beginFailedOriginalFulfillment(value.db, value.binding, () => { if (++syncs === 3) vi.setSystemTime("2026-10-07T00:00:00.000Z"); });
    await expect(fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "data", 1))).rejects.toThrow("expired");
    expect(fulfillmentProviderLedger()).toMatchObject({ newModelCalls: 1, combinedReservedMicroUsd: 57320 });
    expect(fetch).not.toHaveBeenCalled(); expect(canaryExecutionPaused()).toBe(true);
  });
  it.each(["empty", "modified", "deleted", "extra"])("refuses %s new ledger slots and retains ordinary admission hold", async kind => {
    const value = await fulfillmentFixture(), admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    await fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "data", 1));
    const file = path.join(fulfillmentDirectory(), "model-02.json");
    if (kind === "empty") fs.writeFileSync(file, "");
    else if (kind === "modified") fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("20660", "0"));
    else if (kind === "deleted") fs.unlinkSync(file);
    else fs.writeFileSync(path.join(fulfillmentDirectory(), "search-01.json"), "{}", { mode: 0o600 });
    await expect(fulfillmentStep(admitted.capability, "synthesize", async () => reserveFulfillmentModel(admitted.capability, "fixture", "new", 1))).rejects.toThrow();
    expect(canaryExecutionPaused()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses byte overflow without silently truncating input or reserving a model slot", async () => {
    const value = await fulfillmentFixture(), admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    await expect(fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "é".repeat(32000), 1))).rejects.toThrow("input/output");
    expect(fulfillmentProviderLedger().newModelCalls).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts held dispatch at the fixed supplier deadline and refuses any later dispatch", async () => {
    const value = await fulfillmentFixture(), admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    vi.setSystemTime("2026-10-06T23:59:59.990Z");
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(duration => {
      setTimeout(() => deadline.abort(), duration); return deadline.signal;
    });
    await fulfillmentStep(admitted.capability, "sufficiency", async () => {
      reserveFulfillmentModel(admitted.capability, "fixture", "data", 1);
      const signal = fulfillmentSupplierSignal(admitted.capability, 120000);
      expect(timeout).toHaveBeenCalledWith(10); expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(signal.aborted).toBe(true); expect(() => assertFulfillmentSupplierAdmission(admitted.capability)).toThrow("expired");
    });
    expect(fulfillmentProviderLedger()).toMatchObject({ newModelCalls: 1, combinedReservedMicroUsd: 57320 });
  });
  it("revocation aborts the in-flight supplier signal without releasing its held slot", async () => {
    const value = await fulfillmentFixture(), admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
    await fulfillmentStep(admitted.capability, "sufficiency", async () => {
      reserveFulfillmentModel(admitted.capability, "fixture", "data", 1);
      const signal = fulfillmentSupplierSignal(admitted.capability, 120000);
      closeFulfillmentCapability(admitted.capability);
      expect(signal.aborted).toBe(true); expect(() => assertFulfillmentSupplierAdmission(admitted.capability)).toThrow("revoked");
    });
    expect(fulfillmentProviderLedger().newModelCalls).toBe(1);
  });
});
