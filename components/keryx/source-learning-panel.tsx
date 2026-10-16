import { createMessages } from "@/lib/i18n/messages";
import { formatLocalizedDate, formatLocalizedNumber, formatLocalizedUsdc } from "@/lib/i18n/format";
import type { SourceLearningReport } from "@/lib/research/source-learning-contract";
import { UiAttributes, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");
export function SourceLearningPanel({ report, sourceId }: { report: SourceLearningReport | null; sourceId: string }) {
  return <UiAttributes names={["aria-label"]}><section className="mb-8 border border-line bg-paper p-4" aria-label={copy("sourceLearning.title")}>
    <h2 className="font-display text-xl"><UiMessage messageKey={"sourceLearning.title"} /></h2>
    {!report ? <p className="mt-2 text-sm text-ink-2"><UiMessage messageKey={"sourceLearning.unavailable"} /></p> : <>
      <p className="mt-2 max-w-[80ch] text-sm text-ink-2"><UiMessage messageKey={"sourceLearning.boundary"} /></p>
      <p className="mt-2 text-sm text-ink-2"><UiMessage messageKey={"sourceLearning.window"} values={{ scan: formatLocalizedNumber(report.scanLimit, "en"), sample: formatLocalizedNumber(report.sampleLimit, "en"),
        excluded: formatLocalizedNumber(report.excludedObservations, "en"), historical: formatLocalizedNumber(report.historicalUnclassifiedRuns, "en") }} /></p>
      {report.records.length === 0 ? <p className="mt-3 text-sm"><UiMessage messageKey={"sourceLearning.empty"} /></p> : <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm"><thead><tr className="border-b border-line">
          {(["topic", "offered", "read", "bought", "cited", "estimate", "contribution", "price"] as const).map(key => <th key={key} className="p-2 font-medium"><UiMessage messageKey={`sourceLearning.${key}`} /></th>)}
        </tr></thead><tbody>{report.records.map(r => <tr key={r.topic} className="border-b border-line">
          <td className="p-2">{r.topic}{r.firstObservedAt && r.lastObservedAt && <span className="block whitespace-nowrap text-xs text-ink-3">
            <UiMessage messageKey={"sourceLearning.period"} values={{ first: formatLocalizedDate(r.firstObservedAt, "en", "UTC")?.text ?? r.firstObservedAt,
              last: formatLocalizedDate(r.lastObservedAt, "en", "UTC")?.text ?? r.lastObservedAt }} /></span>}
            {r.shiftFlag && <span className="block text-xs text-seal"><UiMessage messageKey={"sourceLearning.shift"} /></span>}</td>
          {[r.offered, r.read, r.bought, r.cited].map((count, index) => <td key={index} className="p-2">{formatLocalizedNumber(count, "en")}</td>)}
          <td className="p-2">{r.smoothedCitationRate === null ? "—" : `${formatLocalizedNumber(r.smoothedCitationRate, "en")} (± ${formatLocalizedNumber(r.uncertainty!, "en")})`}</td>
          <td className="p-2">{r.averageContribution === null ? "—" : formatLocalizedNumber(r.averageContribution, "en")}</td>
          <td className="p-2 whitespace-nowrap">{r.bought ? `${formatLocalizedUsdc(r.averagePriceMicros.numerator, "en")} / ${formatLocalizedNumber(r.bought, "en")}` : "—"}</td>
        </tr>)}</tbody></table>
      </div>}
      <p className="mt-3 text-xs text-ink-3"><UiMessage messageKey={"sourceLearning.meaning"} /></p>
      <p className="mt-2 text-sm"><UiMessage messageKey={"sourceLearning.exploration"} /></p>
      <p className="mt-2 text-sm"><UiMessage messageKey={"sourceLearning.change"} /></p>
      <a className="mt-3 inline-block text-sm underline" href={`/api/source/${encodeURIComponent(sourceId)}/learning`}><UiMessage messageKey={"sourceLearning.api"} /></a>
    </>}
  </section></UiAttributes>;
}
