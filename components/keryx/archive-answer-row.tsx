import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
/**
 * One answer card in the archive — shared by the main archive and every topic page so the two
 * surfaces can never drift apart. Server component: the card's text is the thing crawlers read,
 * and the client-side filter matches against exactly this rendered text.
 */


import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
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
        className="group relative block min-w-0 border border-line bg-paper p-5 transition-[border-color,box-shadow,transform] duration-200 hover:border-brass hover:shadow-[0_12px_28px_-20px_rgba(27,23,18,0.45)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal motion-safe:hover:-translate-y-0.5 sm:p-7"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-seal">
              <UiMessage messageKey={entry.archivedNetwork ? "archiveReport.historicalDispatch" : "archiveReport.dispatch"} />
            </span>
            {entry.confidence ? <ConfidenceBadge confidence={entry.confidence} /> : null}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">
            {fmtDate(entry.createdAt)}
          </span>
        </div>
        <div className="mt-4 flex items-start gap-4">
          <h2 lang="und" className="min-w-0 flex-1 break-words font-display text-[23px] font-medium leading-[1.2] tracking-tight text-ink transition-colors group-hover:text-seal sm:text-[28px]">
            {entry.question}
          </h2>
          <ArrowUpRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-brass transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
        </div>
        {entry.answerSnippet && (
          <p lang={archiveAnswerLanguage(entry)} className="mt-3 max-w-[66ch] break-words font-serif text-base leading-relaxed text-ink-2">
            {quotedOriginalParts(entry.answerSnippet).map((part, i) => part.original ? <span key={i} lang="und">{part.text}</span> : part.text)}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          <span>
            <UiMessage messageKey={selectPlural(entry.citationCount) === "one" ? "report.citedSources.one" : "report.citedSources.other"} values={{ count: entry.citationCount }} />
          </span>
          <span className="text-paid"><UiMessage messageKey={"archiveReport.creatorRewards"} values={{ amount: formatRecordedUsdc(entry.toCreators, { minimumFractionDigits: 4, denomination: entry.archivedNetwork ? "test USDC" : "$" }) }} /></span>
          {entry.sourceNames.length > 0 && (
            <span className="min-w-0 break-words normal-case tracking-normal text-ink-3">
              {entry.sourceNames.slice(0, 4).join(" · ")}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}
