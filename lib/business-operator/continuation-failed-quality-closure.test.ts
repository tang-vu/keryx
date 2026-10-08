import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillmentSha256 as hash } from "../a2a/fulfillment-authority";
import { syntheticQualityFailureClosure } from "./continuation-failed-quality-closure-fixture";
import { validateContinuationQualityFailureClosure, type ContinuationQualityFailureClosureBinding } from "./continuation-failed-quality-closure";
import { continuationOwnerRepairReceiptSchema } from "./continuation-failed-quality-epoch";

const at = "2026-10-08T04:00:00.000Z", h = "a".repeat(64);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(() => { vi.useRealTimers(); });
function fixture(failureEpoch: 4 | 5 = 4) {
  const home = path.resolve("synthetic-closed-repair-home"), binding: ContinuationQualityFailureClosureBinding = {
    executorCommit: "b".repeat(40), parentAuthorizationSha256: h, nativeClaimSha256: h, packetSha256: h, inputSemanticSha256: h,
    contextSha256: h, parentProviderLedgerSha256: h, parentLedgerHeadSha256: h, parentAnchorFrontierSha256: h,
    parentPreparedAuthorizationSha256: "c".repeat(64), approvedAt: at, ...(failureEpoch === 5 ? { failureEpoch } : {}) };
  const value = syntheticQualityFailureClosure(home, binding), read = (file: string, max: number) => {
    const raw = value.files.get(file); if (!raw || raw.length > max) throw Error("Synthetic protected byte read refused"); return Buffer.from(raw);
  };
  const validate = () => validateContinuationQualityFailureClosure(value.proof, home, binding, { read, readStream: read });
  const amend = (directory: string, file: string, key: keyof typeof value.proof.guardian, change: (value: Record<string, unknown>) => void) => {
    const name = path.join(directory, file), raw = value.files.get(name)!, json = JSON.parse(raw.toString("utf8")); change(json);
    const next = Buffer.from(`${JSON.stringify(json)}\n`); value.files.set(name, next);
    const row = directory.endsWith(`${path.sep}g01`) ? value.proof.guardian : value.proof.inner[Number(path.basename(directory).slice(1)) - 1];
    row[key] = hash(next);
  };
  return { ...value, home, binding, validate, amend };
}
describe("exact original failed quality lifetime projection", () => {
  it("keeps V5's genuine failed pair in a distinct context-bound closure without accepting a relabeled predecessor", () => {
    const f = fixture(5); expect(f.validate()).toEqual(f.proof);
    expect(f.proof.format).toBe("keryx-original-continuation-quality-failure-closure-v2");
    expect(f.proof.context).toContain("operator-completion-epoch-5-20261008-03");
    expect(() => validateContinuationQualityFailureClosure(f.proof, f.home, { ...f.binding, failureEpoch: 4 }, {
      read: file => f.files.get(file)!, readStream: file => f.files.get(file)! })).toThrow();
    const format = f.proof.format; f.proof.format = "keryx-original-continuation-quality-failure-closure-v1";
    expect(f.validate).toThrow(); f.proof.format = format;
    f.amend(path.join(f.proof.context, "g01"), "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.accepted = false; });
    expect(f.validate).toThrow();
  });
  it("checks all nine raw lifetimes and full streams while preserving genuine root and execute failure", () => {
    const f = fixture(); expect(f.validate()).toEqual(f.proof);
    expect(f.proof.inner).toHaveLength(8);
    const root = JSON.parse(f.files.get(path.join(f.proof.context, "g01", "lease-driver-receipt.json"))!.toString());
    const execute = JSON.parse(f.files.get(path.join(f.proof.context, "d06", "lease-driver-process-001-receipt.json"))!.toString());
    expect(root.npmExit.actualExitCode).toBe(1); expect(root.operationSucceeded).toBe(false); expect(execute.actualExitCode).toBe(1);
    f.amend(path.join(f.proof.context, "d01"), "lease-driver-receipt.json", "lifetimeReceiptSha256", value => {
      value.adoptedDescendantExits = [{ pid: 43, actualExitCode: 0, signal: null }];
    });
    expect(f.validate()).toEqual(f.proof); // A genuine successful adopted exit is retained, not erased.
  });
  it.each(["root-success", "keeper-failed", "unreaped", "nonempty-cgroup", "incomplete-stream", "wrong-pid", "execute-success", "other-inner-failed", "wrong-source", "adopted-failed", "adopted-duplicate", "adopted-root", "adopted-malformed"] as const)
    ("refuses %s even when the altered raw receipt's digest is repinned", failure => {
      const f = fixture(), g = path.join(f.proof.context, "g01");
      if (failure === "root-success") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.npmExit = { actualExitCode: 0, signal: null }; v.operationSucceeded = true; });
      if (failure === "keeper-failed") f.amend(g, "lease-driver-keeper-exit.json", "keeperExitSha256", v => { v.actualExitCode = 1; });
      if (failure === "unreaped") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.allChildrenReaped = false; });
      if (failure === "nonempty-cgroup") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.cgroupEmpty = false; });
      if (failure === "incomplete-stream") f.amend(g, "lease-driver-process-001-receipt.json", "processReceiptSha256", v => { (v.streams as { stdout: { ended: boolean } }).stdout.ended = false; });
      if (failure === "wrong-pid") f.amend(g, "lease-driver-process-001-receipt.json", "processReceiptSha256", v => { v.pid = 43; });
      if (failure === "execute-success") f.amend(path.join(f.proof.context, "d06"), "lease-driver-process-001-receipt.json", "processReceiptSha256", v => { v.actualExitCode = 0; });
      if (failure === "other-inner-failed") f.amend(path.join(f.proof.context, "d07"), "lease-driver-process-001-receipt.json", "processReceiptSha256", v => { v.actualExitCode = 1; });
      if (failure === "wrong-source") f.amend(g, "lease-driver-intent.json", "intentSha256", v => { v.expectedCommit = "e".repeat(40); });
      if (failure === "adopted-failed") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.adoptedDescendantExits = [{ pid: 43, actualExitCode: 1, signal: null }]; });
      if (failure === "adopted-duplicate") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.adoptedDescendantExits = [{ pid: 43, actualExitCode: 0, signal: null }, { pid: 43, actualExitCode: 0, signal: null }]; });
      if (failure === "adopted-root") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.adoptedDescendantExits = [{ pid: 42, actualExitCode: 0, signal: null }]; });
      if (failure === "adopted-malformed") f.amend(g, "lease-driver-receipt.json", "lifetimeReceiptSha256", v => { v.adoptedDescendantExits = [{ pid: null, actualExitCode: null, signal: null }]; });
      expect(f.validate).toThrow();
    });
  it("refuses changed streams, missing original receipt, wrong native tuple, unbound process intent and substituted source", () => {
    const f = fixture(), name = path.join(f.proof.context, "d08", "lease-driver-process-001.stdout"), original = f.files.get(name)!;
    f.files.set(name, Buffer.from("Different captured output")); expect(f.validate).toThrow(); f.files.set(name, original);
    const receipt = path.join(f.proof.context, "d03", "lease-driver-receipt.json"), raw = f.files.get(receipt)!;
    f.files.delete(receipt); expect(f.validate).toThrow(); f.files.set(receipt, raw);
    f.proof.nativeClaimSha256 = "f".repeat(64); expect(f.validate).toThrow(); f.proof.nativeClaimSha256 = h;
    const processIntentSha256 = f.proof.guardian.processIntentSha256;
    delete (f.proof.guardian as Partial<typeof f.proof.guardian>).processIntentSha256; expect(f.validate).toThrow();
    f.proof.guardian.processIntentSha256 = processIntentSha256;
    f.files.set(path.join(f.proof.context, "program.mjs"), Buffer.from("Substituted controller source")); expect(f.validate).toThrow();
  });
  it("refuses reordered/misbound inner roles, projection paths and future evidence", () => {
    const f = fixture(), first = f.proof.inner[0], second = f.proof.inner[1];
    f.proof.inner[0] = second; f.proof.inner[1] = first; expect(f.validate).toThrow(); f.proof.inner[0] = first; f.proof.inner[1] = second;
    first.authorizationSha256 = h; expect(f.validate).toThrow(); first.authorizationSha256 = f.binding.parentPreparedAuthorizationSha256;
    const context = f.proof.context; f.proof.context = path.dirname(context); expect(f.validate).toThrow(); f.proof.context = context;
    f.proof.recordedAt = "2026-10-08T04:00:00.001Z"; expect(f.validate).toThrow();
  });
  it("does not normalize the protected instruction or invent a receipt timestamp and refuses scope inflation", () => {
    const instruction = "Synthetic explicit same-original repair instruction", receipt = { format: "keryx-original-continuation-owner-repair-receipt-v1",
      provenance: "retained-current-session-owner-instruction", instruction, instructionSha256: hash(instruction), instructionTimestamp: "not-recorded",
      recordedAt: at, authorizationScope: "repair-same-paid-original-until-delivered", limitsChosenBy: "agent-within-explicit-owner-repair-authority",
      originalAuthorizationSha256: h, nativeClaimSha256: h, packetSha256: h, inputSemanticSha256: h, contextSha256: h, parentAuthorizationSha256: h,
      historicalReservedMicroUsd: 367_220, maximumNewModelCalls: 6, maximumCombinedMicroUsd: 491_180, reserveMicroUsd: 20_660,
      maximumDurationMs: 86_400_000, expiresAt: "2026-10-09T04:00:00.000Z", searches: "forbidden", creatorPayments: "forbidden", newInboundPayment: "forbidden" };
    expect(continuationOwnerRepairReceiptSchema.parse(receipt)).toEqual(receipt);
    for (const patch of [{ instruction: ` ${instruction}` }, { instruction: "Different synthetic instruction" }, { instructionTimestamp: at },
      { maximumNewModelCalls: 7 }, { maximumCombinedMicroUsd: 512_000 }, { expiresAt: "2026-10-09T04:00:00.001Z" }, { creatorPayments: "permitted" }])
      expect(continuationOwnerRepairReceiptSchema.safeParse({ ...receipt, ...patch }).success).toBe(false);
  });
});
