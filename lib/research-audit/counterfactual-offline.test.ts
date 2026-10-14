import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateRetainedSkips, OFFLINE_COUNTERFACTUAL_POLICY, sha256Text, type OfflineCounterfactualInput } from "./counterfactual-offline";

async function fixture(): Promise<OfflineCounterfactualInput> {
  const claims = [{ id: "threshold", literal: "Alarm threshold is 70 units." }, { id: "interval", literal: "Calibration interval is 14 days." }];
  const body = claims.map(row => row.literal).join(" ");
  return { schemaVersion: "keryx-offline-counterfactual-input-v1",
    run: { id: "synthetic-run", completedAt: "2026-10-12T00:00:00.000Z", answer: claims[0].literal,
      decisions: [{ action: "SKIP", sourceId: "source", itemId: "item", contentVersion: "v1", price: 0.002 }], observedReads: [] },
    reference: { claims, sha256: await sha256Text(JSON.stringify(claims)) },
    snapshots: [{ sourceId: "source", itemId: "item", contentVersion: "v1", body, bodySha256: await sha256Text(body),
      capturedAt: "2026-10-12T00:00:01.000Z" }] };
}
afterEach(() => vi.unstubAllGlobals());
describe("retained offline skip evaluation", () => {
  it("reads exact retained bodies after completion and reports literal observations without model self-scoring", async () => {
    const input = await fixture(), original = structuredClone(input);
    const result = await evaluateRetainedSkips(input);
    expect(result).toMatchObject({ policy: OFFLINE_COUNTERFACTUAL_POLICY, eligibleSkips: 1, sampledSkips: 1,
      plannedQuoteMicros: "2000", retainedBodyReads: 1, unavailableBodies: 0,
      referenceClaims: 2, missingReferenceClaims: 1, foundMissingClaimIds: ["interval"], sampledLiteralMissRate: 1,
      funding: "none-offline-retained-content", actualSpendMicros: "0", rewardEligible: false });
    expect(result.reads[0]).toMatchObject({ bodySha256: input.snapshots[0].bodySha256, foundClaimIds: ["interval"] });
    expect(input).toEqual(original);
    expect(JSON.stringify(result)).not.toContain(input.snapshots[0].body);
  });
  it("has no user-budget or transport capability, including missing or too expensive retained bodies", async () => {
    const request = vi.fn(() => { throw new Error("Outbound calls forbidden"); }); vi.stubGlobal("fetch", request);
    for (const userBudget of [0, 1, 50000]) {
      const input = await fixture(), state = { userBudget, rewardMicros: 0 };
      const before = structuredClone(state);
      expect(await evaluateRetainedSkips(input)).toMatchObject({ actualSpendMicros: "0", rewardEligible: false });
      input.snapshots = [];
      expect(await evaluateRetainedSkips(input)).toMatchObject({ unavailableBodies: 1, sampledLiteralMissRate: null, actualSpendMicros: "0" });
      input.run.decisions[0].price = 0.020001;
      expect(await evaluateRetainedSkips(input)).toMatchObject({ sampledSkips: 0, omittedForQuoteAllowance: 1, actualSpendMicros: "0" });
      await expect(evaluateRetainedSkips({ ...input, userBudget })).rejects.toThrow();
      await expect(evaluateRetainedSkips({ ...input, reader: request })).rejects.toThrow();
      expect(state).toEqual(before);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds sample count, exact quoted allowance and total UTF-8 bytes independently", async () => {
    const input = await fixture();
    input.run.decisions = Array.from({ length: 20 }, (_, index) => ({ ...input.run.decisions[0], itemId: `i${index}`, price: 0.001 }));
    const result = await evaluateRetainedSkips(input);
    expect(result).toMatchObject({ eligibleSkips: 20, sampledSkips: 8, plannedQuoteMicros: "8000", unavailableBodies: 8 });
    expect((await evaluateRetainedSkips({ ...input, run: { ...input.run, decisions: [...input.run.decisions].reverse() } })).reads).toEqual(result.reads);
    input.run.decisions.forEach(row => { row.price = 0.004; });
    const limited = await evaluateRetainedSkips(input);
    expect(limited.sampledSkips).toBe(5); expect(limited.plannedQuoteMicros).toBe("20000");
    const large = await fixture(), body = "é".repeat(140000);
    large.snapshots = [0, 1].map(index => ({ ...large.snapshots[0], itemId: `large${index}`, body, bodySha256: "0".repeat(64) }));
    // Valid first digest lets the cumulative byte limit, rather than a corrupt digest, reject the second.
    for (const row of large.snapshots) row.bodySha256 = await sha256Text(row.body);
    await expect(evaluateRetainedSkips(large)).rejects.toThrow("body allowance");
  });
  it("refuses corrupted/version-ambiguous references and snapshots rather than fetching or repairing them", async () => {
    const original = await fixture();
    const badReference = structuredClone(original); badReference.reference.sha256 = "0".repeat(64);
    await expect(evaluateRetainedSkips(badReference)).rejects.toThrow("reference digest");
    const badBody = structuredClone(original); badBody.snapshots[0].body += "changed";
    await expect(evaluateRetainedSkips(badBody)).rejects.toThrow("body digest");
    const duplicate = structuredClone(original); duplicate.snapshots.push(structuredClone(duplicate.snapshots[0]));
    await expect(evaluateRetainedSkips(duplicate)).rejects.toThrow("Repeated");
    const early = structuredClone(original); early.snapshots[0].capturedAt = "2026-10-11T23:59:59.000Z";
    await expect(evaluateRetainedSkips(early)).rejects.toThrow("predates");
    const other = structuredClone(original); other.snapshots[0].contentVersion = "v2";
    expect(await evaluateRetainedSkips(other)).toMatchObject({ unavailableBodies: 1, sampledLiteralMissRate: null });
    for (const action of ["BUY", "CACHE"] as const) {
      const read = structuredClone(original); read.run.decisions.push({ ...read.run.decisions[0], action });
      expect(await evaluateRetainedSkips(read)).toMatchObject({ eligibleSkips: 0, sampledSkips: 0 });
    }
    const conflict = structuredClone(original); conflict.run.decisions.push({ ...conflict.run.decisions[0], price: 0.003 });
    expect(await evaluateRetainedSkips(conflict)).toMatchObject({ eligibleSkips: 0, sampledSkips: 0 });
    const gapRead = structuredClone(original);
    gapRead.run.observedReads.push({ sourceId: "source", itemId: "item", contentVersion: "v1" });
    expect(await evaluateRetainedSkips(gapRead)).toMatchObject({ eligibleSkips: 0, sampledSkips: 0, excludedObservedReadDecisions: 1 });
    gapRead.run.observedReads[0].contentVersion = "v2";
    expect(await evaluateRetainedSkips(gapRead)).toMatchObject({ eligibleSkips: 1, sampledSkips: 1, excludedObservedReadDecisions: 0 });
  });
  it("snapshots all inputs before await and refuses hooks, policy overrides and incomplete answers", async () => {
    const input = await fixture(), pending = evaluateRetainedSkips(input);
    input.run.decisions[0].price = 99; input.snapshots[0].body = "replaced";
    expect(await pending).toMatchObject({ foundMissingClaimIds: ["interval"], plannedQuoteMicros: "2000" });
    const getter = await fixture(), hook = vi.fn();
    Object.defineProperty(getter.run, "answer", { get: hook, enumerable: true });
    await expect(evaluateRetainedSkips(getter)).rejects.toThrow(); expect(hook).not.toHaveBeenCalled();
    const valid = await fixture();
    for (const value of [{ ...valid, allowanceMicros: "100000" }, { ...valid, sampleLimit: 99 },
      { ...valid, run: { ...valid.run, answer: " " } }]) await expect(evaluateRetainedSkips(value)).rejects.toThrow();
  });
  it("validates every supplied digest and observed identity, including unselected bodies", async () => {
    const input = await fixture();
    input.snapshots.push({ ...input.snapshots[0], itemId: "unselected", bodySha256: "0".repeat(64) });
    await expect(evaluateRetainedSkips(input)).rejects.toThrow("body digest");
    const valid = await fixture();
    for (const observedRead of [{ sourceId: "source", itemId: "item" },
      { sourceId: "source", itemId: "item", contentVersion: " " },
      { sourceId: "source", itemId: "item", contentVersion: "v1", payTo: "PRIVATE" }]) {
      await expect(evaluateRetainedSkips({ ...valid, run: { ...valid.run, observedReads: [observedRead] } })).rejects.toThrow();
    }
    for (const claims of [[valid.reference.claims[0], valid.reference.claims[0]],
      [{ ...valid.reference.claims[0], id: "other" }, valid.reference.claims[0]]]) {
      await expect(evaluateRetainedSkips({ ...valid, reference: { claims,
        sha256: await sha256Text(JSON.stringify(claims)) } })).rejects.toThrow("Ambiguous");
    }
  });
  it("retains partial bodies as unavailable and excludes exact gap reads without interpreting predictions", async () => {
    const input = await fixture();
    input.run.decisions.push({ ...input.run.decisions[0], itemId: "missing", price: 0.003 });
    const partial = await evaluateRetainedSkips(input);
    expect(partial).toMatchObject({ sampledSkips: 2, retainedBodyReads: 1, unavailableBodies: 1,
      plannedQuoteMicros: "5000", foundMissingClaimIds: ["interval"], sampledLiteralMissRate: null,
      actualSpendMicros: "0", rewardEligible: false });
    input.run.observedReads.push({ sourceId: "source", itemId: "item", contentVersion: "v1" });
    expect(await evaluateRetainedSkips(input)).toMatchObject({ sampledSkips: 1, excludedObservedReadDecisions: 1,
      unavailableBodies: 1, plannedQuoteMicros: "3000", foundMissingClaimIds: [], sampledLiteralMissRate: null });
    // The minimized evaluator accepts no EV field; an absent prediction is never replaced
    // with zero, the initial SKIP estimate, a citation weight or a model self-assessment.
    for (const expectedValue of [null, 0, 0.9]) {
      await expect(evaluateRetainedSkips({ ...input, run: { ...input.run,
        decisions: input.run.decisions.map(row => ({ ...row, expectedValue })) } })).rejects.toThrow();
    }
    for (const price of [0.0000001, 0.0020001]) {
      const inexact = await fixture(); inexact.run.decisions[0].price = price;
      expect(await evaluateRetainedSkips(inexact)).toMatchObject({ eligibleSkips: 0, sampledSkips: 0,
        plannedQuoteMicros: "0", sampledLiteralMissRate: null });
    }
  });
  it("refuses byte/literal bounds and reward or provider capabilities without invoking them", async () => {
    const input = await fixture();
    const claims = Array.from({ length: 65 }, (_, index) => ({ id: `c${index}`, literal: `Literal ${index}` }));
    await expect(evaluateRetainedSkips({ ...input, reference: { claims,
      sha256: await sha256Text(JSON.stringify(claims)) } })).rejects.toThrow();
    await expect(evaluateRetainedSkips({ ...input, run: { ...input.run, answer: "界".repeat(400_000) } })).rejects.toThrow();
    const invoke = vi.fn(() => { throw new Error("Must not invoke authority"); });
    for (const capability of ["rewardSink", "wallet", "provider", "transport", "userBudget"]) {
      await expect(evaluateRetainedSkips({ ...input, [capability]: invoke })).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
