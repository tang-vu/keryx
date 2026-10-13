import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import { ResearchJobEscalation } from "../../components/keryx/research-job-escalation";
import { ResearchJobTarget } from "../../components/keryx/research-job-target";
import { accountHistorySchema } from "./account-history-types";
import type { PaidJobEscalation } from "./overdue-types";
import { originalOrderPayment, paidJobEscalation } from "./overdue-status";
import { a2aResearchPackage } from "./research-package-definition";
import type { A2aOrder } from "./order";
import type { PaymentRecord } from "../types";

const accepted = Date.parse("2026-10-12T00:00:00.000Z");
const provider = `0x${"b".repeat(40)}`;
const retainedOriginal = {
  id: "a2a_original_ssr", queryId: "a2a_original_ssr", status: "running", researchMode: "quick",
  researchPackage: a2aResearchPackage("quick"), createdAt: new Date(accepted).toISOString(),
  updatedAt: new Date(accepted + 179_000).toISOString(), startedAt: new Date(accepted + 1000).toISOString(),
  paymentStartedAt: new Date(accepted + 2000).toISOString(), resultSavingAt: null, executionJournalVersion: 1,
  amountUsdc: 0.050001, creatorBudgetUsdc: 0.05, payee: provider, transaction: "original-ssr-reference",
  authorizationId: "PRIVATE_ORIGINAL_NONCE", workerId: "PRIVATE_WORKER",
  request: { network: "eip155:5042002", origin: "a2a", question: "PRIVATE_QUESTION" },
} as A2aOrder;
const retainedLeg: PaymentRecord = {
  id: "PRIVATE_LEG", queryId: retainedOriginal.queryId, kind: "citation", amountUsdc: 0.01,
  payer: provider, payee: `0x${"c".repeat(40)}`, network: "eip155:5042002", settled: false, settlementStatus: "pending",
  createdAt: new Date(accepted + 2500).toISOString(), authorizationExpiresAt: new Date(accepted + 3000).toISOString(),
  sourceId: "PRIVATE_SOURCE", sourceName: "PRIVATE_SOURCE_NAME", authorizationId: "PRIVATE_CREATOR_NONCE",
};

const escalation: PaidJobEscalation = { state: "overdue", escalationNeeded: true, observedAt: "2026-10-09T00:04:00Z",
  acceptedAt: "2026-10-09T00:00:00Z", targetCompletionAt: "2026-10-09T00:03:00Z", targetCompletionMs: 180000, elapsedMs: 240000,
  lastRecordedStage: "creator_payment_boundary", failureCode: null, creatorPaymentState: "pending_recorded",
  evaluation: "on_observation", objectiveKind: "provisional_slo", remedy: "none" };
it("renders an observed overdue alert and local guidance without implying submitted remedies", () => {
  const html = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation }));
  expect(html).toContain('role="alert"'); expect(html).toContain("pending"); expect(html).toContain("Do not pay again");
  expect(html).toContain("does not mean that a person has been notified");
  expect(html).not.toMatch(/<a |original-ref|Original order amount/);
  for (const text of ["Wait", "Partial-result guidance", "Human-review guidance", "does not submit a request", "owner confirmation"]) expect(html).toContain(text);
  expect(html).not.toMatch(/>Refund<|refunded|request submitted/);
  const owner = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation, original: { orderId: "original-id",
    payment: { kind: "inbound_payment", reference: "original-ref", network: "eip155:5042", asset: "USDC", amountMicros: "50001" } } }));
  for (const text of ["original-id", "original-ref", "eip155:5042", "50001", "micro-USDC"]) expect(owner).toContain(text);
});
it("shows tier targets and original acceptance basis before any payment control", () => {
  for (const [mode, seconds] of [["quick", "180"], ["deep", "300"]] as const) {
    const html = renderToStaticMarkup(createElement(ResearchJobTarget, { mode, version: "1.0.0", monthly: true }));
    expect(html).toContain(`${seconds} seconds from original job acceptance`);
    expect(html).toContain("not when the plan is purchased");
    expect(html).toContain("no automatic remedy");
    expect(html).not.toMatch(/<button|<a /);
  }
  expect(renderToStaticMarkup(createElement(ResearchJobTarget, { mode: "quick", version: "future" }))).toContain("target unavailable");
});
it("refuses contradictory overdue clocks in the actual customer component", () => {
  const html = renderToStaticMarkup(createElement(ResearchJobEscalation, {
    escalation: { ...escalation, observedAt: escalation.targetCompletionAt, elapsedMs: escalation.targetCompletionMs },
  }));
  expect(html).toContain('role="status"');
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain("Wait");
});
it("keeps unavailable timing explicit and accepts old strict history packets without invented escalation", () => {
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation))).toBe("");
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: { ...escalation, state: "within_target", escalationNeeded: false,
    observedAt: escalation.targetCompletionAt, elapsedMs: escalation.targetCompletionMs } }))).toBe("");
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: { ...escalation, state: "unavailable", escalationNeeded: null } }))).toContain('role="status"');
  const packet = accountHistorySchema.parse({ wallet: `0x${"a".repeat(40)}`, jobs: [{ id: `a2a_${"b".repeat(64)}`, question: null,
    status: "queued", createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", mode: "quick", packagePriceUsdc: 0.05 }], nextCursor: null });
  expect(packet.jobs[0].escalation).toBeUndefined(); expect(packet.jobs[0].originalPayment).toBeUndefined();
});

it("renders the first overdue millisecond from original acceptance while the expired leg stays pending", () => {
  const before = structuredClone([retainedOriginal, retainedLeg]), bytes = JSON.stringify([retainedOriginal, retainedLeg]);
  // A later retained update cannot restart the accepted target.
  const original = { ...retainedOriginal, updatedAt: new Date(accepted + 180_000).toISOString() };
  const atDeadline = paidJobEscalation(original, accepted + 180_000, [retainedLeg]);
  const firstOverdue = paidJobEscalation(original, accepted + 180_001, [retainedLeg]);
  expect(atDeadline).toMatchObject({ state: "within_target", elapsedMs: 180_000, creatorPaymentState: "pending_recorded" });
  expect(firstOverdue).toMatchObject({ state: "overdue", elapsedMs: 180_001, escalationNeeded: true,
    acceptedAt: retainedOriginal.createdAt, targetCompletionAt: new Date(accepted + 180_000).toISOString(),
    creatorPaymentState: "pending_recorded", remedy: "none" });
  const snapshotsBefore = structuredClone([atDeadline, firstOverdue, original]);
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: atDeadline }))).toBe("");
  const publicHtml = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: firstOverdue }));
  expect(publicHtml).toContain('role="alert"');
  expect(publicHtml).toContain("Expiry or delay does not prove that it failed");
  expect(publicHtml).toContain("does not mean that a person has been notified");
  expect(publicHtml).not.toMatch(/PRIVATE_|a2a_original_ssr|original-ssr-reference|<form|<a /);
  const refs = { orderId: original.id, payment: originalOrderPayment(original) }, refsBefore = structuredClone(refs);
  const ownerHtml = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: firstOverdue, original: refs }));
  for (const text of [original.id, "original-ssr-reference", "eip155:5042002", "50001", "Creator payment boundary recorded",
    "Do not pay again", "owner confirmation", "does not submit a request", "move money"]) expect(ownerHtml).toContain(text);
  expect(ownerHtml).not.toMatch(/PRIVATE_|<form|<a |>Refund<|request submitted|refunded/);
  expect(refs).toEqual(refsBefore);
  expect([atDeadline, firstOverdue, original]).toEqual(snapshotsBefore);
  expect([retainedOriginal, retainedLeg]).toEqual(before);
  expect(JSON.stringify([retainedOriginal, retainedLeg])).toBe(bytes);
});

it("keeps stale SSR within-target at a much later host wall clock and distinguishes a fresh overdue snapshot", () => {
  const retained = paidJobEscalation(retainedOriginal, accepted + 179_000, [retainedLeg]);
  const before = structuredClone([retainedOriginal, retainedLeg, retained]), bytes = JSON.stringify(before);
  const lateHostTime = accepted + 52 * 3_600_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(lateHostTime);
  try {
    expect(Date.now()).toBe(lateHostTime);
    // Static rendering never runs useEffect: this is retained state, not timer evidence.
    expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: retained }))).toBe("");
    const fresh = paidJobEscalation(retainedOriginal, lateHostTime, [retainedLeg]);
    expect(fresh.targetCompletionAt).toBe(retained.targetCompletionAt);
    expect(fresh.creatorPaymentState).toBe("pending_recorded");
    expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: fresh }))).toContain('role="alert"');
    expect(retained.state).toBe("within_target");
    expect([retainedOriginal, retainedLeg, retained]).toEqual(before);
    expect(JSON.stringify([retainedOriginal, retainedLeg, retained])).toBe(bytes);
  } finally { clock.mockRestore(); }
  // No hydration, timer reset, suspended/closed-page or human receipt is exercised.
});

it.each([
  { name: "absent acceptance", patch: { acceptedAt: null } },
  { name: "absent observation", patch: { observedAt: null } },
  { name: "absent deadline", patch: { targetCompletionAt: null } },
  { name: "absent elapsed", patch: { elapsedMs: null } },
  { name: "observation before acceptance", patch: { observedAt: "2026-10-08T23:59:59Z" } },
  { name: "elapsed conflicts with observation", patch: { elapsedMs: 240001 } },
  { name: "deadline conflicts with acceptance", patch: { targetCompletionAt: "2026-10-09T00:03:00.001Z" } },
  { name: "unsupported target", patch: { targetCompletionMs: 1 } },
  { name: "within-target claim after deadline", patch: { state: "within_target" as const, escalationNeeded: false } },
  { name: "contradictory escalation flag", patch: { escalationNeeded: false } },
  { name: "unknown clock state", patch: { state: "unavailable" as const, escalationNeeded: null,
    acceptedAt: null, observedAt: null, targetCompletionAt: null, elapsedMs: null } },
])("refuses $name in SSR without guidance or fabricated remedy", ({ patch }) => {
  const input = { ...escalation, ...patch }, before = structuredClone({ ...escalation, ...patch });
  const html = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: input }));
  expect(html).toContain('role="status"');
  expect(html).toContain("Completion timing is unavailable");
  expect(html).not.toMatch(/role="alert"|<button|<form|Wait|Human-review guidance|request submitted/);
  expect(input).toEqual(before);
});

it.each([
  { name: "failed or missing leg read", legs: null, expected: "payment_boundary_crossed" },
  { name: "wrong recorded network", legs: [{ ...retainedLeg, network: "eip155:5042" }], expected: "unknown" },
  { name: "foreign query", legs: [{ ...retainedLeg, queryId: "foreign_original" }], expected: "unknown" },
  { name: "foreign payer", legs: [{ ...retainedLeg, payer: `0x${"a".repeat(40)}` }], expected: "unknown" },
  { name: "duplicate original legs", legs: [retainedLeg, { ...retainedLeg }], expected: "unknown" },
  { name: "creator cap exceeded", legs: [{ ...retainedLeg, amountUsdc: 0.050001 }], expected: "unknown" },
  { name: "conflicting settlement flag", legs: [{ ...retainedLeg, settled: true }], expected: "unknown" },
])("keeps $name uncertain in customer SSR with original-only guidance", ({ legs, expected }) => {
  const before = structuredClone({ original: retainedOriginal, legs }), bytes = JSON.stringify({ original: retainedOriginal, legs });
  const snapshot = paidJobEscalation(retainedOriginal, accepted + 180_001, legs);
  expect(snapshot).toMatchObject({ state: "overdue", creatorPaymentState: expected, remedy: "none" });
  const snapshotBefore = structuredClone(snapshot);
  const html = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: snapshot }));
  expect(html).toContain('role="alert"');
  expect(html).toContain(expected === "unknown" ? "evidence is unavailable or inconsistent" : "Missing or definitive recorded legs");
  for (const text of ["Do not pay again", "owner confirmation", "does not submit a request", "move money",
    "does not mean that a person has been notified"]) expect(html).toContain(text);
  expect(html).not.toMatch(/PRIVATE_|original-ssr-reference|<form|<a |>Refund<|refunded|request submitted/);
  expect(snapshot).toEqual(snapshotBefore);
  expect({ original: retainedOriginal, legs }).toEqual(before);
  expect(JSON.stringify({ original: retainedOriginal, legs })).toBe(bytes);
});

it("preserves legacy strict history objects without inventing escalation, payment references or remedies", () => {
  const job = { id: `a2a_${"d".repeat(64)}`, question: null, status: "processing", createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:03:00Z", mode: "quick", packagePriceUsdc: 0.05 };
  const input = { wallet: `0x${"a".repeat(40)}`, jobs: [job], nextCursor: null };
  const before = structuredClone(input), bytes = JSON.stringify(input);
  const packet = accountHistorySchema.parse(input);
  expect(packet).toEqual(input);
  expect(Object.keys(packet.jobs[0]).sort()).toEqual(Object.keys(job).sort());
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: packet.jobs[0].escalation }))).toBe("");
  for (const extra of [{ remedy: "refund" }, { customerStateDelivered: true }, { originalPayment: { reference: "fabricated" } }]) {
    const invalid = { ...input, jobs: [{ ...job, ...extra }] }, invalidBefore = structuredClone({ ...input, jobs: [{ ...job, ...extra }] });
    expect(accountHistorySchema.safeParse(invalid).success).toBe(false);
    expect(invalid).toEqual(invalidBefore);
  }
  expect(input).toEqual(before);
  expect(JSON.stringify(input)).toBe(bytes);
});
