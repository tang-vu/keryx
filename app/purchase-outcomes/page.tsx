import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { formatUsdcMicros } from "@/lib/display/recorded-usdc";
import { formatLocalizedNumber } from "@/lib/i18n/format";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { readPublicPurchaseAggregate, purchaseAggregateWindow } from "@/lib/research/purchase-outcome-aggregate-server";
import type { PurchaseAggregateColumn, PurchaseOutcomeAggregate } from "@/lib/research/purchase-outcome-aggregate";
import { purchaseAggregateMessages as copy } from "@/locales/en/purchase-outcome-aggregate";
import { UiText } from "@/lib/i18n/ui-copy";



export const dynamic = "force-dynamic";
export const metadata = { title: copy.metadataTitle, alternates: englishPublicAlternates("/purchase-outcomes") };

function message(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => String(values[name]));
}
const number = (value: number) => formatLocalizedNumber(value, "en");
const percent = (value: number | null) => value === null ? copy.unmeasured
  : message(copy.percent, { value: number(Math.round(value * 1000) / 10) });

/** Server-rendered public figures. No wallets, source reads, payments or client-side fetches. */
export default async function PurchaseOutcomesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  let view: PurchaseOutcomeAggregate | undefined, invalid = false;
  try { purchaseAggregateWindow(params); } catch { invalid = true; }
  if (!invalid) try { view = await readPublicPurchaseAggregate(params); } catch { /* figures withheld below */ }
  const money = (value: string) => formatUsdcMicros(value, { denomination: view?.network === "eip155:5042002" ? copy.testUsdc : copy.usdc });
  const scoredMoney = (column: PurchaseAggregateColumn, value: string) => column.scoredPurchases ? money(value) : copy.none;
  type Row = readonly [label: string, rule: string, value: (column: PurchaseAggregateColumn) => string];
  const rows: Row[] = view ? [
    [...copy.rows.windowRuns, column => number(column.windowRuns)],
    [...copy.rows.sampledRuns, column => column.sampleComplete ? number(column.sampledRuns)
      : message(copy.partialSample, { sampled: number(column.sampledRuns), total: number(column.windowRuns) })],
    [...copy.rows.sampleSpan, column => column.sampleFirstRunAt && column.sampleLastRunAt
      ? message(copy.sampleSpan, { first: column.sampleFirstRunAt, last: column.sampleLastRunAt }) : copy.none],
    [...copy.rows.unscorable, column => number(column.unscorableRuns)],
    [...copy.rows.basis, column => column.recordedDecisions
      ? message(copy.ratio, { part: number(column.decisionsWithBasis), whole: number(column.recordedDecisions) }) : copy.none],
    [...copy.rows.buys, column => number(column.recordedBuyDecisions)],
    [...copy.rows.unscoredBuys, column => number(column.unscoredBuyDecisions)],
    [...copy.rows.scored, column => number(column.scoredPurchases)],
    [...copy.rows.hitRate, column => column.hitRate === null ? copy.none
      : `${percent(column.hitRate)} (${message(copy.ratio, { part: number(column.citedPurchases), whole: number(column.scoredPurchases) })})`],
    [...copy.rows.uncited, column => scoredMoney(column, column.uncitedAccessMicros)],
    [...copy.rows.access, column => scoredMoney(column, column.settledAccessMicros)],
    [...copy.rows.rewards, column => scoredMoney(column, column.settledRewardMicros)],
    [...copy.rows.gap, column => column.calibrationGap === null ? copy.none : percent(column.calibrationGap)],
    [...copy.rows.missed, () => copy.unmeasured],
    [...copy.rows.perClaim, () => copy.unmeasured],
    [...copy.rows.questionType, () => copy.unmeasured],
  ] : [];
  const query = new URLSearchParams(params);
  return <div className="min-h-screen bg-paper-2"><SiteHeader /><main className="mx-auto max-w-6xl px-4 py-12 text-ink">
    <h1 className="font-display text-4xl"><UiText source={copy.title} namespaces={["purchase-outcome-aggregate"]} /></h1>
    <p className="mt-4 max-w-3xl"><UiText source={copy.introduction} namespaces={["purchase-outcome-aggregate"]} /></p>
    <p className="mt-3 max-w-3xl text-sm text-ink-2"><UiText source={copy.recordedOnly} namespaces={["purchase-outcome-aggregate"]} /></p>
    <form method="get" className="my-6 flex flex-wrap items-end gap-4">
      <div><label htmlFor="purchase-outcomes-network"><UiText source={copy.network} namespaces={["purchase-outcome-aggregate"]} /></label><select id="purchase-outcomes-network" name="network" defaultValue={params.get("network") ?? view?.network ?? "eip155:5042"} className="block border border-line p-2"><option value="eip155:5042"><UiText source={copy.mainnet} namespaces={["purchase-outcome-aggregate"]} /></option><option value="eip155:5042002"><UiText source={copy.testnet} namespaces={["purchase-outcome-aggregate"]} /></option></select></div>
      <div><label htmlFor="purchase-outcomes-period"><UiText source={copy.period} namespaces={["purchase-outcome-aggregate"]} /></label><select id="purchase-outcomes-period" name="period" defaultValue={params.get("period") ?? "all"} className="block border border-line p-2"><option value="all"><UiText source={copy.all} namespaces={["purchase-outcome-aggregate"]} /></option><option value="7d"><UiText source={copy.week} namespaces={["purchase-outcome-aggregate"]} /></option><option value="30d"><UiText source={copy.month} namespaces={["purchase-outcome-aggregate"]} /></option></select></div>
      <div><label htmlFor="purchase-outcomes-since"><UiText source={copy.since} namespaces={["purchase-outcome-aggregate"]} /></label><input id="purchase-outcomes-since" type="date" name="since" defaultValue={params.get("since") ?? ""} className="block border border-line p-2" /></div>
      <button className="border border-line px-4 py-2"><UiText source={copy.apply} namespaces={["purchase-outcome-aggregate"]} /></button>
    </form>
    {!view ? <p role="status"><UiText source={invalid ? copy.invalid : copy.unavailable} namespaces={["purchase-outcome-aggregate"]} /></p> : <>
      <p className="mb-2 break-words font-mono text-sm">{view.network} · {view.period} · [{view.since}, {view.until}<UiText source={copy.windowEnd} namespaces={["purchase-outcome-aggregate"]} /></p>
      <p className="mb-4 max-w-3xl text-sm"><UiText source={message(copy.sample, { limit: view.sampleLimitPerCohort })} namespaces={["purchase-outcome-aggregate"]} /></p>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><caption className="mb-3 text-left"><UiText source={copy.cohortLimit} namespaces={["purchase-outcome-aggregate"]} /></caption>
        <thead><tr><th scope="col" className="p-3"><UiText source={copy.figure} namespaces={["purchase-outcome-aggregate"]} /></th>{view.columns.map(column => <th scope="col" className="p-3" key={column.cohort}><UiText source={copy[column.cohort]} namespaces={["purchase-outcome-aggregate"]} /></th>)}<th scope="col" className="p-3"><UiText source={copy.rule} namespaces={["purchase-outcome-aggregate"]} /></th></tr></thead>
        <tbody>{rows.map(([label, rule, value]) => <tr key={label} className="border-t border-line align-top"><th scope="row" className="p-3"><UiText source={label} namespaces={["purchase-outcome-aggregate"]} /></th>{view!.columns.map(column => <td key={column.cohort} className="p-3 font-mono">{value(column)}</td>)}<td className="max-w-sm p-3">{rule}</td></tr>)}</tbody>
      </table></div>
      <h2 className="mt-10 font-display text-2xl"><UiText source={copy.calibrationTitle} namespaces={["purchase-outcome-aggregate"]} /></h2>
      <p className="mt-2 max-w-3xl text-sm"><UiText source={copy.calibrationIntro} namespaces={["purchase-outcome-aggregate"]} /></p>
      {view.columns.map(column => <section key={column.cohort} className="mt-6">
        <h3 className="font-display text-lg"><UiText source={message(copy.calibrationFor, { cohort: copy[column.cohort], scored: number(column.scoredPurchases) })} namespaces={["purchase-outcome-aggregate"]} /></h3>
        {column.scoredPurchases > 0 && <div className="overflow-x-auto"><table className="mt-2 w-full max-w-3xl border-collapse text-left text-sm">
          <thead><tr>{[copy.band, copy.purchases, copy.cited, copy.predictedMean, copy.citationRate].map(label => <th scope="col" key={label} className="p-2 font-normal"><UiText source={label} namespaces={["purchase-outcome-aggregate"]} /></th>)}</tr></thead>
          <tbody>{column.calibration.map(band => <tr key={band.lower} className="border-t border-line">
            <th scope="row" className="p-2 font-mono font-normal">{`${percent(band.lower)}–${percent(band.upper)}`}</th>
            <td className="p-2 font-mono">{number(band.samples)}</td><td className="p-2 font-mono">{number(band.cited)}</td>
            <td className="p-2 font-mono"><UiText source={band.predictedMean === null ? copy.none : percent(band.predictedMean)} namespaces={["purchase-outcome-aggregate"]} /></td>
            <td className="p-2 font-mono"><UiText source={band.citationRate === null ? copy.none : percent(band.citationRate)} namespaces={["purchase-outcome-aggregate"]} /></td>
          </tr>)}</tbody>
        </table></div>}
      </section>)}
    </>}
    <div className="mt-8 flex flex-wrap gap-6"><a className="underline" href={`/api/purchase-outcomes?${query}`}><UiText source={copy.json} namespaces={["purchase-outcome-aggregate"]} /></a><Link className="underline" href="/usage"><UiText source={copy.usage} namespaces={["purchase-outcome-aggregate"]} /></Link></div>
  </main><SiteFooter /></div>;
}
