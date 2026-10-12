import { expect, it, vi } from "vitest";
import { ACTUAL_READ_POLICY, actualReadCheckpoint, operandMicros, type ReadCheck } from "./actual-read-policy";
import { actualReadPacketHash, verifyActualReadPacket, type ActualReadPacketV1, type ActualReadRecord } from "./actual-read-record";
import { ACTUAL_READ_CAPTURE_V2, replayMapping, replayNormalization, type ActualReadPacketV2 } from "./actual-read-v2";
import { optimizerPacketFixture } from "./optimizer-checkpoint.test-fixture";
import { DECISION_INSPECTION_BOUNDARY, inspectReadDecisions, previewReadPolicy, syntheticDecisionShowcasePacket } from "./decision-inspection";

function packet(checks: ReadCheck[], patch: Partial<ActualReadRecord> = {}): ActualReadPacketV1 {
  return { schema: 1, policy: ACTUAL_READ_POLICY, coverage: "post-portfolio-checkpoints", monetaryAuthority: "qualified-assertions-only",
    records: checks.map((check, sequence) => ({ sequence, candidate: 1, round: 0, proposal: "UNKNOWN", plan: "UNKNOWN", facts: "assertions",
      check, outcome: actualReadCheckpoint(check), amounts: { priceMicros: check.kind === "budget" && check.present ? operandMicros(check.price) : null,
        remainingMicros: check.kind === "budget" ? operandMicros(check.remaining) : null }, ...patch })) };
}
const budget = (patch: Partial<Extract<ReadCheck, { kind: "budget" }>> = {}): ReadCheck => ({ kind: "budget", present: true,
  gathered: false, price: "0.002", remaining: "0.001", ...patch });

it("shows model, selected plan and code dispositions without inflating candidate totals with CONTINUE or STOP", () => {
  const showcase = syntheticDecisionShowcasePacket(), inspected = inspectReadDecisions(showcase);
  expect(inspected?.totals).toEqual({ checkpoints: 9, candidates: 4, unresolvedCandidates: 0, continueCheckpoints: 4,
    stopCheckpoints: 1, byDisposition: { BUY: 1, SKIP: 1, CACHE: 1, FREE: 0, ESCALATE: 1, UNKNOWN: 0 },
    proposalPlanComparisons: 4, proposalPlanDifferences: 0 });
  expect(inspected?.candidates[1]).toMatchObject({ candidate: 2, proposal: "BUY", plan: "BUY", checkpointDisposition: "SKIP", checkpointRule: "budget" });
  expect(inspected?.rows.at(-1)).toMatchObject({ candidate: 0, scope: "run", proposal: "UNKNOWN", plan: "UNKNOWN", outcome: { action: "STOP", rule: "attention" } });
  expect(inspected?.candidates.every(row => !row.finalObservedActions.length)).toBe(true);
  expect(inspected?.facts).toBe("recorded-assertions");
  expect(inspected?.integrity).toBe("canonical-policy-consistent");
  expect(DECISION_INSPECTION_BOUNDARY).toContain("does not prove");
});

it("preserves source BUY before a sufficiency STOP and counts repeated checkpoints for a candidate once", () => {
  const original = packet([{ kind: "channel", creatorFree: false, cache: false }, { kind: "duplicate", found: false },
    { kind: "sufficiency", sufficient: true, unavailable: false }], { proposal: "BUY", plan: "BUY" });
  const inspection = inspectReadDecisions(original);
  expect(inspection?.totals).toMatchObject({ candidates: 1, stopCheckpoints: 1, byDisposition: { BUY: 1, UNKNOWN: 0 } });
  expect(inspection?.candidates[0].checkpointDisposition).toBe("BUY");
  const declined = packet([{ kind: "channel", creatorFree: false, cache: false }, { kind: "zero-budget", zero: true }]);
  expect(inspectReadDecisions(declined)?.totals.byDisposition).toMatchObject({ BUY: 0, SKIP: 1 });
});

it("identifies the checkpoint and round behind a candidate's last recorded disposition", () => {
  const original = packet([{ kind: "channel", creatorFree: false, cache: false }, { kind: "selection", plan: "BUY", external: false }]);
  original.records[1].round = 1;
  expect(inspectReadDecisions(original)?.candidates[0]).toMatchObject({ lastRound: 1, checkpointDisposition: "BUY",
    dispositionSequence: 0, dispositionRound: 0 });
  original.records[1].check = budget();
  original.records[1].outcome = actualReadCheckpoint(original.records[1].check);
  original.records[1].amounts = { priceMicros: "2000", remainingMicros: "1000" };
  const inspected = inspectReadDecisions(original);
  expect(inspected?.candidates[0]).toMatchObject({ lastRound: 1, checkpointDisposition: "SKIP", dispositionSequence: 1, dispositionRound: 1 });
  expect(inspected?.totals).toMatchObject({ candidates: 1, byDisposition: { BUY: 0, SKIP: 1 } });
});

it("never promotes CONTINUE to BUY and retains UNKNOWN operands, proposals and unresolved review completion", () => {
  const pending = packet([{ kind: "selection", plan: "BUY", external: false }, { kind: "budget", present: true, gathered: false,
    price: "0.0020000005", remaining: "0.002" }]);
  const inspection = inspectReadDecisions(pending);
  expect(inspection?.totals).toMatchObject({ unresolvedCandidates: 1, byDisposition: { BUY: 0, UNKNOWN: 1 }, proposalPlanComparisons: 0 });
  expect(inspection?.candidates[0]).toMatchObject({ proposal: "UNKNOWN", plan: "UNKNOWN", checkpointDisposition: "UNKNOWN" });
  expect(inspection?.rows[1].amounts.priceMicros).toBeNull();
  expect(inspectReadDecisions(packet([{ kind: "review", required: true }, { kind: "review-verdict", verdict: "admitted" }]))
    ?.candidates[0].checkpointDisposition).toBe("UNKNOWN");
});

it("keeps normalization and final observations separate from selected plan and checkpoint admission", () => {
  const first = packet([{ kind: "channel", creatorFree: false, cache: false }], { proposal: "CACHE", plan: "BUY" });
  const mapping = { candidate: 1, proposal: "CACHE" as const, matched: true, duplicate: false, external: false, public: false, claimCount: 1, targets: [0] };
  const normalization = { candidate: 1, proposal: "CACHE" as const, mapped: "CACHE" as const, price: "0.002", expectedValue: "0.8",
    claimCount: 1, targets: [0], allowedTargets: [0], freshCache: false, originalPage: false, discussion: false, attentionFloor: "0.2" };
  const extended: ActualReadPacketV2 = { ...first, schema: 2, policy: ACTUAL_READ_CAPTURE_V2, coverage: "normalization-and-read-checkpoints",
    mappings: [{ input: mapping, outcome: replayMapping(mapping) }], normalizations: [{ input: normalization, outcome: replayNormalization(normalization) }],
    portfolio: null, stops: [], observations: { actions: [{ candidate: 1, action: "SKIP", price: "0.002", priceMicros: "2000" }],
      citations: [], payments: [{ candidate: 1, kind: "fetch", amount: "0.002", amountMicros: "2000", status: "simulated", settled: true }] } };
  const inspected = inspectReadDecisions(extended);
  expect(inspected?.normalizations[0].outcome).toMatchObject({ action: "BUY", rule: "cache-expired" });
  expect(inspected?.candidates[0]).toMatchObject({ proposal: "CACHE", plan: "BUY", checkpointDisposition: "BUY", finalObservedActions: ["SKIP"] });
  expect(inspected?.totals).toMatchObject({ proposalPlanComparisons: 1, proposalPlanDifferences: 1 });
  expect(inspected).not.toHaveProperty("settledPayments");
  expect(inspected).not.toHaveProperty("settledUsdc");
});

it("accepts existing schema3 optimizer packets and empty-discovery/evidence STOP without invented candidates", () => {
  const fixture = optimizerPacketFixture(), inspection = inspectReadDecisions(fixture.packet);
  expect(inspection?.schema).toBe(3); expect(inspection?.optimizer?.status).toBe("available");
  expect(inspection?.totals).toMatchObject({ checkpoints: 0, candidates: 0, stopCheckpoints: 1 });
  expect(inspection?.stops).toEqual([{ afterCheckpoint: 0, stage: "evidence", count: 0, action: "STOP" }]);
  expect(previewReadPolicy(fixture.packet, { remainingMicros: "1000", attentionLimit: 1 }))
    .toEqual({ status: "unavailable", reason: "no-recorded-checkpoints" });
});

it("re-evaluates only recorded budget and attention predicates with the unchanged evaluator", () => {
  const source = syntheticDecisionShowcasePacket(), before = JSON.stringify(source);
  const result = previewReadPolicy(source, { remainingMicros: "10000", attentionLimit: 4 });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw Error("Preview unavailable");
  expect(result.scope).toBe("isolated-recorded-checkpoints");
  expect(result.comparisons.map(row => row.sequence)).toEqual([1, 4, 8]);
  expect(result.comparisons.map(row => [row.originalOutcome.action, row.previewOutcome.action])).toEqual([
    ["CONTINUE", "CONTINUE"], ["SKIP", "CONTINUE"], ["STOP", "CONTINUE"]]);
  expect(result.changedCheckpoints).toBe(2);
  for (const comparison of result.comparisons) expect(comparison.previewOutcome).toEqual(actualReadCheckpoint(comparison.previewCheck));
  expect(result).toMatchObject({ alternateTrajectory: "UNKNOWN", eventualReads: "UNKNOWN", answerQuality: "UNKNOWN", settlement: "UNKNOWN" });
  expect(JSON.stringify(source)).toBe(before);
  expect(result.comparisons[1].recordedAmounts).toEqual({ priceMicros: "6000", remainingMicros: "3000" });
  expect(result.comparisons[1].previewCheck).toMatchObject({ remaining: "0.01" });
  expect(previewReadPolicy(packet([{ kind: "channel", creatorFree: false, cache: false }]), { remainingMicros: "10000" }))
    .toEqual({ status: "unavailable", reason: "no-recorded-checkpoints" });
});

it("retains Number tolerance, nonmicro price assertions and guards unrelated to overridden limits", () => {
  const tolerance = packet([budget({ price: "0.0020000005", remaining: "0.002" }), budget({ price: "0.002000002", remaining: "0.002" }),
    budget({ present: false }), budget({ gathered: true })]);
  const result = previewReadPolicy(tolerance, { remainingMicros: "2000" });
  if (result.status !== "available") throw Error("Preview unavailable");
  expect(result.comparisons.map(row => row.previewOutcome)).toEqual([
    { action: "CONTINUE", rule: "budget" }, { action: "SKIP", rule: "budget" },
    { action: "SKIP", rule: "missing-source" }, { action: "SKIP", rule: "duplicate" }]);
  expect(result.comparisons[0].recordedAmounts.priceMicros).toBeNull();
  expect(result.changedCheckpoints).toBe(0);
  const changed = previewReadPolicy(tolerance, { remainingMicros: "2001" });
  expect(changed.status === "available" && changed.comparisons[1].previewOutcome.action).toBe("CONTINUE");
  const zero = previewReadPolicy(packet([budget({ price: "0.000001" })]), { remainingMicros: "0" });
  expect(zero.status === "available" && zero.comparisons[0].previewOutcome.action).toBe("SKIP");
  const minimum = previewReadPolicy(packet([budget({ price: "0.000001" })]), { remainingMicros: "1" });
  expect(minimum.status === "available" && minimum.comparisons[0].previewOutcome.action).toBe("CONTINUE");
});

it.each([{}, null, [], { remainingMicros: 2000 }, { remainingMicros: "-1" }, { remainingMicros: "01" },
  { remainingMicros: "1e3" }, { remainingMicros: "0.001" }, { remainingMicros: "9007199254740992" },
  { remainingMicros: "9007199254740991" }, { remainingMicros: "10000000000000000" }, { attentionLimit: -1 },
  { attentionLimit: -0 }, { attentionLimit: 1.5 }, { attentionLimit: 10001 }, { attentionLimit: NaN },
  { attentionLimit: Infinity }, { priceCeiling: "1000" }, { remainingMicros: "2000", question: "PRIVATE" },
  { remainingMicros: undefined }])("refuses noncanonical or unsupported override %j", overrides => {
  expect(previewReadPolicy(packet([budget()]), overrides)).toEqual({ status: "unavailable", reason: "invalid-overrides" });
});

it("refuses override accessors, foreign prototypes and unknown symbols without invoking coercion", () => {
  const getter = vi.fn(() => "1000"), accessor = {};
  Object.defineProperty(accessor, "remainingMicros", { enumerable: true, get: getter });
  const coercion = vi.fn(() => "1000");
  for (const overrides of [accessor, Object.assign(Object.create({}), { remainingMicros: "1000" }),
    { remainingMicros: { toString: coercion } }, { remainingMicros: "1000", [Symbol("private")]: "PRIVATE" }]) {
    expect(previewReadPolicy(packet([budget()]), overrides)).toEqual({ status: "unavailable", reason: "invalid-overrides" });
  }
  expect(getter).not.toHaveBeenCalled(); expect(coercion).not.toHaveBeenCalled();
});

it("refuses tampered, sparse, unknown, private and foreign packet structures before returning inspection or preview", () => {
  const source = syntheticDecisionShowcasePacket(), changed = structuredClone(source);
  changed.records[0].outcome.action = "BUY";
  const sparse = { ...source, records: Array(1) };
  const amountChanged = structuredClone(source); amountChanged.records[1].amounts.remainingMicros = "6000";
  const getter = vi.fn(() => source.records[0]), accessor = structuredClone(source);
  Object.defineProperty(accessor.records, 0, { enumerable: true, get: getter });
  const schemaGetter = vi.fn(() => 1), schemaAccessor = { ...source };
  Object.defineProperty(schemaAccessor, "schema", { enumerable: true, get: schemaGetter });
  const unsafe = [changed, sparse, amountChanged, accessor, schemaAccessor, { ...source, question: "PRIVATE" },
    { ...source, policy: "future" }, { ...source, records: [{ ...source.records[0], sourceId: "PRIVATE" }] },
    Object.assign(Object.create({}), source), { ...source, [Symbol("private")]: "PRIVATE" }];
  for (const input of unsafe) {
    expect(inspectReadDecisions(input)).toBeNull();
    expect(previewReadPolicy(input, { remainingMicros: "2000" })).toEqual({ status: "unavailable", reason: "invalid-packet" });
  }
  expect(getter).not.toHaveBeenCalled(); expect(schemaGetter).not.toHaveBeenCalled();
});

it("returns a detached canonical snapshot and does not confuse structural validity with retained-digest integrity", async () => {
  const source = packet([budget()]), digest = await actualReadPacketHash(source), inspected = inspectReadDecisions(source);
  source.records[0].check = budget({ remaining: "0.003" });
  source.records[0].outcome = actualReadCheckpoint(source.records[0].check);
  source.records[0].amounts.remainingMicros = "3000";
  expect(inspected?.rows[0].outcome.action).toBe("SKIP");
  expect(inspectReadDecisions(source)?.rows[0].outcome.action).toBe("CONTINUE");
  expect(await verifyActualReadPacket(source, digest)).toBe(false);
});
