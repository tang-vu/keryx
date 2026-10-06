import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ binding: vi.fn(), packet: vi.fn(), preflight: vi.fn(), execute: vi.fn(), verify: vi.fn(), complete: vi.fn(),
  writer: vi.fn(), readonly: vi.fn(), identity: vi.fn(), close: vi.fn(), ledger: vi.fn(), delivery: vi.fn(), old: vi.fn() }));
vi.mock("../lib/business-operator/fulfillment-policy.ts", () => ({ readFulfillmentAuthorization: calls.binding,
  readFrozenFulfillmentPacket: calls.packet, completePreparedFulfillment: calls.complete, verifyPreparedFulfillment: calls.verify,
  fulfillmentProviderLedger: calls.ledger, retainedFulfillmentDeliveryResolution: calls.delivery }));
vi.mock("../lib/a2a/fulfill-original.ts", () => ({ fulfillCanaryOriginal: calls.execute, preflightOriginalFulfillment: calls.preflight }));
vi.mock("../lib/business-operator/canary-policy.ts", () => ({ retainedFailedBusinessCanaryAuthority: calls.old }));
vi.mock("../lib/db/application-storage.ts", () => ({ createApplicationStorage: calls.writer, createReadonlyApplicationStorage: calls.readonly,
  applicationSqliteIdentity: calls.identity }));
import { runFulfillCanaryOriginal } from "./fulfill-canary-original.mts";
const digest = "a".repeat(64), binding = { frozen: true }, db = { close: calls.close };
beforeEach(() => {
  for (const mock of Object.values(calls)) mock.mockReset();
  calls.binding.mockReturnValue(binding); calls.writer.mockResolvedValue(db); calls.readonly.mockResolvedValue(db);
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(() => { throw Error("No CLI network fixture"); }));
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-fixture-key");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("private original-fulfillment CLI role boundaries", () => {
  it("performs preflight without opening any database or supplier", async () => {
    calls.preflight.mockResolvedValue({ providerRequests: 0, payments: 0 });
    await runFulfillCanaryOriginal(["preflight", "--authorization", "/protected/authorization.json", "--sha256", digest]);
    expect(calls.binding).toHaveBeenCalledWith("/protected/authorization.json", digest, false);
    expect(calls.preflight).toHaveBeenCalledWith(binding); expect(calls.writer).not.toHaveBeenCalled();
    expect(calls.readonly).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("execute stages only on the enrolled native writer and never auto-completes", async () => {
    calls.execute.mockResolvedValue({ prepared: true, paidDeliveryObligation: "unresolved" });
    await runFulfillCanaryOriginal(["execute", "--authorization", "/protected/authorization.json", "--sha256", digest]);
    expect(calls.identity).toHaveBeenCalledWith(db, "write");
    expect(calls.execute).toHaveBeenCalledWith(db, "/protected/authorization.json", digest, "synthetic-fixture-key");
    expect(calls.complete).not.toHaveBeenCalled(); expect(calls.close).toHaveBeenCalledOnce();
  });
  it("verify-prepared uses only the selected readonly facade and prints no raw run/question", async () => {
    calls.verify.mockResolvedValue({ preparedResultSha256: digest, completion: { runSha256: digest, providerLedgerSha256: digest,
      run: { question: "Private fixture question must stay private", answer: "Private fixture answer" } } });
    await runFulfillCanaryOriginal(["verify-prepared"]);
    expect(calls.readonly).toHaveBeenCalledOnce(); expect(calls.writer).not.toHaveBeenCalled(); expect(calls.identity).toHaveBeenCalledWith(db, "read");
    expect(calls.close).toHaveBeenCalledOnce(); const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain(digest); expect(output).not.toContain("Private fixture"); expect(calls.execute).not.toHaveBeenCalled();
  });
  it("requires exact prepared result acceptance before opening a writer", async () => {
    await expect(runFulfillCanaryOriginal(["complete-prepared"])).rejects.toThrow("exact reviewed");
    expect(calls.writer).not.toHaveBeenCalled();
    calls.complete.mockResolvedValue({ outcome: "verified-fulfilled-original", deliveryCompleted: true, paidDeliveryObligation: "resolved",
      refunded: false, runSha256: digest });
    await runFulfillCanaryOriginal(["complete-prepared", "--prepared-sha256", digest]);
    expect(calls.complete).toHaveBeenCalledWith(db, digest); expect(calls.execute).not.toHaveBeenCalled();
    expect(calls.close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses missing enrolled authority without fallback or ordinary initialization", async () => {
    calls.readonly.mockResolvedValue(undefined);
    await expect(runFulfillCanaryOriginal(["verify-prepared"])).rejects.toThrow("native authority unavailable");
    expect(calls.writer).not.toHaveBeenCalled(); expect(calls.verify).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled();
  });
  it.each([{ args: ["execute", "--authorization", "/protected/authorization.json", "--sha256", digest, "--retry"] },
    { args: ["complete-prepared", "--prepared-sha256", digest, "--force"] }, { args: ["verify-prepared", "--force"] }])("refuses renewal/retry/force arguments before storage %#", async ({ args }) => {
    await expect(runFulfillCanaryOriginal(args)).rejects.toThrow(); expect(calls.writer).not.toHaveBeenCalled(); expect(calls.readonly).not.toHaveBeenCalled();
  });
  it("disposes the facade after an uncertain native acknowledgement without claiming completion", async () => {
    calls.complete.mockRejectedValue(Error("Synthetic acknowledgement uncertainty"));
    await expect(runFulfillCanaryOriginal(["complete-prepared", "--prepared-sha256", digest])).rejects.toThrow("uncertainty");
    expect(calls.close).toHaveBeenCalledOnce(); expect(console.log).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled();
  });
});
