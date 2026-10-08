import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ binding: vi.fn(), inspect: vi.fn(), preflight: vi.fn(), execute: vi.fn(), verify: vi.fn(), complete: vi.fn(),
  activate: vi.fn(), qualityEvidence: vi.fn(), writer: vi.fn(), readonly: vi.fn(), identity: vi.fn(), close: vi.fn() }));
vi.mock("../lib/business-operator/fulfillment-continuation-policy.ts", () => ({ readContinuationAuthorization: calls.binding,
  inspectOriginalContinuation: calls.inspect, completePreparedContinuation: calls.complete, verifyPreparedContinuation: calls.verify,
  activateOriginalContinuationEpoch: calls.activate, continuationReadOnlyQualityEvidenceCapability: calls.qualityEvidence }));
vi.mock("../lib/a2a/continue-original.ts", () => ({ completeOriginalContinuation: calls.execute,
  preflightOriginalContinuation: calls.preflight }));
vi.mock("../lib/db/application-storage.ts", () => ({ createApplicationStorage: calls.writer, createReadonlyApplicationStorage: calls.readonly,
  applicationSqliteIdentity: calls.identity }));
import { continuationCliFailure, runContinueCanaryOriginal } from "./continue-canary-original.mts";
const digest = "a".repeat(64), original = { frozen: true }, db = { close: calls.close };
beforeEach(() => {
  for (const mock of Object.values(calls)) mock.mockReset();
  calls.binding.mockReturnValue({ original }); calls.writer.mockResolvedValue(db); calls.readonly.mockResolvedValue(db);
  calls.preflight.mockResolvedValue({ prompts: [{ promptUtf8Bytes: 1234 }] });
  calls.inspect.mockResolvedValue({ nativeCompleted: false, claim: { privateId: "PRIVATE-FIXTURE" }, binding: { question: "PRIVATE-FIXTURE" } });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No CLI network fixture"); })); vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-fixture-key");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("private original continuation CLI boundaries", () => {
  it("preflights fresh native identity using only readonly storage, no supplier", async () => {
    await runContinueCanaryOriginal(["preflight", "--authorization", "/protected/grant.json", "--sha256", digest]);
    expect(calls.binding).toHaveBeenCalledWith("/protected/grant.json", digest, false);
    expect(calls.inspect).toHaveBeenCalledWith(db, "/protected/grant.json", digest);
    expect(calls.preflight).toHaveBeenCalledWith(original, undefined, undefined); expect(calls.identity).toHaveBeenCalledWith(db, "read");
    expect(calls.writer).not.toHaveBeenCalled(); expect(calls.close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls[0][0]).not.toContain("PRIVATE-FIXTURE");
  });
  it("preflights the protected supplemental context without supplier or writer admission", async () => {
    const supplement = Object.freeze({ contextSha256: digest, privateEvidence: "PRIVATE-SUPPLEMENT" });
    calls.binding.mockReturnValue({ original, supplement });
    await runContinueCanaryOriginal(["preflight", "--authorization", "/protected/epoch3.json", "--sha256", digest]);
    expect(calls.preflight).toHaveBeenCalledWith(original, supplement, undefined);
    expect(calls.preflight.mock.calls[0][1]).toBe(supplement);
    expect(calls.identity).toHaveBeenCalledWith(db, "read");
    expect(calls.writer).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled();
    expect(calls.complete).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(calls.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("PRIVATE-SUPPLEMENT");
  });
  it("execute prepares using existing native claim without automatically delivering", async () => {
    calls.execute.mockResolvedValue({ prepared: true, paidDeliveryObligation: "unresolved" });
    await runContinueCanaryOriginal(["execute", "--authorization", "/protected/grant.json", "--sha256", digest]);
    expect(calls.binding).toHaveBeenCalledWith("/protected/grant.json", digest, true);
    expect(calls.identity).toHaveBeenCalledWith(db, "write");
    expect(calls.execute).toHaveBeenCalledWith(db, "/protected/grant.json", digest, "synthetic-fixture-key");
    expect(calls.complete).not.toHaveBeenCalled(); expect(calls.close).toHaveBeenCalledOnce();
  });
  it("enrolls quality preflight evidence only after fresh native claim observation", async () => {
    const supplement = Object.freeze({ contextSha256: digest });
    const binding = { original, supplement, qualityProtocol: "same-evidence-prepared-quality-v1" };
    const claim = Object.freeze({ claimId: "retained-native-claim" });
    const token = Object.freeze({});
    calls.binding.mockReturnValue(binding); calls.inspect.mockResolvedValue({ claim });
    calls.qualityEvidence.mockReturnValue(token);
    await runContinueCanaryOriginal(["preflight", "--authorization", "/protected/epoch4.json", "--sha256", digest]);
    expect(calls.qualityEvidence).toHaveBeenCalledWith(binding, claim);
    expect(calls.inspect.mock.invocationCallOrder[0]).toBeLessThan(calls.qualityEvidence.mock.invocationCallOrder[0]);
    expect(calls.preflight).toHaveBeenCalledWith(original, supplement, token);
    expect(calls.writer).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("stops quality prompt preparation when protected native enrollment refuses", async () => {
    calls.binding.mockReturnValue({ original, qualityProtocol: "same-evidence-prepared-quality-v1" });
    calls.qualityEvidence.mockImplementation(() => { throw Error("Changed protected evidence tuple"); });
    await expect(runContinueCanaryOriginal(["preflight", "--authorization", "/protected/epoch4.json", "--sha256", digest])).rejects.toThrow("Changed protected evidence");
    expect(calls.preflight).not.toHaveBeenCalled(); expect(calls.writer).not.toHaveBeenCalled();
    expect(calls.close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("activates a separate episode with readonly native proof and no supplier credential", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", ""); calls.activate.mockResolvedValue({ activated: true, nativeClaimChanged: false });
    await runContinueCanaryOriginal(["activate-epoch", "--authorization", "/protected/epoch.json", "--sha256", digest]);
    expect(calls.binding).toHaveBeenCalledWith("/protected/epoch.json", digest, true);
    expect(calls.activate).toHaveBeenCalledWith(db, "/protected/epoch.json", digest); expect(calls.identity).toHaveBeenCalledWith(db, "read");
    expect(calls.writer).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled(); expect(calls.complete).not.toHaveBeenCalled();
    expect(calls.close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("verify-prepared never prints raw result or opens a writer", async () => {
    calls.verify.mockResolvedValue({ preparedResultSha256: digest, completion: { runSha256: digest, providerLedgerSha256: digest,
      run: { question: "PRIVATE-FIXTURE", answer: "PRIVATE-FIXTURE" } } });
    await runContinueCanaryOriginal(["verify-prepared"]);
    expect(calls.writer).not.toHaveBeenCalled(); expect(calls.identity).toHaveBeenCalledWith(db, "read");
    expect(console.log).toHaveBeenCalledOnce(); expect(vi.mocked(console.log).mock.calls[0][0]).not.toContain("PRIVATE-FIXTURE");
  });
  it("exact accepted digest is required before metadata writer admission", async () => {
    await expect(runContinueCanaryOriginal(["complete-prepared"])).rejects.toThrow("exact reviewed"); expect(calls.writer).not.toHaveBeenCalled();
    calls.complete.mockResolvedValue({ outcome: "verified-fulfilled-original", deliveryCompleted: true, paidDeliveryObligation: "resolved", refunded: false, runSha256: digest });
    await runContinueCanaryOriginal(["complete-prepared", "--prepared-sha256", digest]);
    expect(calls.complete).toHaveBeenCalledWith(db, digest); expect(calls.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([ { args: ["execute", "--authorization", "/protected/grant.json", "--sha256", digest, "--force"] },
    { args: ["verify-prepared", "--retry"] }, { args: ["complete-prepared", "--prepared-sha256", digest, "--renew"] } ])("refuses unrecognized mutation options before storage %j", async ({ args }) => {
    await expect(runContinueCanaryOriginal(args)).rejects.toThrow(); expect(calls.writer).not.toHaveBeenCalled(); expect(calls.readonly).not.toHaveBeenCalled();
  });
  it("prints only fixed failure categories, preserving useful phase without secrets", () => {
    expect(continuationCliFailure(Error("Original continuation synthesize output-validation; retain the claim"))).toMatchObject({ phase: "synthesize", category: "output-validation", deliveryCompleted: false });
    expect(JSON.stringify(continuationCliFailure(Error("Provider SECRET-BODY")))).not.toContain("SECRET-BODY");
  });
  it("closes native facade after uncertain completion and emits no success", async () => {
    calls.complete.mockRejectedValue(Error("unknown acknowledgement"));
    await expect(runContinueCanaryOriginal(["complete-prepared", "--prepared-sha256", digest])).rejects.toThrow("unknown acknowledgement");
    expect(calls.close).toHaveBeenCalledOnce(); expect(console.log).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled();
  });
});
