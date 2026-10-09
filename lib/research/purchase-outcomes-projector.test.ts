import { describe, expect, it } from "vitest";
import retained from "../../fixtures/purchase-outcomes/retained-testnet.json";
import { projectPurchaseOutcomes, type PurchaseOutcomeSnapshot } from "./purchase-outcomes-projector";
import { validatePurchaseOutcomes } from "./purchase-outcomes-contract";

const snapshot = () => structuredClone(retained.snapshot) as PurchaseOutcomeSnapshot;
function bought(value = snapshot()) { return value.decisions.find(row => row.action === "BUY")!; }
function observed(value = snapshot()) { return value.trace[0].detail as Record<string, unknown>; }
const project = (value: unknown) => projectPurchaseOutcomes(value, "eip155:5042");

describe("public retained purchase outcomes", () => {
  it("scores the minimized real archived positive record without relabeling or mutating it", () => {
    const value = snapshot(), original = structuredClone(value), result = project(value);
    expect(retained.provenance.originalResponseSha256).toBe("2dd22294582fde9de0f70db23f2e60d95e28b4e80e877b83663bd5c75766d0b0");
    expect(result.network).toBe("eip155:5042002"); expect(result.archive).toEqual(value.archive);
    expect(result.counts).toEqual({ recordedBuyDecisions: 1, scoredPurchases: 1, citedPurchases: 0,
      unscoredBuyDecisions: 0, tracePaymentObservations: 1, excludedPaymentObservations: 0 });
    expect(result.purchases[0]).toMatchObject({ sourceId: bought(value).sourceId, itemId: bought(value).itemId,
      contentVersion: bought(value).contentVersion, expectedValue: 0.136,
      settledAccessMicros: "2000", settledRewardMicros: "0", cited: false, contributionWeight: 0 });
    expect(result.hitRate).toBe(0); expect(result.uncitedAccessMicros).toBe("2000");
    expect(result.calibration[0]).toEqual({ lower: 0, upper: 0.2, samples: 1, predictedMean: 0.136, citationRate: 0 });
    expect(result.calibration.slice(1).every(row => row.samples === 0 && row.predictedMean === null && row.citationRate === null)).toBe(true);
    expect(result.cohort).toBe("unknown"); expect(result.missedValue).toBeNull(); expect(result.costPerSupportedClaim).toBeNull();
    expect(value).toEqual(original);
  });
  it("never emits private payloads or infers current sources, participants or zero source cost", () => {
    const value = { ...snapshot(), question: "PRIVATE QUESTION", asker: "PRIVATE WALLET", cohort: "outside",
      originalFulfillment: { nonce: "PRIVATE NONCE" }, review: { reason: "PRIVATE REASON" } };
    Object.assign(observed(value), { payer: "PRIVATE PAYER", payee: "PRIVATE PAYEE", authorizationId: "PRIVATE AUTH", rationale: "PRIVATE RATIONALE" });
    const json = JSON.stringify(project(value));
    expect(json).not.toContain("PRIVATE"); expect(json).not.toContain("outside");
    expect(json).not.toMatch(/question|asker|wallet|payer|payee|nonce|authorization|rationale/);
  });
  it("matches citations and rewards only to the retained exact item/version", () => {
    const value = snapshot();
    Object.assign(value, { citations: [{ sourceId: bought(value).sourceId, itemId: bought(value).itemId,
      contentVersion: bought(value).contentVersion, weight: 0.75 }] });
    value.trace.push({ detail: { ...observed(value), id: "citation-observation", kind: "citation", amountUsdc: 0.000001 } });
    const result = project(value);
    expect(result.hitRate).toBe(1); expect(result.uncitedAccessMicros).toBe("0");
    expect(result.purchases[0]).toMatchObject({ cited: true, contributionWeight: 0.75, settledRewardMicros: "1" });
    value.citations[0].contentVersion = "other-version";
    expect(project(value).purchases[0].cited).toBe(false);
  });
  it.each(["itemId", "contentVersion"])("withholds source-only legacy BUY %s", key => {
    const value = snapshot(); delete (bought(value) as Record<string, unknown>)[key];
    const result = project(value);
    expect(result.hitRate).toBeNull(); expect(result.counts.unscoredBuyDecisions).toBe(1);
    expect(result.counts.excludedPaymentObservations).toBe(1);
  });
  it("counts a consistent repeated BUY and payment once, exposing excluded/unscored counts", () => {
    const value = snapshot(); value.decisions.push({ ...bought(value) }); value.trace.push(structuredClone(value.trace[0]));
    const result = project(value);
    expect(result.counts).toMatchObject({ recordedBuyDecisions: 2, scoredPurchases: 1,
      unscoredBuyDecisions: 1, tracePaymentObservations: 2, excludedPaymentObservations: 1 });
    expect(result.uncitedAccessMicros).toBe("2000");
  });
  it("refuses conflicting decision and payment identities including different private payees", () => {
    const value = snapshot(); value.decisions.push({ ...bought(value), expectedValue: 0.9 });
    expect(() => project(value)).toThrow();
    const paymentConflict = snapshot();
    Object.assign(observed(paymentConflict), { payee: "one-owner" });
    paymentConflict.trace.push({ detail: { ...observed(paymentConflict), payee: "different-owner" } } as typeof paymentConflict.trace[0]);
    expect(() => project(paymentConflict)).toThrow();
  });
  it.each([
    { queryId: "different-run" }, { network: "eip155:5042" }, { contentVersion: "new-current-version" },
    { settlementStatus: "pending" }, { settlementStatus: "simulated" }, { settlementStatus: "failed" },
    { settled: false }, { txHash: null }, { id: undefined }, { amountUsdc: 0 },
    { amountUsdc: 1e-15 }, { amountUsdc: -1e-15 }, { amountUsdc: 0.002000000000001 },
    { amountUsdc: Number.MAX_SAFE_INTEGER },
  ])("excludes uncertain, incompatible or inexact observation %j", change => {
    const value = snapshot(); Object.assign(observed(value), change);
    const result = project(value); expect(result.counts.scoredPurchases).toBe(0);
    expect(result.counts.unscoredBuyDecisions).toBe(1); expect(result.hitRate).toBeNull();
    // A zero access observation cannot enter the score but remains a recorded
    // eligible payment; other incompatible rows are explicitly excluded.
    expect(result.counts.excludedPaymentObservations).toBe(change.amountUsdc === 0 ? 0 : 1);
  });
  it("does not interpret a price, message, nested object, CACHE or SKIP as a purchase", () => {
    const value = snapshot(); value.trace = [{ detail: { quotedPayment: observed(value) } } as unknown as typeof value.trace[0]];
    expect(project(value).counts.tracePaymentObservations).toBe(0);
    bought(value).action = "CACHE"; expect(project(value).counts.recordedBuyDecisions).toBe(0);
  });
  it.each(["", " ", null])("refuses an incomplete answer %j", answer => {
    expect(() => project({ ...snapshot(), answer })).toThrow();
  });
  it("refuses malformed money/action/weight, oversized or adversarial portable inputs without executing hooks", () => {
    const getter = { ...snapshot() }; let calls = 0;
    Object.defineProperty(getter, "question", { enumerable: true, get() { calls++; throw new Error(); } });
    expect(() => project(getter)).toThrow(); expect(calls).toBe(0);
    expect(() => project({ ...snapshot(), toJSON() { calls++; } })).toThrow(); expect(calls).toBe(0);
    expect(() => project({ ...snapshot(), question: "x".repeat(1024 * 1024) })).toThrow();
    expect(() => project({ ...snapshot(), trace: Array(513).fill({}) })).toThrow();
    const badWeight = snapshot(); bought(badWeight).expectedValue = 1.01; expect(() => project(badWeight)).toThrow();
    const badPayment = snapshot(); observed(badPayment).amountUsdc = NaN; expect(() => project(badPayment)).toThrow();
  });
  it("rejects tampered sample, network, identity and private output extensions", () => {
    const result = project(snapshot());
    expect(() => validatePurchaseOutcomes({ ...result, question: "secret" })).toThrow();
    expect(() => validatePurchaseOutcomes(result, "other-id")).toThrow();
    expect(() => validatePurchaseOutcomes({ ...result, network: "eip155:5042" })).toThrow();
    expect(() => validatePurchaseOutcomes({ ...result, hitRate: 1 })).toThrow();
    expect(() => validatePurchaseOutcomes({ ...result, calibration: result.calibration.map((band, index) =>
      index === 0 ? { ...band, samples: 0 } : band) })).toThrow();
  });
});
