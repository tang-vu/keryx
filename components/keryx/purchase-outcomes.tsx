import copy from "@/locales/en/purchase-outcomes.json";
import { formatUsdcMicros } from "@/lib/display/recorded-usdc";
import type { RecordedPurchaseOutcomes } from "@/lib/research/purchase-outcomes-contract";

function message(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => String(values[name]));
}
const percent = (value: number | null) => value === null ? copy.unmeasured :
  new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(value);
const predicted = (value: number | null) => value === null ? copy.unmeasured :
  new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);

/** Server-rendered public observation. No wallets, source fetches or client-side sidecars. */
export function PurchaseOutcomesPanel({ dispatchId, report }: { dispatchId: string; report: RecordedPurchaseOutcomes | null }) {
  const path = `/api/dispatch/${encodeURIComponent(dispatchId)}/purchase-outcomes`;
  const money = (value: string) => formatUsdcMicros(value,
    { denomination: report?.network === "eip155:5042002" ? "test USDC" : "USDC" });
  return <section aria-label={copy.title} className="mt-8 max-w-[860px] border border-ink bg-paper px-5 py-5 sm:px-6">
    <h2 className="font-display text-[22px] font-semibold text-ink">{copy.title}</h2>
    {!report ? <p className="mt-3 font-serif text-sm leading-relaxed text-ink-2">{copy.unavailable}</p> : <>
      <p className="mt-2 font-serif text-sm leading-relaxed text-ink-2">{copy.intro}</p>
      <p className="mt-3 font-mono text-xs leading-relaxed text-paid">{copy.recordedOnly}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">{copy.partialTrace}</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-ink-3">{copy.network}</dt><dd className="break-all font-mono">{report.network}</dd></div>
        <div><dt className="text-ink-3">{copy.createdAt}</dt><dd className="break-all font-mono">{report.runCreatedAt}</dd></div>
      </dl>
      {report.archive && <details className="mt-3 break-words border border-line p-3 text-xs leading-relaxed">
        <summary className="cursor-pointer">{message(copy.archive, { capturedAt: report.archive.capturedAt })}</summary>
        <dl className="mt-2 space-y-2"><div><dt>{copy.archiveSource}</dt><dd className="break-all font-mono">{report.archive.sourceCommit}</dd></div>
          <div><dt>{copy.archiveDigest}</dt><dd className="break-all font-mono">{report.archive.databaseSha256}</dd></div></dl>
      </details>}
      <p className="mt-3 text-xs leading-relaxed text-ink-3">{copy.unknownCohort}</p>
      <p className="mt-4 text-sm leading-relaxed">{message(copy.counts, { scored: report.counts.scoredPurchases,
        buys: report.counts.recordedBuyDecisions, unscored: report.counts.unscoredBuyDecisions,
        excluded: report.counts.excludedPaymentObservations, payments: report.counts.tracePaymentObservations })}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">{copy.countingBasis}</p>
      <dl className="mt-4 grid gap-4 border-y border-line py-4 sm:grid-cols-2">
        <div><dt className="text-xs text-ink-3">{copy.citationHitRate}</dt><dd className="mt-1 font-mono text-xl">{percent(report.hitRate)}</dd>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">{report.hitRate === null ? copy.noSample :
            message(copy.hitRateBasis, { cited: report.counts.citedPurchases, scored: report.counts.scoredPurchases })}</p></div>
        <div><dt className="text-xs text-ink-3">{copy.uncitedCost}</dt><dd className="mt-1 break-words font-mono text-xl">{report.purchases.length ? money(report.uncitedAccessMicros) : copy.unmeasured}</dd>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">{copy.uncitedBasis}</p></div>
      </dl>
      <h3 className="mt-5 font-display text-lg">{copy.calibration}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">{copy.calibrationBasis}</p>
      <table className="mt-3 w-full table-fixed border-collapse text-left text-[11px] sm:text-xs">
        <thead><tr>{[copy.band, copy.samples, copy.predictedMean, copy.citationRate].map(label =>
          <th key={label} scope="col" className="break-words border-b border-line px-1 py-2 font-normal">{label}</th>)}</tr></thead>
        <tbody>{report.calibration.map(band => <tr key={band.lower}>
          <th scope="row" className="px-1 py-2 font-mono font-normal">{`${band.lower}–${band.upper}`}</th>
          <td className="px-1 py-2 font-mono">{band.samples}</td><td className="break-words px-1 py-2">{predicted(band.predictedMean)}</td>
          <td className="break-words px-1 py-2">{percent(band.citationRate)}</td>
        </tr>)}</tbody>
      </table>
      {report.purchases.length > 0 && <details className="mt-4 border border-line p-3 text-xs">
        <summary className="cursor-pointer">{copy.observations}</summary>
        <ul className="mt-3 space-y-4">{report.purchases.map(row => <li key={JSON.stringify([row.sourceId, row.itemId, row.contentVersion])}
          className="border-t border-line pt-3"><dl className="space-y-1.5">
          <div><dt className="text-ink-3">{copy.source}</dt><dd className="break-all font-mono">{row.sourceId}</dd></div>
          <div><dt className="text-ink-3">{copy.item}</dt><dd className="break-all font-mono">{row.itemId}</dd></div>
          <div><dt className="text-ink-3">{copy.version}</dt><dd className="break-all font-mono">{row.contentVersion}</dd></div>
          <div><dt className="text-ink-3">{copy.predicted}</dt><dd>{predicted(row.expectedValue)}</dd></div>
          <div><dt className="text-ink-3">{copy.access}</dt><dd>{money(row.settledAccessMicros)}</dd></div>
          <div><dt className="text-ink-3">{copy.reward}</dt><dd>{money(row.settledRewardMicros)}</dd></div>
          <div><dt className="text-ink-3">{copy.contribution}</dt><dd>{percent(row.contributionWeight)}</dd></div>
        </dl><p className="mt-2 font-mono text-paid">{row.cited ? copy.cited : copy.uncited}</p></li>)}</ul>
      </details>}
      <p className="mt-4 text-xs leading-relaxed text-ink-3">{copy.unknownMeasures}</p>
      <div className="mt-4 flex flex-wrap gap-3 text-xs underline">
        <a href={path} target="_blank" rel="noreferrer">{copy.viewJson}</a>
        <a href={`${path}?download=1`}>{copy.download}</a>
      </div>
    </>}
  </section>;
}
