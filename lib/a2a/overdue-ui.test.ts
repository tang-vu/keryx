import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, it } from "vitest";
import { ResearchJobEscalation } from "../../components/keryx/research-job-escalation";
import { accountHistorySchema } from "./account-history-types";
import type { PaidJobEscalation } from "./overdue-types";

const escalation: PaidJobEscalation = { state: "overdue", escalationNeeded: true, observedAt: "2026-10-09T00:04:00Z",
  acceptedAt: "2026-10-09T00:00:00Z", targetCompletionAt: "2026-10-09T00:03:00Z", targetCompletionMs: 180000, elapsedMs: 240000,
  lastRecordedStage: "creator_payment_boundary", failureCode: null, creatorPaymentState: "pending_recorded",
  evaluation: "on_observation", objectiveKind: "provisional_slo", remedy: "none" };
it("renders an observed overdue alert without implying notification, remedy or another payment action", () => {
  const html = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation }));
  expect(html).toContain('role="alert"'); expect(html).toContain("pending"); expect(html).toContain("Do not pay again");
  expect(html).toContain("does not mean that a person has been notified");
  expect(html).not.toMatch(/<button|<a |original-ref|Original order amount/);
  const owner = renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation, original: { orderId: "original-id",
    payment: { kind: "inbound_payment", reference: "original-ref", network: "eip155:5042", asset: "USDC", amountMicros: "50001" } } }));
  for (const text of ["original-id", "original-ref", "eip155:5042", "50001", "micro-USDC"]) expect(owner).toContain(text);
});
it("keeps unavailable timing explicit and accepts old strict history packets without invented escalation", () => {
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation))).toBe("");
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: { ...escalation, state: "within_target", escalationNeeded: false } }))).toBe("");
  expect(renderToStaticMarkup(createElement(ResearchJobEscalation, { escalation: { ...escalation, state: "unavailable", escalationNeeded: null } }))).toContain('role="status"');
  const packet = accountHistorySchema.parse({ wallet: `0x${"a".repeat(40)}`, jobs: [{ id: `a2a_${"b".repeat(64)}`, question: null,
    status: "queued", createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", mode: "quick", packagePriceUsdc: 0.05 }], nextCursor: null });
  expect(packet.jobs[0].escalation).toBeUndefined(); expect(packet.jobs[0].originalPayment).toBeUndefined();
});
