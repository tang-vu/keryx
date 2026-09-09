"use client";

import { ResearchDecisions } from "./research-decisions";
import type { BuyerJob } from "@/lib/a2a/buyer-workspace";
const usdc = (value: number | null | undefined) => value == null ? "Unknown" : `${value.toFixed(6)} USDC`;

export function ResearchJobDetails({ job, onDownloadReceipt }: { job: BuyerJob; onDownloadReceipt?: () => void }) {
  return (
    <div className="mt-5 space-y-6">
      {(job.message || job.error) && <p className="border-l-2 border-seal pl-4 font-serif">{job.message ?? job.error}</p>}
      {job.status === "review_required" && <p className="font-serif">Operator review is required. Automatic polling has stopped. Refresh this job after review; do not submit a new payment to recover it.</p>}
      {job.status === "completed" && job.serviceReceipt?.quality?.status === "measured" && job.serviceReceipt.quality.groundedClaimRate === 0 && <p role="status" className="border-l-2 border-seal pl-4 font-serif">No supported answer. The job finished, but none of its research targets reached the evidence threshold. Review the interpretation and evidence before buying again. The fixed package remains paid; unused creator reserve is not a refund.</p>}
      {job.status === "completed" && job.serviceReceipt?.quality?.status === "unavailable" && <p className="border-l-2 border-seal pl-4 font-serif">Research quality is unverified. Job completion and a valid receipt do not establish a supported answer.</p>}
      {(job.serviceStatus || job.serviceReceipt) && <p className="font-mono text-xs">{Math.round((job.serviceStatus?.elapsedMs ?? job.serviceReceipt!.totalDurationMs) / 1000)}s elapsed · {Math.round((job.serviceStatus?.targetCompletionMs ?? job.serviceReceipt!.targetCompletionMs) / 1000)}s provisional target · {job.serviceStatus ? (job.serviceStatus.targetBreached ? "target exceeded" : "in progress") : job.serviceReceipt!.targetMet ? "target met" : "target not met"}. No SLA remedy.</p>}
      {job.pricing ? <>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["Package paid", job.pricing.totalPriceUsdc], ["Service fee", job.pricing.serviceFeeUsdc],
            ["Creator cap", job.pricing.creatorBudgetUsdc], ["Settled to creators", job.pricing.settledCreatorSpendUsdc],
            ["Pending creator spend", job.pricing.pendingCreatorSpendUsdc], ["Unused reserve (not a refund)", job.pricing.unusedCreatorReserveUsdc],
          ] as const).map(([label, value]) => <div key={label} className="border border-line p-4"><dt className="font-mono text-xs text-ink-3">{label}</dt><dd className="mt-2 font-serif text-lg">{usdc(value)}</dd></div>)}
        </dl>
        {job.pricing.accountingComplete === false && <p className="text-seal">Incomplete accounting: recorded creator payments are a lower bound. Unused reserve is unknown.</p>}
      </> : <p className="font-serif text-ink-3">Creator settlement totals are not available in this response yet.</p>}
      {job.serviceReceipt?.quality && <p className="font-serif">Grounded claims: {job.serviceReceipt.quality.status === "measured" && job.serviceReceipt.quality.groundedClaimRate !== null ? `${(job.serviceReceipt.quality.groundedClaimRate * 100).toFixed(1)}%` : "measurement unavailable"}.</p>}
      {job.answer && <div><h3 className="font-display text-2xl">Research answer</h3><p className="mt-3 whitespace-pre-wrap font-serif leading-relaxed">{job.answer}</p></div>}
      {job.status === "completed" && typeof job.answer === "string" && <ResearchDecisions key={job.queryId} queryId={job.queryId} answer={job.answer} claims={job.claimCoverage ?? []} />}
      {!!job.claimCoverage?.length && <div><h3 className="font-display text-2xl">Claim evidence</h3><ol className="mt-4 space-y-4">{job.claimCoverage.map((claim, index) => <li key={index} className="border border-line p-4">
        <p className="font-serif">{claim.claim}</p><p className="mt-2 font-mono text-xs">{(claim.coverage * 100).toFixed(1)}% evidence coverage</p>
        {job.evidence?.filter((item) => item.claimIndex === claim.claimIndex).map((item, i) => <blockquote key={i} className="mt-3 border-l border-line pl-3 font-serif text-sm"><p>“{item.quote}”</p><cite>{item.sourceName}</cite></blockquote>)}
      </li>)}</ol></div>}
      {job.status === "completed" && (onDownloadReceipt ? <button type="button" onClick={onDownloadReceipt} className="inline-block border border-ink px-4 py-3 font-mono text-xs">Download verified receipt</button> : <a href={`/api/dispatch/${job.queryId}/receipt`} referrerPolicy="no-referrer" className="inline-block border border-ink px-4 py-3 font-mono text-xs">Open portable receipt JSON</a>)}
      <p className="font-serif text-xs text-ink-3">Arc testnet USDC. Evidence coverage measures grounding; it does not certify factual correctness. This view displays server-reported settlement; downloading a receipt does not independently verify it.</p>
    </div>
  );
}
