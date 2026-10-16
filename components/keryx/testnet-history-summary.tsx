import Link from "next/link";
import { getTestnetArchive, type TestnetArchiveInfo, type TestnetArchiveSummary, type TestnetCreatorEntry } from "@/lib/history/testnet-archive";
import { TestnetHistorySummary } from "./testnet-history-view";


import { UiMessage, UiRichMessage } from "@/lib/i18n/ui-copy";






export { TestnetHistorySummary } from "./testnet-history-view";

export async function HistoricalHistorySection() {
  let data: { info: TestnetArchiveInfo; summary: TestnetArchiveSummary; creators: TestnetCreatorEntry[] | null } | null = null;
  let unavailable = false;
  try {
    const archive = await getTestnetArchive();
    if (archive) {
      const summary = await archive.summary();
      const creators = await archive.creatorLeaderboard().catch(() => null);
      data = { info: archive.info, summary, creators };
    }
  } catch { unavailable = true; }
  if (unavailable) return <section id="testnet-history" className="mt-8 border border-line p-5"><h2 className="font-display text-xl"><UiMessage messageKey={"historyObservation.title"} /></h2><p role="status" className="mt-2 text-sm"><UiRichMessage messageKey={"historyObservation.unavailable"} values={{ link: <Link href="/history/testnet" className="underline"><UiMessage messageKey={"historyObservation.openHistory"} /></Link> }} /></p></section>;
  return data ? <TestnetHistorySummary {...data} /> : null;
}
