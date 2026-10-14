import { describe, expect, it } from "vitest";
import { aggregatePurchaseOutcomes, PURCHASE_AGGREGATE_COHORTS } from "../research/purchase-outcome-aggregate";
import { projectPurchaseOutcomes, type PurchaseOutcomeSnapshot } from "../research/purchase-outcomes-projector";
import { sha256Text } from "./counterfactual-offline";
import { evaluatePurchaseRelease, type PurchaseReleasePolicy } from "./purchase-release-gate";

const source = "1".repeat(40), inputHash = "2".repeat(64);
// Complete synthetic retained records go through the real exact-version scorer. These
// recorded settlement fields exercise its invariants; they are not actual payment evidence.
function snapshot(cited = 14, count = 20): PurchaseOutcomeSnapshot {
  const id = "synthetic-run", network = "eip155:5042002";
  const decisions = Array.from({ length: count }, (_, index) => ({ sourceId: `s${index}`, assetId: `a${index}`,
    itemId: `i${index}`, contentVersion: "v1", action: "BUY" as const, expectedValue: 0.7, price: 0.002 }));
  const payment = (index: number, kind: "fetch" | "citation") => ({ ...decisions[index],
    id: `${kind}-${index}`, kind, queryId: id, network, amountUsdc: kind === "fetch" ? 0.002 : 0.000001,
    settled: true, settlementStatus: "settled", txHash: `synthetic-${kind}-${index}` });
  return { id, createdAt: "2026-10-05T00:00:00.000Z", answer: "Synthetic retained answer.", archive: null,
    decisions, citations: decisions.slice(0, cited).map(row => ({ sourceId: row.sourceId,
      itemId: row.itemId, contentVersion: row.contentVersion, weight: 1 })),
    trace: decisions.flatMap((_, index) => [{ detail: payment(index, "fetch") },
      ...(index < cited ? [{ detail: payment(index, "citation") }] : [])]) };
}
function aggregate(cited = 14, count = 20) {
  const retained = snapshot(cited, count), report = projectPurchaseOutcomes(retained, "eip155:5042002");
  return aggregatePurchaseOutcomes({ window: { network: report.network, since: "2026-10-01T00:00:00.000Z",
    until: "2026-10-11T00:00:00.000Z", period: "custom" }, cohorts: PURCHASE_AGGREGATE_COHORTS.map(cohort => ({ cohort,
    windowRuns: cohort === "scripted" ? 1 : 0, runs: cohort === "scripted" ? [{ id: report.dispatchId, createdAt: report.runCreatedAt,
      recordedDecisions: count, decisionsWithBasis: 0, report }] : [] })) });
}
async function fixture(candidate = aggregate()) {
  const baselineJson = JSON.stringify(aggregate()), candidateJson = JSON.stringify(candidate);
  const policy: PurchaseReleasePolicy = { schemaVersion: "keryx-purchase-release-policy-v1", network: "eip155:5042002",
    baseline: { sourceCommit: "0".repeat(40), aggregateSha256: await sha256Text(baselineJson), inputSha256: inputHash },
    candidate: { sourceCommit: source, aggregateSha256: await sha256Text(candidateJson), inputSha256: inputHash },
    cohorts: ["scripted"], margins: { maxHitRateDrop: 0.05, maxCalibrationGapRise: 0.05, minScoredPurchases: 20 } };
  const policyJson = JSON.stringify(policy);
  return { files: { policyJson, baselineJson, candidateJson }, expected: { policySha256: await sha256Text(policyJson),
    candidateSourceCommit: source, inputSha256: inputHash }, policy };
}
describe("bound offline purchase comparison", () => {
  it("reports explicit pinned margins and exact source/input/artifact bindings without deploying", async () => {
    const input = await fixture(), result = await evaluatePurchaseRelease(input.files, input.expected);
    expect(result).toMatchObject({ status: "pass", policy: input.policy, bindings: input.expected, deploymentAuthorized: false });
    expect(result.comparisons[0]).toMatchObject({ cohort: "scripted", status: "pass", hitRateChange: 0, calibrationGapChange: 0 });
  });
  it("flags worsening beyond the reviewed margin, accepts the exact boundary and fails closed on small samples", async () => {
    for (const [candidate, status] of [[aggregate(13), "pass"], [aggregate(12), "flagged"], [aggregate(3, 4), "not-evaluable"]] as const) {
      const input = await fixture(candidate);
      expect((await evaluatePurchaseRelease(input.files, input.expected)).status).toBe(status);
    }
    const input = await fixture(aggregate(12)), result = await evaluatePurchaseRelease(input.files, input.expected);
    expect(result.comparisons[0].reasons).toEqual(["hit-rate-fell", "calibration-gap-rose"]);
  });
  it("refuses different source, input, exact file bytes or a silently weakened policy", async () => {
    const input = await fixture();
    for (const [files, expected] of [
      [input.files, { ...input.expected, policySha256: "0".repeat(64) }],
      [input.files, { ...input.expected, candidateSourceCommit: "3".repeat(40) }],
      [input.files, { ...input.expected, inputSha256: "3".repeat(64) }],
      [{ ...input.files, baselineJson: input.files.baselineJson + " " }, input.expected],
      [{ ...input.files, candidateJson: input.files.candidateJson + " " }, input.expected],
      [{ ...input.files, policyJson: JSON.stringify({ ...input.policy, margins: { ...input.policy.margins, maxHitRateDrop: 1 } }) }, input.expected],
    ] as const) await expect(evaluatePurchaseRelease(files, expected)).rejects.toThrow("bindings");
  });
  it("requires one matching population, every selected cohort and closed policy fields", async () => {
    const input = await fixture();
    const checkPolicy = async (policy: unknown) => {
      const policyJson = JSON.stringify(policy);
      return evaluatePurchaseRelease({ ...input.files, policyJson }, { ...input.expected, policySha256: await sha256Text(policyJson) });
    };
    for (const policy of [{ ...input.policy, cohorts: [] }, { ...input.policy, cohorts: ["scripted", "scripted"] },
      { ...input.policy, deploy: true }, { ...input.policy, margins: { ...input.policy.margins, minScoredPurchases: 0 } },
      { ...input.policy, candidate: { ...input.policy.candidate, inputSha256: "4".repeat(64) } }]) await expect(checkPolicy(policy)).rejects.toThrow();
    expect((await checkPolicy({ ...input.policy, cohorts: ["scripted", "outside"] })).status).toBe("not-evaluable");
    const changed = aggregate(); changed.until = "2026-10-12T00:00:00.000Z";
    const other = await fixture(changed);
    await expect(evaluatePurchaseRelease(other.files, other.expected)).rejects.toThrow("populations");
  });
  it("withholds a pass when the sampled population is incomplete or has unscored buys", async () => {
    const incomplete = aggregate(); incomplete.columns[2].windowRuns = 2; incomplete.columns[2].sampleComplete = false;
    const input = await fixture(incomplete), result = await evaluatePurchaseRelease(input.files, input.expected);
    expect(result).toMatchObject({ status: "not-evaluable", comparisons: [{ coverageReasons: ["candidate-incomplete-sample"] }] });
    const unscored = aggregate(); unscored.columns[2].unscoredBuyDecisions = 1;
    unscored.columns[2].recordedBuyDecisions++; unscored.columns[2].recordedDecisions++;
    const second = await fixture(unscored);
    expect(await evaluatePurchaseRelease(second.files, second.expected)).toMatchObject({ status: "not-evaluable",
      comparisons: [{ coverageReasons: ["candidate-unscored-buys"] }] });
  });
  it("retains unknown predictions as an unscorable run, with no zero or initial-SKIP substitute", async () => {
    for (const expectedValue of [undefined, null]) {
      const retained = snapshot(), original = structuredClone(retained);
      const unknown = { ...retained, decisions: retained.decisions.map((row, index) =>
        index === 0 ? { ...row, expectedValue } : row) };
      unknown.decisions.unshift({ ...retained.decisions[0], action: "SKIP", expectedValue: 0.9 });
      expect(() => projectPurchaseOutcomes(unknown, "eip155:5042002")).toThrow();
      expect(retained).toEqual(original);
    }
    const partial = aggregate();
    // A separate unavailable run is counted in both the sample and the population.
    const column = partial.columns[2];
    column.windowRuns++; column.sampledRuns++; column.unscorableRuns++; column.recordedDecisions++;
    const input = await fixture(partial);
    expect(await evaluatePurchaseRelease(input.files, input.expected)).toMatchObject({ status: "not-evaluable",
      comparisons: [{ coverageReasons: ["candidate-unscorable-runs"] }] });
    expect(partial).toMatchObject({ missedValue: null, costPerSupportedClaim: null, byQuestionType: null });
  });
  it("preserves settlement, exact price and count invariants in failure populations", async () => {
    for (const settlementStatus of ["pending", "failed", "simulated"]) {
      const retained = snapshot(1, 1);
      const detail = retained.trace[0].detail as Record<string, unknown>;
      detail.settlementStatus = settlementStatus;
      const report = projectPurchaseOutcomes(retained, "eip155:5042002");
      expect(report).toMatchObject({ counts: { recordedBuyDecisions: 1, scoredPurchases: 0, unscoredBuyDecisions: 1 },
        hitRate: null, uncitedAccessMicros: "0", purchases: [] });
    }
    const input = await fixture();
    const bad = aggregate(); bad.columns[2].recordedBuyDecisions++;
    const invalid = await fixture(bad);
    await expect(evaluatePurchaseRelease(invalid.files, invalid.expected)).rejects.toThrow("bindings");
    expect(JSON.parse(input.files.candidateJson).columns[2]).toMatchObject({ settledAccessMicros: "40000",
      uncitedAccessMicros: "12000", settledRewardMicros: "14", decisionsWithBasis: 0 });
  });
  it("keeps a flagged cohort visible beside an unevaluable cohort without reclassifying the population", async () => {
    const input = await fixture(aggregate(12));
    input.policy.cohorts = ["scripted", "outside", "team", "unknown"];
    input.files.policyJson = JSON.stringify(input.policy);
    input.expected.policySha256 = await sha256Text(input.files.policyJson);
    const result = await evaluatePurchaseRelease(input.files, input.expected);
    expect(result.status).toBe("flagged");
    expect(result.comparisons.map(row => [row.cohort, row.status])).toEqual([
      ["scripted", "flagged"], ["outside", "not-evaluable"], ["team", "not-evaluable"], ["unknown", "not-evaluable"]]);
  });
  it("snapshots file text and bindings before await and refuses hidden capabilities and malformed JSON", async () => {
    const input = await fixture(), pending = evaluatePurchaseRelease(input.files, input.expected);
    input.files.candidateJson = "PRIVATE-REPLACEMENT"; input.expected.inputSha256 = "3".repeat(64);
    expect(await pending).toMatchObject({ status: "pass", deploymentAuthorized: false });
    const valid = await fixture();
    let accessed = false;
    const files = { ...valid.files };
    Object.defineProperty(files, "candidateJson", { get: () => { accessed = true; return "PRIVATE"; }, enumerable: true });
    await expect(evaluatePurchaseRelease(files, valid.expected)).rejects.toThrow();
    expect(accessed).toBe(false);
    await expect(evaluatePurchaseRelease({ ...valid.files, policyJson: "{PRIVATE" }, valid.expected)).rejects.toThrow();
  });
});
