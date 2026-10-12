import { describe, expect, it, vi } from "vitest";
import { selectEvidencePortfolio } from "../agent/evidence-portfolio";
import { captureOptimizer } from "../agent/optimizer-checkpoint-capture";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { optimizerCheckpoint } from "./optimizer-checkpoint";
import { replayOptimizer } from "./optimizer-policy-v1";
import { canonicalReadPacket, verifyActualReadPacket } from "./actual-read-record";
import type { Decision } from "../types";
import { optimizerPacketFixture } from "./optimizer-checkpoint.test-fixture";

const decision = (id: string, action: Decision["action"] = "CACHE", expectedValue = 0.8, price = 0, targets = [0], itemUrl?: string): Decision =>
  ({ sourceId: id, assetId: id, sourceName: "PRIVATE_ACCOUNT_SENTINEL", rationale: "PRIVATE_MODEL_QUESTION_SENTINEL", confidence: 0.9,
    action, expectedValue, price, targets, ...(itemUrl ? { itemUrl } : {}) });
function fixture(decisions: Decision[], claimCount = 2, attentionLimit = 2, fetchBudgetUsdc = 0.01) {
  const input = { decisions, claimCount, attentionLimit, fetchBudgetUsdc }, actual = selectEvidencePortfolio(input), refs = new Map<string, number>();
  const ref = (id: string) => { if (!refs.has(id)) refs.set(id, refs.size + 1); return refs.get(id)!; };
  return { input, actual, ref, checkpoint: captureOptimizer(input, actual, ref) };
}
describe("versioned optimizer replay", () => {
  it.each([
    [decision("paid", "BUY", 0.95, 0.002, [0], "https://private.example/article?token=SECRET"),
      { ...decision("free", "CACHE", 0.95, 0, [0], "https://private.example/article?token=SECRET#fragment"), sourceKind: "public-reference" as const }, decision("other", "CACHE", 0.7, 0, [1])],
    [decision("PRIVATE_é"), decision("PRIVATE_e\u0301"), decision("PRIVATE_A"), decision("PRIVATE_a")],
    [decision("a"), decision("a\u0000z"), decision("ab"), decision("a-b"), decision("Z"), decision("z")],
    [decision("skip", "SKIP", 1), decision("expired", "BUY", 0.9, 0.002), decision("cache-list", "CACHE", 0.8, 99, [1])],
    [decision("no-target", "BUY", 0.9, 0.000001, []), decision("low", "CACHE", -1), decision("clamp", "CACHE", 2, 0, [0, 0, 99])],
  ].map(rows => ({ rows })))("replays actual selected output and private tie behavior for %j", ({ rows }) => {
    for (const decisions of [rows, [...rows].reverse()]) {
      const value = fixture(decisions); expect(value.checkpoint.status).toBe("available");
      if (value.checkpoint.status !== "available") throw Error("Unexpected unavailable optimizer");
      expect(replayOptimizer(value.checkpoint.input, value.checkpoint.ties)).toEqual(value.checkpoint.outcome);
      expect(value.checkpoint.outcome.selected).toEqual(value.actual.selectedAssetIds.map(value.ref));
      expect(value.checkpoint.outcome.reserved).toBe(String(value.actual.selectedBuyUsdc));
      for (const secret of ["PRIVATE_", "SECRET", "private.example", "https:", "token=", "rationale", "wallet"]) expect(JSON.stringify(value.checkpoint)).not.toContain(secret);
    }
  });
  it("keeps actual fractional inputs unavailable even when the legacy policy rounds an output", () => {
    const fractionalCap = fixture([decision("one-micro", "BUY", 0.9, 0.000001)], 1, 1, 0.0000005);
    expect(fractionalCap.checkpoint.status).toBe("available");
    if (fractionalCap.checkpoint.status !== "available") throw Error("Unavailable cap fixture");
    expect(fractionalCap.checkpoint.input).toMatchObject({ fetchBudget: "5e-7", fetchBudgetMicros: null });
    expect(fractionalCap.checkpoint.outcome).toMatchObject({ selected: [], cap: "0", capMicros: null });
    const fractionalPrice = fixture([decision("fractional", "BUY", 0.9, 0.0000015)], 1, 1);
    if (fractionalPrice.checkpoint.status !== "available") throw Error("Unavailable price fixture");
    expect(fractionalPrice.checkpoint.input.candidates[0].priceMicros).toBeNull();
    expect(fractionalPrice.checkpoint.outcome).toMatchObject({ reserved: "0.000002", reservedMicros: null, unusedMicros: null });
  });
  it("replays bounded large-catalog output or explicitly refuses the bounded collation capture", () => {
    const value = fixture(Array.from({ length: 48 }, (_, index) => decision(`private-${index}`, "BUY", 0.8, 0.001, [index % 8])), 8, 8, 0.005);
    expect(value.actual.selectionMethod).toBe("bounded-heuristic");
    if (value.checkpoint.status === "available") expect(replayOptimizer(value.checkpoint.input, value.checkpoint.ties)).toEqual(value.checkpoint.outcome);
    else expect(value.checkpoint).toEqual({ status: "unavailable", reason: "capture-bound" });
    expect(selectEvidencePortfolio(value.input)).toEqual(value.actual);
  });
  it("does not substitute a replayed result for the actual selected output", () => {
    const value = fixture([decision("a", "BUY", 0.9, 0.002)]);
    expect(captureOptimizer(value.input, { ...value.actual, selectedAssetIds: [] }, value.ref)).toEqual({ status: "unavailable", reason: "source-policy-mismatch" });
    const future = { ...value.actual }; Object.defineProperty(future, "policy", { value: "future-policy" });
    expect(captureOptimizer(value.input, future, value.ref)).toEqual({ status: "unavailable", reason: "source-policy-mismatch" });
    expect(captureOptimizer({ ...value.input, decisions: [decision("duplicate"), decision("duplicate")] }, value.actual, value.ref)).toEqual({ status: "unavailable", reason: "unsupported-input" });
    expect(captureOptimizer(value.input, value.actual, () => { throw Error("PRIVATE_TOKEN"); })).toEqual({ status: "unavailable", reason: "unsupported-input" });
  });
  it("refuses private input accessors without invoking them or changing the actual selected output", () => {
    const value = fixture([decision("a", "BUY", 0.9, 0.002)]), getter = vi.fn(() => "PRIVATE_TOKEN"), row = { ...value.input.decisions[0] };
    Object.defineProperty(row, "itemUrl", { get: getter });
    expect(captureOptimizer({ ...value.input, decisions: [row] }, value.actual, value.ref)).toEqual({ status: "unavailable", reason: "unsupported-input" });
    const targets = [...value.input.decisions[0].targets]; Object.defineProperty(targets, 0, { get: getter });
    expect(captureOptimizer({ ...value.input, decisions: [{ ...value.input.decisions[0], targets }] }, value.actual, value.ref)).toEqual({ status: "unavailable", reason: "unsupported-input" });
    expect(getter).not.toHaveBeenCalled(); expect(selectEvidencePortfolio(value.input)).toEqual(value.actual);
  });
  it("rejects tampered outcomes, amounts, private fields, missing ties, accessors and async mutation", async () => {
    const capture = optimizerPacketFixture(); expect(await verifyActualReadPacket(capture.packet, capture.retainedDigest)).toBe(true);
    if (capture.packet.optimizer.status !== "available") throw Error("Unavailable fixture");
    const checkpoint = capture.packet.optimizer;
    const outcome = structuredClone(checkpoint); outcome.outcome.selected.reverse(); expect(() => optimizerCheckpoint(outcome)).toThrow();
    const money = structuredClone(checkpoint); money.input.candidates[0].priceMicros = "2"; expect(() => optimizerCheckpoint(money)).toThrow();
    expect(() => optimizerCheckpoint({ ...checkpoint, question: "PRIVATE_QUESTION" })).toThrow();
    const getter = vi.fn(() => checkpoint.input); const accessor = { ...checkpoint }; Object.defineProperty(accessor, "input", { get: getter });
    expect(() => optimizerCheckpoint(accessor)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const sparse = structuredClone(checkpoint); delete sparse.input.candidates[0]; expect(() => optimizerCheckpoint(sparse)).toThrow();
    const tied = fixture([decision("a"), decision("b"), decision("c")], 1, 2);
    if (tied.checkpoint.status !== "available" || !tied.checkpoint.ties.length) throw Error("Missing tie fixture");
    const tiedCheckpoint = tied.checkpoint;
    const missing = structuredClone(tiedCheckpoint); missing.ties = []; expect(() => optimizerCheckpoint(missing)).toThrow();
    expect(() => optimizerCheckpoint({ ...tiedCheckpoint, ties: [{ ...tiedCheckpoint.ties[0], comparison: 2 }, ...tiedCheckpoint.ties.slice(1)] })).toThrow();
    const mutable = structuredClone(capture.packet), pending = verifyActualReadPacket(mutable, capture.retainedDigest);
    if (mutable.optimizer.status === "available") mutable.optimizer.input.candidates[0].idRank++;
    expect(await pending).toBe(false);
    expect(() => canonicalReadPacket({ ...capture.packet, account: "PRIVATE_ACCOUNT" })).toThrow();
  });
  it("keeps unsupported capture explicit and does not invoke a disabled observer", async () => {
    const disabled = createReadCheckpointCapture(false, undefined, true), observer = vi.fn(() => { throw Error("PRIVATE_QUESTION"); });
    disabled.optimizer(observer); expect(observer).not.toHaveBeenCalled(); expect(disabled.finish()).toBeUndefined();
    const capture = createReadCheckpointCapture(true, undefined, true); capture.stop("evidence", 0); capture.optimizer(observer);
    const value = capture.finish(); if (!value || value.status !== "available" || value.packet.schema !== 3) throw Error("Unavailable partial packet");
    expect(value.packet.optimizer).toEqual({ status: "unavailable", reason: "capture-failed" });
    expect(await verifyActualReadPacket(value.packet, value.retainedDigest)).toBe(true); expect(JSON.stringify(value)).not.toContain("PRIVATE_QUESTION");
  });
});
