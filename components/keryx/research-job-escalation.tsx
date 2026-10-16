"use client";

import type { z } from "zod";
import { useState } from "react";
import type { originalOrderPaymentSchema, PaidJobEscalation } from "@/lib/a2a/overdue-types";
import copy from "@/locales/en/paid-job-escalation.json";
import { jobTargetCopy } from "@/locales/en/job-targets";
import { useJobTargetWarning } from "@/lib/operator/job-target-observation";
import { jobTargetCustomerState, type JobTargetStatus } from "@/lib/operator/job-targets";
import { AccountJobs } from "./account-jobs";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_jobTargetCopy = jobTargetCopy;


export function ResearchJobEscalation({ escalation, original, status }: {
  escalation?: PaidJobEscalation;
  status?: JobTargetStatus;
  original?: { orderId: string; payment: z.infer<typeof originalOrderPaymentSchema> };
}) {
  return <>{original && <AccountJobs orderId={original.orderId} />}<ObservedJobEscalation escalation={escalation} original={original} status={status} /></>;
}

function ObservedJobEscalation({ escalation, original, status }: {
  escalation?: PaidJobEscalation;
  status?: JobTargetStatus;
  original?: { orderId: string; payment: z.infer<typeof originalOrderPaymentSchema> };
}) {
  const jobTargetCopy = useUiCopy("job-targets", uiEnglish_jobTargetCopy);
  const localWarning = useJobTargetWarning(escalation, status);
  const customerState = jobTargetCustomerState(escalation, localWarning, status);
  const [choice, setChoice] = useState<"wait" | "partial" | "human" | null>(null);
  if (!escalation || customerState === "within_target_on_observation" || customerState === "completed_on_observation") return null;
  if (customerState === "unavailable") return <p role="status" className="mt-3 text-sm text-ink-3">{copy.unavailable}</p>;
  const needsReview = customerState === "needs_review_on_observation";
  return <div role="alert" data-job-target-state={customerState} className="mt-4 space-y-3 border-l-2 border-seal pl-4 font-serif text-sm">
    <p className="font-semibold text-seal">{needsReview ? jobTargetCopy.reviewTitle : localWarning ? jobTargetCopy.localTitle : copy.overdueTitle}</p>
    <p>{needsReview ? jobTargetCopy.reviewBody : localWarning ? jobTargetCopy.localBody : copy.overdueBody}</p>
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
    <p>{jobTargetCopy.originalOnly}</p>
    <fieldset className="space-y-3 border border-line p-3">
      <legend>{jobTargetCopy.choices}</legend>
      <p className="text-xs text-ink-3">{jobTargetCopy.choiceNotice}</p>
      <div className="flex flex-wrap gap-3">{(["wait", "partial", "human"] as const).map(value =>
        <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)} className="border border-ink px-3 py-2 font-mono text-xs">{jobTargetCopy[value]}</button>)}</div>
      {choice && <p role="status">{jobTargetCopy[`${choice}Body`]}</p>}
    </fieldset>
    <p className="text-xs text-ink-3">{needsReview ? jobTargetCopy.reviewObservation : localWarning ? jobTargetCopy.localObservation : copy.observation}</p>
  </div>;
}
