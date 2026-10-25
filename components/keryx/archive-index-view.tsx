/**
 * The body of the answer archive index, shared by /answers and /answers/page/[n].
 *
 * Both routes render the identical document apart from which slice of the corpus they carry, so
 * the markup lives here once: a page-2 visitor (or crawler) sees the same headline, the same topic
 * chips and the same filter as someone landing on the index, and the two can't drift apart.
 */

import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import type { ArchiveEntry } from "@/lib/answers-archive";
import { searchTerm } from "@/lib/answers-archive";
import type { ArchivePage } from "@/lib/answers-pagination";
import type { ArchiveTopic } from "@/lib/answers-topics";
import { ArchiveAnswerRow } from "./archive-answer-row";
import { ArchiveSearch } from "./archive-search";
import { ArchivePagination } from "./archive-pagination";
import { ArchiveTopicChips } from "./archive-topic-chips";
import { ProductEntryNote } from "./product-guide";
import { ArchiveLanguageFilter } from "./archive-language-filter";
import { UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");


export function ArchiveIndexView({
  slice,
  topics,
  totalEntries,
  languages = [],
  language = null,
}: {
  slice: ArchivePage;
  topics: ArchiveTopic[];
  /** Size of the whole archive, not this page — the headline counts the corpus. */
  totalEntries: number;
  languages?: Array<{ language: string; count: number }>;
  language?: string | null;
}) {
  return (
    <main className="mx-auto max-w-[860px] px-4 pb-20 pt-12 sm:px-[30px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          {slice.page > 1 ? <UiMessage messageKey={"archiveIndex.page"} values={{ page: slice.page, pages: slice.totalPages }} /> : <UiMessage messageKey={"archiveIndex.kicker"} />}
        </span>
        <a
          href={language ? `/answers/feed.xml?${new URLSearchParams({ language })}` : "/answers/feed.xml"}
          className="inline-flex min-h-11 items-center font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 underline decoration-dotted underline-offset-4 transition-colors hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal"
        >
          <UiMessage messageKey={"archiveIndex.feed"} />
        </a>
      </div>
      <h1 className="font-display text-[clamp(36px,7vw,64px)] font-medium leading-[1.04] tracking-[-0.025em] text-ink">
        <UiRichMessage messageKey={"archiveIndex.title"} values={{ emphasis: <em className="italic text-paid"><UiMessage messageKey={"archiveIndex.emphasis"} /></em> }} />
      </h1>
      <p className="mt-5 max-w-[62ch] font-serif text-[17px] leading-relaxed text-ink-2 sm:text-lg">
        {totalEntries > 0 ? (
          <>
            <UiMessage messageKey={totalEntries === 1 ? "archiveIndex.summary.one" : "archiveIndex.summary.other"} values={{ count: totalEntries }} />
          </>
        ) : (
          <><UiMessage messageKey={"archiveIndex.empty"} /></>
        )}
      </p>
      <Link href="/history/testnet" className="mt-2 inline-flex min-h-11 items-center text-sm text-seal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal"><UiMessage messageKey={"archiveIndex.testnet"} /></Link>
      <ArchiveLanguageFilter languages={languages} selected={language} />

      {slice.items.length > 0 && (
        <ArchiveSearch
          terms={slice.items.map(searchTerm)}
          others={slice.rest.map(toSearchEntry)}
          filters={<ArchiveTopicChips topics={topics} />}
        >
          {slice.items.map((e) => (
            <ArchiveAnswerRow key={e.id} entry={e} />
          ))}
        </ArchiveSearch>
      )}

      <ArchivePagination page={slice.page} totalPages={slice.totalPages} language={language} />

      <div className="mt-10"><ProductEntryNote /></div>

      <div className="mt-12 border-t border-ink pt-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-[transform,box-shadow] duration-200 hover:shadow-[0_4px_0_var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal motion-safe:hover:-translate-y-0.5"
        >
          <UiMessage messageKey={"archiveIndex.ask"} />
        </Link>
      </div>
    </main>
  );
}

/** An off-page entry, trimmed to what the filter needs: something to match, something to link. */
function toSearchEntry(e: ArchiveEntry) {
  return { id: e.id, question: e.question, sources: e.sourceNames.join(" ") };
}
