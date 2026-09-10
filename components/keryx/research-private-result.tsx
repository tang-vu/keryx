import { privateUsdc, type PrivateWorkspaceResult } from "@/lib/a2a/private-workspace";

const statuses = {
  "awaiting-payment": "Payment has not been confirmed. This lookup does not retry payment.",
  "awaiting-execution": "Payment is confirmed; execution has not been claimed yet.",
  "execution-claimed": "Execution was claimed, but no completed result is stored yet. This does not establish that the worker is still running. Refresh later; do not pay again to recover this job.",
  completed: "Research completed. Review its evidence and payment status separately.",
};
export function ResearchPrivateResult({ job }: { job: PrivateWorkspaceResult }) {
  const { creator, incoming } = job.spend;
  return <div className="mt-5 space-y-5">
    <h3 className="break-words font-display text-2xl">{job.request.question}</h3>
    <p role="status" className="font-serif">{statuses[job.status]}</p>
    <p className="text-sm">Package payment: {incoming.status} · {privateUsdc(incoming.priceMicros)} · Arc testnet</p>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
      ["Creator cap", creator.budgetMicros], ["Committed", creator.committedMicros], ["Unresolved", creator.unresolvedMicros],
      ["Circle processing", creator.processingMicros], ["Confirmation evidence", creator.confirmedMicros], ["Uncommitted", creator.uncommittedMicros],
    ] as const).map(([label, value]) => <div key={label} className="border border-line p-3"><dt className="font-mono text-xs text-ink-3">{label}</dt><dd className="mt-2 font-serif">{privateUsdc(value)}</dd></div>)}</dl>
    <p className="text-xs text-ink-3">Uncommitted budget is not a refund. Circle processing and confirmation evidence do not independently verify chain finality. Figures reflect the current stored evidence.</p>
    {!!creator.payments.length && <details><summary className="cursor-pointer font-serif">Creator payment evidence</summary><ul className="mt-3 space-y-3">{creator.payments.map((payment, i) => <li key={i} className="break-all border border-line p-3 text-sm">
      <p>{payment.kind} · {privateUsdc(payment.amountMicros)} · {payment.status}</p><p>Recipient: {payment.payee}</p>
      {payment.reference && <p>{payment.evidenceSource}: {payment.reference}</p>}
    </li>)}</ul></details>}
    {job.result && <>
      <h4 className="font-display text-2xl">Research answer</h4>
      <p className="whitespace-pre-wrap break-words font-serif leading-relaxed">{job.result.answer}</p>
      {job.result.evidence === null ? <p className="text-sm text-ink-3">Evidence measurements are unavailable.</p>
        : !job.result.evidence.some(item => item.qualifiesForReward) && <p className="border-l-2 border-seal pl-3 text-sm">No evidence qualified for creator rewards. Completion does not establish a supported answer.</p>}
      <h4 className="font-display text-2xl">Source decisions</h4>
      <ul className="space-y-3">{job.result.decisions.map((decision, i) => <li key={i} className="border border-line p-4">
        <p className="font-mono text-xs">{decision.action} · {decision.sourceName} · Toll {decision.price.toFixed(6)} USDC</p>
        <p className="mt-2 break-words font-serif">{decision.rationale}</p>
      </li>)}</ul>
      {!!job.result.citations.length && <div><h4 className="font-display text-2xl">Citation attribution</h4><ul className="mt-3 space-y-3">{job.result.citations.map((citation, i) => <li key={i} className="border border-line p-3 text-sm">
        <p>{citation.marker} · {citation.sourceName} · {(citation.weight * 100).toFixed(1)}% contribution</p><p>{citation.rationale}</p>
        <p>Recorded reward: {citation.recordedRewardUsdc.toFixed(6)} USDC. See current payment evidence above.</p>
      </li>)}</ul></div>}
      {!!job.result.claimCoverage?.length && <div><h4 className="font-display text-2xl">Claim evidence</h4><ol className="mt-3 space-y-3">{job.result.claimCoverage.map((claim, i) => <li key={i} className="border border-line p-4">
        <p className="font-serif">{claim.claim}</p><p className="mt-2 text-xs">{(claim.coverage * 100).toFixed(1)}% evidence coverage</p>
        {job.result!.evidence?.filter(item => item.claimIndex === claim.claimIndex).map((item, j) => <blockquote key={j} className="mt-3 border-l border-line pl-3 font-serif text-sm"><p className="whitespace-pre-wrap break-words">“{item.quote}”</p><cite>{item.sourceName}</cite></blockquote>)}
      </li>)}</ol></div>}
      <p className="text-xs text-ink-3">Server-reported research and payment evidence. This view is not a portable verified receipt. Evidence coverage does not certify factual correctness.</p>
    </>}
  </div>;
}
