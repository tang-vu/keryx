/**
 * The body of the answer archive index, shared by /answers and /answers/page/[n].
 *
 * Both routes render the identical document apart from which slice of the corpus they carry, so
 * the markup lives here once: a page-2 visitor (or crawler) sees the same headline, the same topic
 * chips and the same filter as someone landing on the index, and the two can't drift apart.
 */

import Link from "next/link";
import type { ArchiveEntry } from "@/lib/answers-archive";
import { searchTerm } from "@/lib/answers-archive";
import type { ArchivePage } from "@/lib/answers-pagination";
import type { ArchiveTopic } from "@/lib/answers-topics";
import { ArchiveAnswerRow } from "./archive-answer-row";
import { ArchiveSearch } from "./archive-search";
import { ArchivePagination } from "./archive-pagination";
import { ArchiveTopicChips } from "./archive-topic-chips";

export function ArchiveIndexView({
  slice,
  topics,
  totalEntries,
  totalToCreators,
}: {
  slice: ArchivePage;
  topics: ArchiveTopic[];
  /** Size of the whole archive, not this page — the headline counts the corpus. */
  totalEntries: number;
  totalToCreators: number;
}) {
  return (
    <main className="mx-auto max-w-[860px] px-4 pb-20 pt-12 sm:px-[30px]">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          The archive
          {slice.page > 1 ? ` · page ${slice.page} of ${slice.totalPages}` : ""}
        </span>
        <a
          href="/answers/feed.xml"
          className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 underline decoration-dotted underline-offset-4 transition-colors hover:text-seal"
        >
          Atom feed ↗
        </a>
      </div>
      <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
        Every answer, <em className="italic text-paid">paid for.</em>
      </h1>
      <p className="mt-4 max-w-[62ch] font-serif text-[17px] leading-[1.55] text-ink-2">
        {totalEntries > 0 ? (
          <>
            {totalEntries} question{totalEntries !== 1 ? "s" : ""} the herald has answered — each
            grounded in cited sources and settled with a real micropayment to the writers it quoted.{" "}
            <span className="text-paid">${totalToCreators.toFixed(4)}</span> paid to creators across
            this archive.
          </>
        ) : (
          <>The archive is warming up — no settled dispatches to show yet.</>
        )}
      </p>

      <ArchiveTopicChips topics={topics} />

      {slice.items.length > 0 && (
        <ArchiveSearch
          terms={slice.items.map(searchTerm)}
          others={slice.rest.map(toSearchEntry)}
        >
          {slice.items.map((e) => (
            <ArchiveAnswerRow key={e.id} entry={e} />
          ))}
        </ArchiveSearch>
      )}

      <ArchivePagination page={slice.page} totalPages={slice.totalPages} />

      <div className="mt-12 border-t border-ink pt-6">
        <Link
          href="/"
          className="inline-block border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
        >
          Ask your own question ▸
        </Link>
      </div>
    </main>
  );
}

/** An off-page entry, trimmed to what the filter needs: something to match, something to link. */
function toSearchEntry(e: ArchiveEntry) {
  return { id: e.id, question: e.question, sources: e.sourceNames.join(" ") };
}
