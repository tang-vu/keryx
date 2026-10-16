import { createMessages } from "@/lib/i18n/messages";

import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import Link from "next/link";
import { getTestnetArchive, type TestnetArchiveInfo, type TestnetArchiveSummary, type TestnetCreatorEntry } from "@/lib/history/testnet-archive";
import type { QueryRun } from "@/lib/types";
import { historyBefore, historyNext } from "@/lib/history/public-history";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { TestnetHistorySummary } from "@/components/keryx/testnet-history-summary";
import { UiElement, UiMessage, UiRichMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");


export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy("reportTestnetHistory.title"), description: copy("reportTestnetHistory.description"), alternates: englishPublicAlternates("/history/testnet") };

export default async function TestnetHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  let data: { info: TestnetArchiveInfo; runs: QueryRun[]; summary: TestnetArchiveSummary; creators: TestnetCreatorEntry[] | null } | null = null;
  try {
    const archive = await getTestnetArchive();
    if (!archive) throw new Error("Archive unavailable");
    const runs = await archive.listRecentQueries(51, historyBefore(params));
    const summary = await archive.summary();
    const creators = await archive.creatorLeaderboard().catch(() => null);
    data = { info: archive.info, runs, summary, creators };
  } catch { /* Render an explicit unavailable state without hiding it as empty history. */ }
  const content = data ? <>
      <TestnetHistorySummary info={data.info} summary={data.summary} creators={data.creators} expandedCreators />
      <p className="mt-6 text-sm text-ink-2"><UiMessage messageKey={"reportTestnetHistory.intro"} /></p>
      <ol className="mt-5 divide-y divide-line border border-line bg-paper">
        {data.runs.slice(0, 50).map(run => <li key={run.id} className="p-5">
          <Link href={`/dispatch/${encodeURIComponent(run.id)}`} className="font-serif text-lg text-ink underline-offset-4 hover:underline">{run.question}</Link>
          <p className="mt-2 font-mono text-xs text-ink-3"><time dateTime={run.createdAt}>{run.createdAt}</time> · <UiMessage messageKey={run.citations?.length === 1 ? "reportTestnetHistory.cited.one" : "reportTestnetHistory.cited.other"} values={{ count: run.citations?.length ?? 0 }} /></p>
        </li>)}
      </ol>
      {!data.runs.length && <p className="mt-5 text-sm"><UiMessage messageKey={"reportTestnetHistory.empty"} /></p>}
      <UiElement as="nav" names={["aria-label"]} attributes={{ "className": "mt-6 flex flex-wrap gap-6 text-sm text-seal", "aria-label": copy("reportTestnetHistory.pages") }}>
        {params.has("before") && <Link href="/history/testnet" className="underline"><UiMessage messageKey={"reportTestnetHistory.newest"} /></Link>}
        {data.runs.length > 50 && <Link href={`/history/testnet?${historyNext(data.runs[49])}`} className="underline"><UiMessage messageKey={"reportTestnetHistory.older"} /></Link>}
      </UiElement>
    </> : <p role="status" className="mt-6 text-sm"><UiRichMessage messageKey={"reportTestnetHistory.unavailable"} values={{ retry: <Link href="/history/testnet" className="underline"><UiMessage messageKey={"reportTestnetHistory.retry"} /></Link> }} /></p>;
  return <div className="min-h-screen bg-paper-2"><SiteHeader /><main className="mx-auto max-w-[980px] px-4 pb-20 pt-10 sm:px-[30px]">
    <Link href="/dashboard" className="text-sm text-seal underline"><UiMessage messageKey={"reportTestnetHistory.current"} /></Link>
    <h1 className="mt-5 font-display text-3xl text-ink"><UiMessage messageKey={"reportTestnetHistory.heading"} /></h1>
    {content}
  </main><SiteFooter /></div>;
}
