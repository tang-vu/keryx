import { formatAmount } from "@/lib/i18n/format";
import { SiteHeader } from "@/components/keryx/site-header";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { SiteFooter } from "@/components/keryx/site-footer";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { usageWindow, type PublicUsageSummary } from "@/lib/usage/contracts";
import { usageMessages as copy } from "@/locales/en/usage";
import Link from "next/link";
import { aboutStory } from "@/locales/en/about-story";
export const dynamic = "force-dynamic";
export const metadata = { title: copy.metadataTitle, alternates: englishPublicAlternates("/usage") };
function usdc(micros: string) { return formatAmount(micros, { denomination: "USDC", minimumFractionDigits: 6 }); }
export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  let view: PublicUsageSummary | undefined, invalid = false;
  try { const window = usageWindow(params, config.profile.networkId); const db = await getDb(); view = await db.publicUsage?.summary(window); }
  catch { try { usageWindow(params, config.profile.networkId); } catch { invalid = true; } }
  type Column = PublicUsageSummary["columns"][number];
  const rows = view ? [
    [...copy.rows.people, (c: Column) => c.people],
    [...copy.rows.runs, (c: Column) => c.researchRuns],
    [...copy.rows.paying, (c: Column) => c.payingRuns],
    [...copy.rows.independent, (c: Column) => c.independentPayingRuns],
    [...copy.rows.sponsored, (c: Column) => c.sponsoredPayingRuns],
    [...copy.rows.teamPaid, (c: Column) => c.teamFundedPayingRuns],
    [...copy.rows.unknownPaid, (c: Column) => c.unknownFundingPayingRuns],
    [...copy.rows.payments, (c: Column) => c.settledPayments],
    [...copy.rows.usdc, (c: Column) => usdc(c.settledMicros)],
    [...copy.rows.creators, (c: Column) => c.creatorsPaid],
    [...copy.rows.accepted, () => copy.unmeasured],
    [...copy.rows.latency, () => copy.unmeasured],
  ] as const : [];
  const query = new URLSearchParams(params); query.delete("cohort");
  return <div className="min-h-screen bg-paper-2"><SiteHeader /><main className="mx-auto max-w-6xl px-4 py-12 text-ink">
    <h1 className="font-display text-4xl">{copy.title}</h1><p className="mt-4 max-w-3xl">{copy.introduction}</p>
    <aside lang="en" aria-labelledby="usage-stories-title" className="mt-6 max-w-3xl border-l-2 border-paid bg-paper p-5">
      <h2 id="usage-stories-title" className="font-display text-xl">{aboutStory.usageTitle}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{aboutStory.usageBody}</p>
      <Link href="/about#in-practice" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-paid underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid">{aboutStory.usageLink}<span aria-hidden="true">→</span></Link>
    </aside>
    <form method="get" className="my-6 flex flex-wrap items-end gap-4">
      <label>{copy.network}<select name="network" defaultValue={params.get("network") ?? config.profile.networkId} className="block border border-line p-2"><option value="eip155:5042">{copy.mainnet}</option><option value="eip155:5042002">{copy.testnet}</option></select></label>
      <label>{copy.period}<select name="period" defaultValue={params.get("period") ?? "all"} className="block border border-line p-2"><option value="all">{copy.all}</option><option value="7d">{copy.week}</option><option value="30d">{copy.month}</option></select></label>
      <label>{copy.since}<input type="date" name="since" defaultValue={params.get("since") ?? ""} className="block border border-line p-2" /></label>
      <button className="border border-line px-4 py-2">{copy.apply}</button>
    </form>
    {!view ? <p role="status">{invalid ? copy.invalid : copy.unavailable}</p> : <>
      <p className="mb-4 font-mono text-sm">{view.network} · {view.period} · [{view.since}, {view.until}{copy.windowEnd}</p>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><caption className="mb-3 text-left">{copy.actorLimit}</caption>
        <thead><tr><th className="p-3">{copy.figure}</th>{view.columns.map(c => <th className="p-3" key={c.cohort}>{copy[c.cohort]}</th>)}<th className="p-3">{copy.rule}</th></tr></thead>
        <tbody>{rows.map(([label, rule, value]) => <tr key={label} className="border-t border-line"><th className="p-3">{label}</th>{view!.columns.map(c => <td key={c.cohort} className="p-3 font-mono">{value(c)}</td>)}<td className="max-w-sm p-3">{rule}</td></tr>)}</tbody>
      </table></div><p className="mt-4">{copy.fundingLimit}</p><p className="mt-3 text-sm">{view.networkRule}. {copy.unattributed}: {view.unattributedNetworkRuns}. {view.historicalRule}.</p>
    </>}
    <div className="mt-6 flex flex-wrap gap-6"><a className="underline" href={`/api/usage?${query}`}>{copy.json}</a><a className="underline" href={`/api/runs?${query}&cohort=outside`}>{copy.history}</a></div>
  </main><SiteFooter /></div>;
}
