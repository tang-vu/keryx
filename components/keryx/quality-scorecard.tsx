import type { PublicQualityScorecard } from "@/lib/evals/public-quality-scorecard";
import type { FrozenQualitySnapshotId } from "@/lib/evals/frozen-public-quality-scorecards";
import { formatLocalizedDate, formatLocalizedNumber } from "@/lib/i18n/format";
import { qualityMessages as copy } from "@/locales/en/quality";
import { UiText } from "@/lib/i18n/ui-copy";



const number = (value: number) => formatLocalizedNumber(value, "en");
const rate = (value: number | null) => value === null ? copy.unknownRate : `${number(value * 100)}%`;
const linkClass = "text-paid underline underline-offset-4";

function Clock({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{formatLocalizedDate(value, "en", "UTC")?.text} · {value}</time>;
}
function Fingerprint({ label, value }: { label: string; value: string }) {
  return <div className="mt-2"><dt className="text-faint"><UiText source={label} /></dt><dd className="break-all font-mono text-xs">{value}</dd></div>;
}
function IssueLinks({ numbers }: { numbers: readonly number[] }) {
  return <span className="inline-flex flex-wrap gap-2">{numbers.map(n => <a key={n}
    className={linkClass} href={`https://github.com/tang-vu/keryx/issues/${n}`}>#{number(n)}</a>)}</span>;
}
function Groups({ title, rows }: { title: string; rows: (PublicQualityScorecard["overall"] & { label: string })[] }) {
  return <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm">
    <caption className="mb-2 text-left font-display text-xl">{title}</caption>
    <thead><tr className="border-b border-line">{[copy.group, copy.sample, copy.passes, copy.failures, copy.passRate, copy.usefulRate].map(label =>
      <th key={label} scope="col" className="p-2 font-medium"><UiText source={label} /></th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.label} className="border-b border-line">
      <th scope="row" className="p-2 font-normal">{row.label}</th>
      <td className="p-2">{number(row.cases)}</td><td className="p-2">{number(row.deterministicPasses)}</td>
      <td className="p-2">{number(row.deterministicFailures)}</td><td className="p-2">{rate(row.deterministicPassRate)}</td>
      <td className="p-2"><UiText source={copy.unknownRate} namespaces={["quality"]} /></td>
    </tr>)}</tbody>
  </table></div>;
}

export function QualityScorecard({ id, artifactSha256, scorecard: card }: {
  id: FrozenQualitySnapshotId; artifactSha256: string; scorecard: PublicQualityScorecard;
}) {
  return <article className="mt-6 border border-line bg-paper p-4 sm:p-6" aria-labelledby={id}>
    <h2 id={id} className="font-display text-2xl text-ink"><UiText source={copy.snapshots[id]} namespaces={["quality"]} /></h2>
    <dl className="mt-4 text-sm leading-relaxed">
      <dt><UiText source={copy.assessment} namespaces={["quality"]} /></dt><dd><Clock value={card.inspection.inspectedAt} /></dd>
      <Fingerprint label={copy.inspectorCommit} value={card.inspection.inspectorCommit} />
      <Fingerprint label={copy.artifactHash} value={artifactSha256} />
      <dt className="mt-2"><UiText source={copy.runtime} namespaces={["quality"]} /></dt><dd>{card.inspection.runtime}</dd>
    </dl>
    <h3 className="mt-6 font-display text-xl"><UiText source={copy.totals} namespaces={["quality"]} /></h3>
    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
      {[[copy.sample, number(card.overall.cases)], [copy.passes, number(card.overall.deterministicPasses)],
        [copy.failures, number(card.overall.deterministicFailures)], [copy.passRate, rate(card.overall.deterministicPassRate)],
        [copy.usefulRate, copy.unknownRate], [copy.semantic, copy.unjudged], [copy.language, copy.unjudged]].map(([label, value]) =>
        <div key={label} className="border border-line p-3"><dt className="text-sm text-ink-2"><UiText source={label} /></dt><dd className="mt-1 font-mono">{value}</dd></div>)}
    </dl>
    <p className="mt-4 text-sm text-ink-2"><UiText source={copy.allowance} namespaces={["quality"]} /></p>
    <Groups title={copy.byKind} rows={card.byKind.map(row => ({ ...row, label: copy.kinds[row.kind] }))} />
    <Groups title={copy.byLanguage} rows={card.byLanguage.map(row => ({ ...row, label: copy.languages[row.language] }))} />
    <p className="mt-3 text-sm text-ink-2"><UiText source={copy.groupLimit} namespaces={["quality"]} /></p>
    <h3 className="mt-6 font-display text-xl"><UiText source={copy.cases} namespaces={["quality"]} /></h3>
    <ul className="mt-3 space-y-4">{card.cases.map(row => <li key={row.id} className="border border-line p-4">
      <h4 className="font-mono text-sm">{row.id} · <UiText source={copy.kinds[row.kind]} namespaces={["quality"]} /> · <UiText source={copy.languages[row.requestedLanguage]} namespaces={["quality"]} /></h4>
      <p className="mt-2 text-sm"><UiText source={copy.failedChecks} namespaces={["quality"]} />: {row.failedChecks.map(name => copy.checks[name]).join(" · ")}</p>
      <p className="mt-2 text-sm"><UiText source={copy.issues} namespaces={["quality"]} />: <IssueLinks numbers={row.issues} /></p>
      <dl className="mt-3 text-sm"><dt><UiText source={copy.captured} namespaces={["quality"]} /></dt><dd><Clock value={row.capturedAt} /></dd>
        <Fingerprint label={copy.recordedCommit} value={row.recordedCommit} /></dl>
      <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">{row.checks.map(check => <div key={check.name}>
        <dt className="inline"><UiText source={copy.checks[check.name]} namespaces={["quality"]} />: </dt><dd className="inline font-mono">{check.status}</dd>
      </div>)}</dl>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-seal"><UiText source={copy.provenance} namespaces={["quality"]} /></summary><dl>
        <Fingerprint label={copy.fixtureHash} value={row.fixtureSha256} />
        <Fingerprint label={copy.rawHash} value={row.rawCaptureSha256} />
        {row.receipt && <><dt className="mt-2"><UiText source={copy.receiptCaptured} namespaces={["quality"]} /></dt><dd><Clock value={row.receipt.capturedAt} /></dd>
          <Fingerprint label={copy.receiptHash} value={row.receipt.rawCaptureSha256} />
          <Fingerprint label={copy.payloadHash} value={row.receipt.payloadSha256} /></>}
      </dl></details>
    </li>)}</ul>
    <details className="mt-6 text-sm"><summary className="cursor-pointer font-display text-xl"><UiText source={copy.historicalCoverage} namespaces={["quality"]} /></summary>
      <p className="mt-3"><UiText source={copy.coverageLimit} namespaces={["quality"]} /></p>
      <p className="mt-3"><UiText source={copy.coverageDate} namespaces={["quality"]} />: <Clock value={card.coverage.inventoryCapturedAt} /></p>
      <ul className="mt-3 space-y-3">{card.coverage.issues.map(row => <li key={row.number} className="border-t border-line pt-3">
        <IssueLinks numbers={[row.number]} />
        <p><UiText source={copy.requiredKinds} namespaces={["quality"]} />: {row.requiredKinds.map(k => copy.kinds[k]).join(" · ")}</p>
        <p><UiText source={copy.retainedCases} namespaces={["quality"]} />: {row.caseIds.join(" · ") || <UiText source={copy.none} namespaces={["quality"]} />}</p>
        <p><UiText source={copy.missingKinds} namespaces={["quality"]} />: {row.missingKinds.map(k => copy.kinds[k]).join(" · ") || copy.none}</p>
      </li>)}</ul>
    </details>
    <p className="mt-4 text-sm"><UiText source={copy.removals} namespaces={["quality"]} /></p>
    <details className="mt-4 text-sm"><summary className="cursor-pointer text-seal"><UiText source={copy.provenance} namespaces={["quality"]} /></summary><dl>
      <Fingerprint label={copy.inspectorHash} value={card.inspection.inspectorSourceSha256} />
      <Fingerprint label={copy.suiteHash} value={card.suiteDefinitionSha256} />
      <Fingerprint label={copy.corpusHash} value={card.corpusSha256} />
      <Fingerprint label={copy.captureHash} value={card.captureFingerprintSha256} />
      <Fingerprint label={copy.inventoryHash} value={card.inventorySha256} />
      <Fingerprint label={copy.coverageHash} value={card.coverageRegistrySha256} />
    </dl></details>
  </article>;
}
