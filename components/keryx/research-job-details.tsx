"use client";

import { createMessages } from "@/lib/i18n/messages";

import { ResearchDecisions } from "./research-decisions";
import { ResearchJobEscalation } from "./research-job-escalation";
import { DeliverableAcceptance } from "./deliverable-acceptance";
import type { BuyerJob } from "@/lib/a2a/buyer-workspace";
import { createFormatters } from "@/lib/i18n/format";

const uiFormat = createFormatters("en");

const message = createMessages("en");
const usdc = (value: number | null | undefined) => value == null ? message("researchJobDetails.unknown") : `${uiFormat.usdc(value)} USDC`;

export function ResearchJobDetails({ job, onDownloadReceipt }: { job: BuyerJob; onDownloadReceipt?: () => void }) {
  return (
    <div className="mt-5 space-y-6">
      <ResearchJobEscalation escalation={job.escalation} />
      {job.funding && <p className="font-serif text-sm">{message("researchJobDetails.monthlyAllocation", { amount: usdc(job.funding.allocationUsdc) })}</p>}
      {(job.message || job.error) && <p className="border-l-2 border-seal pl-4 font-serif">{job.message ?? job.error}</p>}
      {job.status === "review_required" && <p className="font-serif">{message("researchJobDetails.reviewRequired")}</p>}
      {job.status === "completed" && job.serviceReceipt?.quality?.status === "measured" && job.serviceReceipt.quality.groundedClaimRate === 0 && <p role="status" className="border-l-2 border-seal pl-4 font-serif">{message("researchJobDetails.unsupported")}</p>}
      {job.status === "completed" && job.serviceReceipt?.quality?.status === "unavailable" && <p className="border-l-2 border-seal pl-4 font-serif">{message("researchJobDetails.qualityUnverified")}</p>}
      {(job.serviceStatus || job.serviceReceipt) && <p className="font-mono text-xs">{message("researchJobDetails.timing", { elapsed: Math.round((job.serviceStatus?.elapsedMs ?? job.serviceReceipt!.totalDurationMs) / 1000), target: Math.round((job.serviceStatus?.targetCompletionMs ?? job.serviceReceipt!.targetCompletionMs) / 1000), state: job.serviceStatus ? (job.serviceStatus.targetBreached ? message("researchJobDetails.targetExceeded") : message("researchJobDetails.inProgress")) : job.serviceReceipt!.targetMet ? message("researchJobDetails.targetMet") : message("researchJobDetails.targetNotMet") })}</p>}
      {job.pricing ? <>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            [message("researchJobDetails.packagePaid"), job.pricing.totalPriceUsdc], [message("researchJobDetails.serviceFee"), job.pricing.serviceFeeUsdc],
            [message("researchJobDetails.creatorCap"), job.pricing.creatorBudgetUsdc], [message("researchJobDetails.settled"), job.pricing.settledCreatorSpendUsdc],
            [message("researchJobDetails.pending"), job.pricing.pendingCreatorSpendUsdc], [message("researchJobDetails.unusedReserve"), job.pricing.unusedCreatorReserveUsdc],
          ] as const).map(([label, value]) => <div key={label} className="border border-line p-4"><dt className="font-mono text-xs text-ink-3">{label}</dt><dd className="mt-2 font-serif text-lg">{usdc(value)}</dd></div>)}
        </dl>
        {job.pricing.accountingComplete === false && <p className="text-seal">{message("researchJobDetails.accountingIncomplete")}</p>}
      </> : <p className="font-serif text-ink-3">{message("researchJobDetails.settlementUnavailable")}</p>}
      {job.serviceReceipt?.quality && <p className="font-serif">{job.serviceReceipt.quality.status === "measured" && job.serviceReceipt.quality.groundedClaimRate !== null ? message("researchJobDetails.groundedRate", { rate: uiFormat.decimal(job.serviceReceipt.quality.groundedClaimRate * 100, 1) }) : message("researchJobDetails.groundedUnavailable")}</p>}
      {job.answer && <div><h3 className="font-display text-2xl">{message("researchJobDetails.answer")}</h3><p className="mt-3 whitespace-pre-wrap font-serif leading-relaxed">{job.answer}</p></div>}
      {job.status === "completed" && typeof job.answer === "string" && <DeliverableAcceptance id={job.queryId} answer={job.answer} />}
      {job.status === "completed" && typeof job.answer === "string" && <ResearchDecisions key={job.queryId} queryId={job.queryId} answer={job.answer} claims={job.claimCoverage ?? []} />}
      {!!job.claimCoverage?.length && <div><h3 className="font-display text-2xl">{message("researchJobDetails.claimEvidence")}</h3><ol className="mt-4 space-y-4">{job.claimCoverage.map((claim, index) => <li key={index} className="border border-line p-4">
        <p className="font-serif">{claim.claim}</p><p className="mt-2 font-mono text-xs">{message("researchJobDetails.coverage", { rate: uiFormat.decimal(claim.coverage * 100, 1) })}</p>
        {job.evidence?.filter((item) => item.claimIndex === claim.claimIndex).map((item, i) => <blockquote key={i} className="mt-3 border-l border-line pl-3 font-serif text-sm [overflow-wrap:anywhere]"><p className="whitespace-pre-wrap">“{item.quote}”</p><cite>{item.sourceName}</cite></blockquote>)}
      </li>)}</ol></div>}
      {job.status === "completed" && (onDownloadReceipt ? <button type="button" onClick={onDownloadReceipt} className="inline-block border border-ink px-4 py-3 font-mono text-xs">{message("researchJobDetails.downloadReceipt")}</button> : <a href={`/api/dispatch/${job.queryId}/receipt`} referrerPolicy="no-referrer" className="inline-block border border-ink px-4 py-3 font-mono text-xs">{message("researchJobDetails.openReceipt")}</a>)}
      <p className="font-serif text-xs text-ink-3">{message("researchJobDetails.receiptBoundary")}</p>
    </div>
  );
}
