import type { PublicQualityScorecard } from "@/lib/evals/public-quality-scorecard";
import type { FrozenQualitySnapshotId } from "@/lib/evals/frozen-public-quality-scorecards";
import { formatLocalizedDate, formatLocalizedNumber } from "@/lib/i18n/format";
import { qualityMessages as copy } from "@/locales/en/quality";

const number = (value: number) => formatLocalizedNumber(value, "en");
const rate = (value: number | null) => value === null ? copy.unknownRate : `${number(value * 100)}%`;
const linkClass = "text-paid underline underline-offset-4";

function Clock({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{formatLocalizedDate(value, "en", "UTC")?.text} · {value}</time>;
}
function Fingerprint({ label, value }: { label: string; value: string }) {
  return <div className="mt-2"><dt className="text-faint">{label}</dt><dd className="break-all font-mono text-xs">{value}</dd></div>;
}
function IssueLinks({ numbers }: { numbers: readonly number[] }) {
  return <span className="inline-flex flex-wrap gap-2">{numbers.map(n => <a key={n}
    className={linkClass} href={`https://github.com/tang-vu/keryx/issues/${n}`}>#{number(n)}</a>)}</span>;
}
function Groups({ title, rows }: { title: string; rows: (PublicQualityScorecard["overall"] & { label: string })[] }) {
  return <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm">
    <caption className="mb-2 text-left font-display text-xl">{title}</caption>
    <thead><tr className="border-b border-line">{[copy.group, copy.sample, copy.passes, copy.failures, copy.passRate, copy.usefulRate].map(label =>
      <th key={label} scope="col" className="p-2 font-medium">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.label} className="border-b border-line">
      <th scope="row" className="p-2 font-normal">{row.label}</th>
      <td className="p-2">{number(row.cases)}</td><td className="p-2">{number(row.deterministicPasses)}</td>
      <td className="p-2">{number(row.deterministicFailures)}</td><td className="p-2">{rate(row.deterministicPassRate)}</td>
      <td className="p-2">{copy.unknownRate}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function QualityScorecard({ id, artifactSha256, scorecard: card }: {
  id: FrozenQualitySnapshotId; artifactSha256: string; scorecard: PublicQualityScorecard;
}) {
  return <article className="mt-6 border border-line bg-paper p-4 sm:p-6" aria-labelledby={id}>
    <h2 id={id} className="font-display text-2xl text-ink">{copy.snapshots[id]}</h2>
    <dl className="mt-4 text-sm leading-relaxed">
      <dt>{copy.assessment}</dt><dd><Clock value={card.inspection.inspectedAt} /></dd>
      <Fingerprint label={copy.inspectorCommit} value={card.inspection.inspectorCommit} />
      <Fingerprint label={copy.artifactHash} value={artifactSha256} />
      <dt className="mt-2">{copy.runtime}</dt><dd>{card.inspection.runtime}</dd>
    </dl>
    <h3 className="mt-6 font-display text-xl">{copy.totals}</h3>
    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
      {[[copy.sample, number(card.overall.cases)], [copy.passes, number(card.overall.deterministicPasses)],
        [copy.failures, number(card.overall.deterministicFailures)], [copy.passRate, rate(card.overall.deterministicPassRate)],
        [copy.usefulRate, copy.unknownRate], [copy.semantic, copy.unjudged], [copy.language, copy.unjudged]].map(([label, value]) =>
        <div key={label} className="border border-line p-3"><dt className="text-sm text-ink-2">{label}</dt><dd className="mt-1 font-mono">{value}</dd></div>)}
    </dl>
    <p className="mt-4 text-sm text-ink-2">{copy.allowance}</p>
    <Groups title={copy.byKind} rows={card.byKind.map(row => ({ ...row, label: copy.kinds[row.kind] }))} />
    <Groups title={copy.byLanguage} rows={card.byLanguage.map(row => ({ ...row, label: copy.languages[row.language] }))} />
    <p className="mt-3 text-sm text-ink-2">{copy.groupLimit}</p>
    <h3 className="mt-6 font-display text-xl">{copy.cases}</h3>
    <ul className="mt-3 space-y-4">{card.cases.map(row => <li key={row.id} className="border border-line p-4">
      <h4 className="font-mono text-sm">{row.id} · {copy.kinds[row.kind]} · {copy.languages[row.requestedLanguage]}</h4>
      <p className="mt-2 text-sm">{copy.failedChecks}: {row.failedChecks.map(name => copy.checks[name]).join(" · ")}</p>
      <p className="mt-2 text-sm">{copy.issues}: <IssueLinks numbers={row.issues} /></p>
      <dl className="mt-3 text-sm"><dt>{copy.captured}</dt><dd><Clock value={row.capturedAt} /></dd>
        <Fingerprint label={copy.recordedCommit} value={row.recordedCommit} /></dl>
      <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">{row.checks.map(check => <div key={check.name}>
        <dt className="inline">{copy.checks[check.name]}: </dt><dd className="inline font-mono">{check.status}</dd>
      </div>)}</dl>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-seal">{copy.provenance}</summary><dl>
        <Fingerprint label={copy.fixtureHash} value={row.fixtureSha256} />
        <Fingerprint label={copy.rawHash} value={row.rawCaptureSha256} />
        {row.receipt && <><dt className="mt-2">{copy.receiptCaptured}</dt><dd><Clock value={row.receipt.capturedAt} /></dd>
          <Fingerprint label={copy.receiptHash} value={row.receipt.rawCaptureSha256} />
          <Fingerprint label={copy.payloadHash} value={row.receipt.payloadSha256} /></>}
      </dl></details>
    </li>)}</ul>
    <details className="mt-6 text-sm"><summary className="cursor-pointer font-display text-xl">{copy.historicalCoverage}</summary>
      <p className="mt-3">{copy.coverageLimit}</p>
      <p className="mt-3">{copy.coverageDate}: <Clock value={card.coverage.inventoryCapturedAt} /></p>
      <ul className="mt-3 space-y-3">{card.coverage.issues.map(row => <li key={row.number} className="border-t border-line pt-3">
        <IssueLinks numbers={[row.number]} />
        <p>{copy.requiredKinds}: {row.requiredKinds.map(k => copy.kinds[k]).join(" · ")}</p>
        <p>{copy.retainedCases}: {row.caseIds.join(" · ") || copy.none}</p>
        <p>{copy.missingKinds}: {row.missingKinds.map(k => copy.kinds[k]).join(" · ") || copy.none}</p>
      </li>)}</ul>
    </details>
    <p className="mt-4 text-sm">{copy.removals}</p>
    <details className="mt-4 text-sm"><summary className="cursor-pointer text-seal">{copy.provenance}</summary><dl>
      <Fingerprint label={copy.inspectorHash} value={card.inspection.inspectorSourceSha256} />
      <Fingerprint label={copy.suiteHash} value={card.suiteDefinitionSha256} />
      <Fingerprint label={copy.corpusHash} value={card.corpusSha256} />
      <Fingerprint label={copy.captureHash} value={card.captureFingerprintSha256} />
      <Fingerprint label={copy.inventoryHash} value={card.inventorySha256} />
      <Fingerprint label={copy.coverageHash} value={card.coverageRegistrySha256} />
    </dl></details>
  </article>;
}
