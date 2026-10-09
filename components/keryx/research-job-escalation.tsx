"use client";

import type { z } from "zod";
import type { originalOrderPaymentSchema, PaidJobEscalation } from "@/lib/a2a/overdue-types";
import copy from "@/locales/en/paid-job-escalation.json";

export function ResearchJobEscalation({ escalation, original }: {
  escalation?: PaidJobEscalation;
  original?: { orderId: string; payment: z.infer<typeof originalOrderPaymentSchema> };
}) {
  if (!escalation || escalation.state === "within_target" || escalation.state === "completed") return null;
  if (escalation.state === "unavailable") return <p role="status" className="mt-3 text-sm text-ink-3">{copy.unavailable}</p>;
  return <div role="alert" className="mt-4 space-y-3 border-l-2 border-seal pl-4 font-serif text-sm">
    <p className="font-semibold text-seal">{copy.overdueTitle}</p>
    <p>{copy.overdueBody}</p>
    <p>{copy.stageLabel}: {copy.stage[escalation.lastRecordedStage]}</p>
    {escalation.failureCode && <p>{copy.failure[escalation.failureCode]}</p>}
    {escalation.creatorPaymentState === "pending_recorded" && <p>{copy.paymentPending}</p>}
    {escalation.creatorPaymentState === "payment_boundary_crossed" && <p>{copy.paymentBoundary}</p>}
    {escalation.creatorPaymentState === "unknown" && <p>{copy.paymentUnknown}</p>}
    {original && <dl className="space-y-2 font-mono text-xs [overflow-wrap:anywhere]">
      <div><dt>{copy.orderLabel}</dt><dd>{original.orderId}</dd></div>
      <div><dt>{original.payment.kind === "monthly_allocation" ? copy.monthlyReferenceLabel : copy.referenceLabel}</dt><dd>{original.payment.reference ?? copy.unknown}</dd></div>
      <div><dt>{copy.networkLabel}</dt><dd>{original.payment.network ?? copy.unknown}</dd></div>
      <div><dt>{copy.amountLabel}</dt><dd>{original.payment.amountMicros ?? copy.unknown}</dd></div>
    </dl>}
    <p>{copy.originalOnly}</p>
    <p className="text-xs text-ink-3">{copy.observation}</p>
  </div>;
}
