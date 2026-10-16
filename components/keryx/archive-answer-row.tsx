import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
/**
 * One answer card in the archive — shared by the main archive and every topic page so the two
 * surfaces can never drift apart. Server component: the card's text is the thing crawlers read,
 * and the client-side filter matches against exactly this rendered text.
 */


import Link from "next/link";
import type { ArchiveEntry } from "@/lib/answers-archive";
import { ConfidenceBadge } from "./confidence-badge";
import { archiveAnswerLanguage } from "@/lib/answers-language";
import { quotedOriginalParts } from "@/lib/i18n/quoted-originals";
import { UiMessage } from "@/lib/i18n/ui-copy";





function fmtDate(iso: string) {
  return <DisplayTime value={iso} dateOnly />;
}

export function ArchiveAnswerRow({ entry }: { entry: ArchiveEntry }) {
  return (
    <article>
      <Link
        href={`/dispatch/${entry.id}`}
        className="group block border border-ink bg-paper p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] sm:p-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <span className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-seal">
              <UiMessage messageKey={entry.archivedNetwork ? "archiveReport.historicalDispatch" : "archiveReport.dispatch"} />
            </span>
            {entry.confidence ? <ConfidenceBadge confidence={entry.confidence} /> : null}
          </span>
          <span className="font-mono text-[10px] text-ink-3">
            {fmtDate(entry.createdAt)}
          </span>
        </div>
        <h2 lang="und" className="mt-2 font-display text-[19px] font-medium leading-snug text-ink transition-colors group-hover:text-seal">
          {entry.question}
        </h2>
        {entry.answerSnippet && (
          <p lang={archiveAnswerLanguage(entry)} className="mt-2 font-serif text-[15px] leading-[1.5] text-ink-2">
            {quotedOriginalParts(entry.answerSnippet).map((part, i) => part.original ? <span key={i} lang="und">{part.text}</span> : part.text)}
          </p>
        )}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          <span>
            <UiMessage messageKey={selectPlural(entry.citationCount) === "one" ? "report.citedSources.one" : "report.citedSources.other"} values={{ count: entry.citationCount }} />
          </span>
          <span className="text-paid"><UiMessage messageKey={"archiveReport.creatorRewards"} values={{ amount: formatRecordedUsdc(entry.toCreators, { minimumFractionDigits: 4, denomination: entry.archivedNetwork ? "test USDC" : "$" }) }} /></span>
          {entry.sourceNames.length > 0 && (
            <span className="normal-case tracking-normal text-ink-3">
              {entry.sourceNames.slice(0, 4).join(" · ")}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}
