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
import { UiText } from "@/lib/i18n/ui-copy";

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
    <h1 className="font-display text-4xl"><UiText source={copy.title} namespaces={["usage","about-story"]} /></h1><p className="mt-4 max-w-3xl"><UiText source={copy.introduction} namespaces={["usage","about-story"]} /></p>
    <aside lang="en" aria-labelledby="usage-stories-title" className="mt-6 max-w-3xl border-l-2 border-paid bg-paper p-5">
      <h2 id="usage-stories-title" className="font-display text-xl"><UiText source={aboutStory.usageTitle} namespaces={["usage","about-story"]} /></h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2"><UiText source={aboutStory.usageBody} namespaces={["usage","about-story"]} /></p>
      <Link href="/about#in-practice" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-paid underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid"><UiText source={aboutStory.usageLink} namespaces={["usage","about-story"]} /><span aria-hidden="true">→</span></Link>
    </aside>
    <form method="get" className="my-6 flex flex-wrap items-end gap-4">
      <label><UiText source={copy.network} namespaces={["usage","about-story"]} /><select name="network" defaultValue={params.get("network") ?? config.profile.networkId} className="block border border-line p-2"><option value="eip155:5042"><UiText plain source={copy.mainnet} namespaces={["usage","about-story"]} /></option><option value="eip155:5042002"><UiText plain source={copy.testnet} namespaces={["usage","about-story"]} /></option></select></label>
      <label><UiText source={copy.period} namespaces={["usage","about-story"]} /><select name="period" defaultValue={params.get("period") ?? "all"} className="block border border-line p-2"><option value="all"><UiText plain source={copy.all} namespaces={["usage","about-story"]} /></option><option value="7d"><UiText plain source={copy.week} namespaces={["usage","about-story"]} /></option><option value="30d"><UiText plain source={copy.month} namespaces={["usage","about-story"]} /></option></select></label>
      <label><UiText source={copy.since} namespaces={["usage","about-story"]} /><input type="date" name="since" defaultValue={params.get("since") ?? ""} className="block border border-line p-2" /></label>
      <button className="border border-line px-4 py-2"><UiText source={copy.apply} namespaces={["usage","about-story"]} /></button>
    </form>
    {!view ? <p role="status"><UiText source={invalid ? copy.invalid : copy.unavailable} /></p> : <>
      <p className="mb-4 font-mono text-sm">{view.network} · {view.period} · [{view.since}, {view.until}<UiText source={copy.windowEnd} namespaces={["usage","about-story"]} /></p>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><caption className="mb-3 text-left"><UiText source={copy.actorLimit} namespaces={["usage","about-story"]} /></caption>
        <thead><tr><th className="p-3"><UiText source={copy.figure} namespaces={["usage","about-story"]} /></th>{view.columns.map(c => <th className="p-3" key={c.cohort}><UiText source={copy[c.cohort]} namespaces={["usage","about-story"]} /></th>)}<th className="p-3"><UiText source={copy.rule} namespaces={["usage","about-story"]} /></th></tr></thead>
        <tbody>{rows.map(([label, rule, value]) => <tr key={label} className="border-t border-line"><th className="p-3">{label}</th>{view!.columns.map(c => <td key={c.cohort} className="p-3 font-mono">{value(c)}</td>)}<td className="max-w-sm p-3">{rule}</td></tr>)}</tbody>
      </table></div><p className="mt-4"><UiText source={copy.fundingLimit} namespaces={["usage","about-story"]} /></p><p className="mt-3 text-sm">{view.networkRule}. <UiText source={copy.unattributed} namespaces={["usage","about-story"]} />: {view.unattributedNetworkRuns}. {view.historicalRule}.</p>
    </>}
    <div className="mt-6 flex flex-wrap gap-6"><a className="underline" href={`/api/usage?${query}`}><UiText source={copy.json} namespaces={["usage","about-story"]} /></a><a className="underline" href={`/api/runs?${query}&cohort=outside`}><UiText source={copy.history} namespaces={["usage","about-story"]} /></a></div>
  </main><SiteFooter /></div>;
}
