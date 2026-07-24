/**
 * One answer card in the archive — shared by the main archive and every topic page so the two
 * surfaces can never drift apart. Server component: the card's text is the thing crawlers read,
 * and the client-side filter matches against exactly this rendered text.
 */

import Link from "next/link";
import type { ArchiveEntry } from "@/lib/answers-archive";
import { ConfidenceBadge } from "./confidence-badge";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
              Dispatch
            </span>
            {entry.confidence ? <ConfidenceBadge confidence={entry.confidence} /> : null}
          </span>
          <time className="font-mono text-[10px] text-ink-3" dateTime={entry.createdAt}>
            {fmtDate(entry.createdAt)}
          </time>
        </div>
        <h2 className="mt-2 font-display text-[19px] font-medium leading-snug text-ink transition-colors group-hover:text-seal">
          {entry.question}
        </h2>
        {entry.answerSnippet && (
          <p className="mt-2 font-serif text-[15px] leading-[1.5] text-ink-2">
            {entry.answerSnippet}
          </p>
        )}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          <span>
            {entry.citationCount} source{entry.citationCount !== 1 ? "s" : ""} cited
          </span>
          <span className="text-paid">${entry.toCreators.toFixed(4)} to creators</span>
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
