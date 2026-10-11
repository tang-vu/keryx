import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
/**
 * "From the archive" — the related-answers block at the foot of a dispatch
 * permalink. Server-rendered links between answer pages turn the archive from
 * a set of leaf pages into a walkable mesh: crawlers discover the corpus by
 * following these, and a reader landing from search gets a next question to pull.
 */

import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import type { ArchiveEntry } from "@/lib/answers-archive";

const copy = createMessages("en");

function fmtDate(iso: string) {
  return <DisplayTime value={iso} dateOnly />;
}

export function RelatedDispatches({ entries }: { entries: ArchiveEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-label={copy("relatedReports.label")} className="mt-14 border-t border-ink pt-8">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-seal">
        {copy("relatedReports.kicker")}
      </div>
      <h2 className="font-display text-[22px] font-medium tracking-tight text-ink">
        {copy("relatedReports.label")}
      </h2>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {entries.map((e) => (
          <Link
            key={e.id}
            href={`/dispatch/${e.id}`}
            className="group block min-w-0 border border-ink bg-paper p-4 [overflow-wrap:anywhere] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-seal">
                {copy(e.archivedNetwork ? "archiveReport.historicalDispatch" : "archiveReport.dispatch")}
              </span>
              <span className="font-mono text-[9.5px] text-ink-3">
                {fmtDate(e.createdAt)}
              </span>
            </div>
            <div className="mt-1.5 font-display text-[16px] font-medium leading-snug text-ink transition-colors group-hover:text-seal">
              {e.question}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
              <span>
                {copy(selectPlural(e.citationCount) === "one" ? "report.citedSources.one" : "report.citedSources.other", { count: e.citationCount })}
              </span>
              <span className="text-paid">{copy("archiveReport.creatorRewards", { amount: formatRecordedUsdc(e.toCreators, { minimumFractionDigits: 4, denomination: e.archivedNetwork ? "test USDC" : "$" }) })}</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-5">
        <Link
          href="/answers"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 underline decoration-ink-3 underline-offset-4 transition-colors hover:text-ink"
        >
          {copy("relatedReports.browse")}
        </Link>
      </div>
    </section>
  );
}
