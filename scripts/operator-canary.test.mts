import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readonly: vi.fn(), writer: vi.fn(), verify: vi.fn(), closeFailed: vi.fn(),
  configured: vi.fn(), closure: vi.fn() }));
vi.mock("../lib/db/application-storage.ts", () => ({ createReadonlyApplicationStorage: mocks.readonly }));
vi.mock("../lib/db/index.ts", () => ({ getDb: mocks.writer }));
vi.mock("../lib/business-operator/canary-policy.ts", () => ({ verifyFailedBusinessCanary: mocks.verify,
  closeVerifiedFailedBusinessCanary: mocks.closeFailed, configuredBusinessCanary: mocks.configured,
  retainedBusinessCanaryClosure: mocks.closure, activateBusinessCanary: vi.fn(), assertPreparedCanarySubmission: vi.fn(),
  assertCanaryOriginalReserved: vi.fn(), businessCanaryHostIdentity: vi.fn(), closeVerifiedBusinessCanary: vi.fn(),
  readPreparedBusinessCanaryIntent: vi.fn() }));
import { runOperatorCanary } from "./operator-canary.mts";

const proof = { outcome: "verified-failed-original", paidDeliveryObligation: "unresolved", admissionPaused: true,
  deliveryCompleted: false, refunded: false, originalEvidenceSha256: "e".repeat(64),
  providerLedger: { sha256: "a".repeat(64), modelCalls: 1, searchCalls: 2, reservedMicroUsd: 36660 } };
const dispose = vi.fn(), db = Object.freeze({ close: dispose });
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.readonly.mockResolvedValue(db); mocks.verify.mockResolvedValue(proof); mocks.closeFailed.mockResolvedValue(proof);
  mocks.configured.mockReturnValue(null); mocks.closure.mockReturnValue(proof); });
afterEach(() => vi.restoreAllMocks());

describe("metadata-only failed canary CLI", () => {
  it.each(["verify-failed", "close-failed"])("%s uses only selected readonly storage and prints failure/obligation without completion or private rows", async command => {
    await runOperatorCanary([command]);
    expect(mocks.readonly).toHaveBeenCalledExactlyOnceWith(); expect(mocks.writer).not.toHaveBeenCalled();
    expect(command === "verify-failed" ? mocks.verify : mocks.closeFailed).toHaveBeenCalledWith(db);
    const output = JSON.parse(vi.mocked(console.log).mock.calls[0][0]);
    expect(output).toEqual({ command, readOnly: command === "verify-failed", verified: true, closed: command === "close-failed",
      ...proof, signatures: 0, payments: 0, providerRequests: 0 });
    expect(output).not.toHaveProperty("completed"); expect(output).not.toHaveProperty("queryId");
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("refuses missing or uncertain native proof without reporting success and still closes the readonly handle", async () => {
    mocks.verify.mockRejectedValue(Error("Synthetic exact proof unavailable"));
    await expect(runOperatorCanary(["verify-failed"])).rejects.toThrow("proof unavailable");
    expect(console.log).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalledOnce();
    mocks.readonly.mockResolvedValue(undefined);
    await expect(runOperatorCanary(["close-failed"])).rejects.toThrow("readonly proof unavailable");
    expect(mocks.closeFailed).not.toHaveBeenCalled(); expect(mocks.writer).not.toHaveBeenCalled();
  });
  it("rejects extra arguments before opening a store and exposes the retained unresolved pause in status", async () => {
    await expect(runOperatorCanary(["close-failed", "--force"])).rejects.toThrow("Unknown canary command");
    expect(mocks.readonly).not.toHaveBeenCalled(); await runOperatorCanary(["status"]);
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({ configured: false, closure: proof });
  });
});
