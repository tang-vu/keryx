"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createMessages } from "@/lib/i18n/messages";
import { fetchOperatorLedger } from "@/lib/operator-ledger/client";
import { formatLedgerMicros, type LedgerFunding, type LedgerLeg, type OperatorLedger } from "@/lib/operator-ledger/contracts";

const message = createMessages("en");
const fundings: LedgerFunding[] = ["browser", "treasury", "unknown", "offline"];
const fundingLabel = { browser: "jobLedger.browser", treasury: "jobLedger.treasury", unknown: "jobLedger.unknown", offline: "jobLedger.offline" } as const;
const kindLabel = { fetch: "jobLedger.access", citation: "jobLedger.reward", "operating-fee": "jobLedger.sponsoredFee" } as const;
const stateLabel: Record<LedgerLeg["state"], "jobLedger.settled" | "jobLedger.pending" | "jobLedger.failed" | "jobLedger.simulated" | "jobLedger.uncertain"> = {
  settled: "jobLedger.settled", pending: "jobLedger.pending", failed: "jobLedger.failed", simulated: "jobLedger.simulated", uncertain: "jobLedger.uncertain",
};
const coverageLabel = { "matched-finish-count": "jobLedger.coverageMatched", incomplete: "jobLedger.coverageIncomplete", unknown: "jobLedger.coverageUnknown" } as const;

export function OperatorLedgerView() {
  const [days, setDays] = useState(7), [attempt, setAttempt] = useState(0);
  const [ledger, setLedger] = useState<OperatorLedger | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetchOperatorLedger(window.location.origin, days, abort.signal).then(value => {
      if (!abort.signal.aborted) setLedger(value);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [days, attempt]);
  const data = ledger?.payload;
  const unknown = message("jobLedger.unknownValue");
  return <section className="space-y-6" aria-labelledby="public-job-ledger-title">
    <Link href="/operator" className="text-sm underline">{message("jobLedger.back")}</Link>
    <header className="space-y-3">
      <h1 id="public-job-ledger-title" className="font-serif text-3xl sm:text-4xl">{message("jobLedger.title")}</h1>
      <p className="max-w-3xl text-ink/80">{message("jobLedger.introduction")}</p>
      <p className="max-w-3xl text-sm text-ink/70">{message("jobLedger.boundary")}</p>
    </header>
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="ledger-days" className="text-sm">{message("jobLedger.window")}</label>
      <select id="ledger-days" value={days} onChange={event => { setLedger(null); setFailed(false); setDays(Number(event.target.value)); }} className="rounded border border-ink/20 bg-paper px-3 py-2">
        {[1, 7, 31].map(count => <option key={count} value={count}>{message("jobLedger.days", { count })}</option>)}
      </select>
      <button type="button" onClick={() => { setLedger(null); setFailed(false); setAttempt(value => value + 1); }} className="rounded border border-ink/20 px-3 py-2 text-sm">{message("jobLedger.retry")}</button>
      {data && <>
        <a href={`/api/operator/ledger?days=${days}&download=1`} className="text-sm underline">{message("jobLedger.exportJson")}</a>
        <a href={`/api/operator/ledger?days=${days}&format=csv`} className="text-sm underline">{message("jobLedger.exportCsv")}</a>
      </>}
    </div>
    {!data && <p role="status">{message(failed ? "jobLedger.unavailable" : "jobLedger.loading")}</p>}
    {data && <>
      <div className="space-y-2 rounded border border-ink/15 bg-paper p-4 text-sm">
        <p>{message("jobLedger.network", { network: data.network })}</p>
        <p>{message("jobLedger.captured", { startedAt: data.window.readStartedAt, completedAt: data.window.readCompletedAt, from: data.window.from })}</p>
        <p>{message("jobLedger.limits", { runs: data.scope.runLimit, payments: data.scope.paymentLimit })}</p>
        {(data.scope.runLimitReached || data.scope.paymentLimitReached) && <p>{message("jobLedger.limitReached")}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {fundings.map(funding => <div key={funding} className="space-y-3 rounded border border-ink/15 bg-paper p-4">
          <h2 className="font-semibold">{message(fundingLabel[funding])}</h2>
          <dl className="space-y-3 text-sm">
            <div><dt>{message("jobLedger.access")}</dt><dd className="break-words font-mono">{formatLedgerMicros(data.settledByFunding[funding].accessMicroUsdc)}</dd></div>
            <div><dt>{message("jobLedger.reward")}</dt><dd className="break-words font-mono">{formatLedgerMicros(data.settledByFunding[funding].rewardMicroUsdc)}</dd></div>
            <div><dt>{message("jobLedger.sponsoredFee")}</dt><dd className="break-words font-mono">{formatLedgerMicros(data.settledByFunding[funding].sponsoredFeeMicroUsdc)}</dd></div>
          </dl>
        </div>)}
      </div>
      <div className="space-y-2 text-sm text-ink/75">
        <p>{message("jobLedger.fundingBoundary")}</p>
        <p>{message("jobLedger.position", { amount: formatLedgerMicros(data.position.safeSpendMicroUsdc) })}</p>
        <p>{message("jobLedger.profit")}</p>
        <p>{message("jobLedger.balance", { debit: formatLedgerMicros(data.trialBalance.debitMicroUsdc), credit: formatLedgerMicros(data.trialBalance.creditMicroUsdc) })}</p>
        <p>{message("jobLedger.accounts")}</p>
      </div>
      <h2 className="font-serif text-2xl">{message("jobLedger.jobs")}</h2>
      {data.jobs.length === 0 && <p>{message("jobLedger.noJobs")}</p>}
      {data.jobs.map(job => <details key={job.id} className="rounded border border-ink/15 bg-paper p-4">
        <summary className="cursor-pointer break-words font-semibold">{message("jobLedger.job", { id: job.id })}</summary>
        <div className="mt-4 space-y-3 text-sm">
          <p>{message("jobLedger.created", { createdAt: job.createdAt })}</p>
          <p>{message(fundingLabel[job.funding])}</p>
          <p>{message("jobLedger.coverage", { coverage: message(coverageLabel[job.legCoverage]), count: job.expectedRecordedLegs ?? unknown })}</p>
          <p>{message("jobLedger.profit")}</p>
          <div className="flex flex-wrap gap-4"><Link prefetch={false} href={job.evidencePath} className="underline">{message("jobLedger.receipt")}</Link>
            <Link prefetch={false} href={job.decisionPath} className="underline">{message("jobLedger.decisions")}</Link></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead><tr className="border-b border-ink/15">
                <th className="p-2">{message("jobLedger.source")}</th><th className="p-2">{message("jobLedger.kind")}</th>
                <th className="p-2">{message("jobLedger.amount")}</th><th className="p-2">{message("jobLedger.state")}</th><th className="p-2">{message("jobLedger.reference")}</th>
              </tr></thead>
              <tbody>{job.legs.map(leg => <tr key={leg.id} className="border-b border-ink/10">
                <td className="max-w-40 break-words p-2 font-mono">{leg.sourceId ?? unknown}</td>
                <td className="p-2">{leg.kind ? message(kindLabel[leg.kind]) : unknown}</td>
                <td className="whitespace-nowrap p-2 font-mono">{leg.amountMicroUsdc === null ? unknown : formatLedgerMicros(leg.amountMicroUsdc)}</td>
                <td className="p-2">{message(stateLabel[leg.state])}{leg.reason && <p className="text-xs">{message("jobLedger.refusal", { reason: leg.reason })}</p>}</td>
                <td className="max-w-56 break-words p-2 font-mono">{leg.settlementReference ?? unknown}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      </details>)}
      <p className="text-sm text-ink/70">{message("jobLedger.referenceBoundary")}</p>
    </>}
  </section>;
}
