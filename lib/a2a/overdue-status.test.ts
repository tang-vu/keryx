import { describe, expect, it } from "vitest";
import type { PaymentRecord } from "../types";
import type { A2aOrder } from "./order";
import { a2aResearchPackage } from "./research-package";
import { originalOrderPayment, paidJobEscalation } from "./overdue-status";
import { originalOrderPaymentSchema, paidJobEscalationSchema } from "./overdue-types";

const accepted = "2026-10-09T00:00:00.000Z", start = Date.parse(accepted);
const payer = `0x${"a".repeat(40)}`, treasury = `0x${"b".repeat(40)}`;
const id = `a2a_${"c".repeat(64)}`;
function order(patch: Partial<A2aOrder> = {}): A2aOrder {
  return { id, queryId: id, authorizationId: "PRIVATE_NONCE", requestHash: "PRIVATE_REQUEST_HASH", payer, payee: treasury,
    amountUsdc: 0.050001, creatorBudgetUsdc: 0.030001, serviceFeeUsdc: 0.02, researchMode: "quick", researchPackage: a2aResearchPackage("quick"),
    status: "running", transaction: "original-circle-reference", request: { question: "PRIVATE_QUESTION", origin: "a2a", network: "eip155:5042" },
    startedAt: "2026-10-09T00:00:01.000Z", workerId: "PRIVATE_WORKER", executionJournalVersion: 1,
    paymentStartedAt: "2026-10-09T00:00:02.000Z", resultSavingAt: null, response: null, errorCode: null, resolution: null,
    createdAt: accepted, updatedAt: "2026-10-09T00:00:02.000Z", ...patch };
}
function pending(patch: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id: "PRIVATE_PAYMENT_ID", kind: "fetch", queryId: id, sourceId: "PRIVATE_SOURCE", sourceName: "PRIVATE_SOURCE_NAME", payer: treasury,
    payee: `0x${"d".repeat(40)}`, amountUsdc: 0.000001, network: "eip155:5042", settled: false, settlementStatus: "pending",
    authorizationId: "PRIVATE_CREATOR_NONCE", authorizationExpiresAt: "2026-10-09T00:00:05.000Z", createdAt: "2026-10-09T00:00:02.000Z", ...patch };
}
describe("on-observation overdue escalation", () => {
  it("alerts after the original target despite an expired but still uncertain payment leg, without changing original records", () => {
    const original = order(), leg = pending(), before = structuredClone({ original, leg });
    const alert = paidJobEscalation(original, start + 180_001, [leg]);
    expect(alert).toMatchObject({ state: "overdue", escalationNeeded: true, targetCompletionAt: "2026-10-09T00:03:00.000Z",
      lastRecordedStage: "creator_payment_boundary", creatorPaymentState: "pending_recorded", evaluation: "on_observation", remedy: "none" });
    expect(paidJobEscalationSchema.parse(alert)).toEqual(alert);
    expect({ original, leg }).toEqual(before);
    expect(JSON.stringify(alert)).not.toMatch(/PRIVATE_|original-circle|0x/);
  });
  it("does not breach at the exact target, and uses the accepted Deep target rather than deployment defaults", () => {
    expect(paidJobEscalation(order(), start + 180_000).state).toBe("within_target");
    const deep = order({ researchMode: "deep", researchPackage: a2aResearchPackage("deep") });
    expect(paidJobEscalation(deep, start + 180_001).state).toBe("within_target");
    expect(paidJobEscalation(deep, start + 300_001).state).toBe("overdue");
  });
  it("includes queue time and never resets the original deadline on later metadata or repair", () => {
    const queued = order({ startedAt: null, paymentStartedAt: null, updatedAt: accepted });
    expect(paidJobEscalation(queued, start + 180_001, [])).toMatchObject({ state: "overdue", lastRecordedStage: "queued", creatorPaymentState: "no_creator_call_recorded" });
    const later = order({ updatedAt: "2026-10-09T02:00:00.000Z" });
    expect(paidJobEscalation(later, start + 7_200_001).targetCompletionAt).toBe("2026-10-09T00:03:00.000Z");
    const repaired = order({ status: "completed", updatedAt: "2026-10-11T04:00:00.000Z", resolution: {} as A2aOrder["resolution"] });
    expect(paidJobEscalation(repaired, start + 52 * 3_600_000)).toMatchObject({ state: "completed", escalationNeeded: false, targetCompletionAt: "2026-10-09T00:03:00.000Z" });
  });
  it.each([null, { ...a2aResearchPackage("quick"), version: "future" }, { ...a2aResearchPackage("quick"), serviceLevel: { kind: "provisional_slo" as const, targetCompletionMs: 1, startsAt: "accepted_at" as const, remedy: "none" as const } }])("never invents a target for absent/changed package provenance", researchPackage => {
    expect(paidJobEscalation(order({ researchPackage }), start + 180_001)).toMatchObject({ state: "unavailable", escalationNeeded: null, targetCompletionMs: null });
  });
  it.each(["not a date", "2026-02-30T00:00:00.000Z", "2026-10-09T24:00:00Z", "2026-10-10T00:00:00.000Z"])("keeps unknown/future/calendar-invalid acceptance timing unavailable: %s", createdAt => {
    expect(paidJobEscalation(order({ createdAt }), start + 180_001)).toMatchObject({ state: "unavailable", escalationNeeded: null, targetCompletionAt: null });
  });
  it.each(["2026-10-09T00:00:00Z", "2026-10-09T00:00:00.000000+00:00", "2026-10-09T07:00:00+07:00"])("retains supported Supabase offset/fractional timestamp forms: %s", createdAt => {
    expect(paidJobEscalation(order({ createdAt }), start + 180_001)).toMatchObject({ state: "overdue", acceptedAt: accepted, targetCompletionAt: "2026-10-09T00:03:00.000Z" });
  });
  it("rounds actual sub-millisecond storage clocks conservatively without inventing checkpoint precision", () => {
    const precise = order({ createdAt: "2026-10-09T00:00:00.000123+00:00" });
    expect(paidJobEscalation(precise, start + 180_001)).toMatchObject({ state: "within_target", lastRecordedStage: "unknown" });
    expect(paidJobEscalation(precise, start + 180_002)).toMatchObject({ state: "overdue", targetCompletionAt: "2026-10-09T00:03:00.001Z" });
  });
  it.each([NaN, Infinity, start - 1, start + 0.5])("does not infer a current observation from an invalid/backward clock", now => {
    expect(paidJobEscalation(order(), now).state).toBe("unavailable");
  });
  it.each([{ updatedAt: "bad" }, { startedAt: "bad" }, { startedAt: "2026-10-09T00:20:00.000Z" }, { executionJournalVersion: null }, { paymentStartedAt: "bad" }])("still shows a known overdue acceptance clock while keeping uncertain execution markers unknown", patch => {
    expect(paidJobEscalation(order(patch), start + 180_001, [pending()])).toMatchObject({ state: "overdue", escalationNeeded: true, lastRecordedStage: "unknown", creatorPaymentState: "unknown" });
  });
  it.each([{ network: "eip155:1" }, { queryId: "foreign-query" }, { payer }, { amountUsdc: 0.0000001 }, { amountUsdc: 0.04 }, { settled: true }, { settlementStatus: "simulated" as const }])("does not treat malformed/foreign/conflicting leg evidence as original financial truth", patch => {
    expect(paidJobEscalation(order(), start + 180_001, [pending(patch)]).creatorPaymentState).toBe("unknown");
  });
  it("missing or definitive rows never clear an already crossed creator-payment boundary", () => {
    for (const legs of [null, [], [pending({ settled: true, settlementStatus: "settled" })]]) {
      expect(paidJobEscalation(order(), start + 180_001, legs).creatorPaymentState).toBe("payment_boundary_crossed");
    }
  });
  it.each([{ createdAt: "bad" }, { createdAt: accepted }, { createdAt: "2026-10-09T00:20:00.000Z" }])("keeps malformed/inverted/future creator-leg chronology unknown", patch => {
    expect(paidJobEscalation(order(), start + 180_001, [pending(patch)]).creatorPaymentState).toBe("unknown");
  });
  it("refuses duplicate leg identifiers rather than counting the same uncertain attempt twice", () => {
    expect(paidJobEscalation(order(), start + 180_001, [pending(), pending()]).creatorPaymentState).toBe("unknown");
  });
  it("allows bounded retained failure codes without leaking raw error or worker context", () => {
    expect(paidJobEscalation(order({ status: "failed", errorCode: "PRIVATE_ERROR" }), start + 180_001)).toMatchObject({ state: "overdue", failureCode: "unknown", escalationNeeded: true });
    expect(paidJobEscalation(order({ status: "failed", errorCode: "research_failed" }), start + 180_001).failureCode).toBe("research_failed");
  });
  it("returns exact owner payment micros and original recorded network, never today's profile or authorization nonce", () => {
    const refs = originalOrderPayment(order());
    expect(originalOrderPaymentSchema.parse(refs)).toEqual({ kind: "inbound_payment", reference: "original-circle-reference", network: "eip155:5042", asset: "USDC", amountMicros: "50001" });
    expect(JSON.stringify(refs)).not.toContain("PRIVATE_");
    expect(originalOrderPayment(order({ request: null, transaction: "https://private.invalid/token", amountUsdc: 0.0000001 }))).toMatchObject({ network: null, reference: null, amountMicros: null });
    expect(originalOrderPayment(order({ request: { question: "private", origin: "a2a", monthlyId: "plan", network: "eip155:5042002" } }))).toMatchObject({ kind: "monthly_allocation", network: "eip155:5042002", amountMicros: "50001" });
  });
});
