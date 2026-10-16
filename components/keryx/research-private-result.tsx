import { formatNumber, formatRecordedAmount, formatSigningUsdc } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import { type PrivateWorkspaceResult } from "@/lib/a2a/private-workspace";
import { UiMessage, UiText } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

const statuses = {
  "awaiting-payment": copy("privateReport.awaitingPayment"),
  "awaiting-execution": copy("privateReport.awaitingExecution"),
  "execution-claimed": copy("privateReport.executionClaimed"),
  interrupted: copy("privateReport.interrupted"),
  completed: copy("privateReport.completed"),
};
export function ResearchPrivateResult({ job }: { job: PrivateWorkspaceResult }) {
  const { creator, incoming } = job.spend;
  return <div className="mt-5 space-y-5">
    <h3 className="break-words font-display text-2xl">{job.request.question}</h3>
    <p role="status" className="font-serif"><UiText source={statuses[job.status]} /></p>
    {job.interruption && <p className="text-sm text-ink-3"><UiMessage messageKey={"privateReport.interruption"} values={{ recordedAt: job.interruption.recordedAt }} /></p>}
    <p className="text-sm"><UiMessage messageKey={"privateReport.packagePayment"} values={{ status: incoming.status, amount: formatSigningUsdc(incoming.priceMicros) }} /></p>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
      [copy("privateReport.cap"), creator.budgetMicros], [copy("privateReport.committed"), creator.committedMicros], [copy("privateReport.unresolved"), creator.unresolvedMicros],
      [copy("privateReport.processing"), creator.processingMicros], [copy("privateReport.confirmed"), creator.confirmedMicros], [copy("privateReport.uncommitted"), creator.uncommittedMicros],
    ] as const).map(([label, value]) => <div key={label} className="border border-line p-3"><dt className="font-mono text-xs text-ink-3">{label}</dt><dd className="mt-2 font-serif">{formatSigningUsdc(value)}</dd></div>)}</dl>
    <p className="text-xs text-ink-3"><UiMessage messageKey={"privateReport.budgetNotice"} /></p>
    {!!creator.payments.length && <details><summary className="cursor-pointer font-serif"><UiMessage messageKey={"privateReport.creatorEvidence"} /></summary><ul className="mt-3 space-y-3">{creator.payments.map((payment, i) => <li key={i} className="break-all border border-line p-3 text-sm">
      <p>{payment.kind} · {formatSigningUsdc(payment.amountMicros)} · {payment.status}</p><p><UiMessage messageKey={"privateReport.recipient"} values={{ payee: payment.payee }} /></p>
      {payment.reference && <p>{payment.evidenceSource}: {payment.reference}</p>}
    </li>)}</ul></details>}
    {job.result && <>
      <h4 className="font-display text-2xl"><UiMessage messageKey={"privateReport.answer"} /></h4>
      <p className="whitespace-pre-wrap break-words font-serif leading-relaxed">{job.result.answer}</p>
      {job.result.evidence === null ? <p className="text-sm text-ink-3"><UiMessage messageKey={"privateReport.evidenceUnavailable"} /></p>
        : !job.result.evidence.some(item => item.qualifiesForReward) && <p className="border-l-2 border-seal pl-3 text-sm"><UiMessage messageKey={"privateReport.noRewardEvidence"} /></p>}
      <h4 className="font-display text-2xl"><UiMessage messageKey={"privateReport.decisions"} /></h4>
      <ul className="space-y-3">{job.result.decisions.map((decision, i) => <li key={i} className="border border-line p-4">
        <p className="font-mono text-xs"><UiMessage messageKey={"privateReport.decision"} values={{ action: decision.action, source: decision.sourceName, price: formatRecordedAmount(decision.price, { minimumFractionDigits: 6 }) }} /></p>
        <p className="mt-2 break-words font-serif">{decision.rationale}</p>
      </li>)}</ul>
      {!!job.result.citations.length && <div><h4 className="font-display text-2xl"><UiMessage messageKey={"privateReport.attribution"} /></h4><ul className="mt-3 space-y-3">{job.result.citations.map((citation, i) => <li key={i} className="border border-line p-3 text-sm">
        <p><UiMessage messageKey={"privateReport.contribution"} values={{ marker: citation.marker, source: citation.sourceName, weight: formatNumber((citation.weight * 100), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} /></p><p>{citation.rationale}</p>
        <p><UiMessage messageKey={"privateReport.reward"} values={{ amount: formatRecordedAmount(citation.recordedRewardUsdc, { minimumFractionDigits: 6 }) }} /></p>
      </li>)}</ul></div>}
      {!!job.result.claimCoverage?.length && <div><h4 className="font-display text-2xl"><UiMessage messageKey={"privateReport.claimEvidence"} /></h4><ol className="mt-3 space-y-3">{job.result.claimCoverage.map((claim, i) => <li key={i} className="border border-line p-4">
        <p className="font-serif">{claim.claim}</p><p className="mt-2 text-xs"><UiMessage messageKey={"privateReport.coverage"} values={{ coverage: formatNumber((claim.coverage * 100), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} /></p>
        {job.result!.evidence?.filter(item => item.claimIndex === claim.claimIndex).map((item, j) => <blockquote key={j} className="mt-3 border-l border-line pl-3 font-serif text-sm"><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">“{item.quote}”</p><cite>{item.sourceName}</cite></blockquote>)}
      </li>)}</ol></div>}
      <p className="text-xs text-ink-3"><UiMessage messageKey={"privateReport.receiptNotice"} /></p>
    </>}
  </div>;
}
