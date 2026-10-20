"use client";

/**
 * Instant filter over an archive list.
 *
 * The cards stay server-rendered — they are the corpus a crawler comes for, and re-rendering them
 * on the client would hide them from anyone (or anything) that doesn't run JS. So this component
 * takes the finished cards as `children` and, alongside them, one match string per card:
 * filtering is then a pure render, with no DOM reads and nothing to keep in sync.
 *
 * `others` is what keeps the filter honest once the archive is paginated. Only one page of cards is
 * rendered, but a reader typing "settlement" means the whole archive, not the sixty answers that
 * happen to be on screen. So every entry beyond this page comes down as a question and an id — a
 * fraction of a card's weight — and matches surface as compact links below the cards, with
 * navigation through every matching result. Search words can appear in any order.
 *
 * With JavaScript off the box does nothing and the full page stays visible — the archive reads
 * exactly as it did before this existed.
 */
import { Children, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { archiveSearchWords, matchesArchiveSearch, normalizeArchiveSearch } from "@/lib/archive-search";

/** One entry that exists in the archive but isn't rendered as a card on this page. */
export interface ArchiveSearchEntry {
  id: string;
  question: string;
  /** The sources it cited, joined — the other half of what a card is searchable by. */
  sources: string;
}

const OTHERS_SHOWN = 25;

export function ArchiveSearch({
  terms,
  children,
  filters,
  others = [],
  placeholder,
}: {
  /** Searchable text per card, in the same order as `children`. */
  terms: string[];
  children: ReactNode;
  /** Server-rendered navigation shown between the search input and result cards. */
  filters?: ReactNode;
  /** The rest of the archive, searchable but not rendered as cards. */
  others?: ArchiveSearchEntry[];
  placeholder?: string;
}) {
  const copy = useUiMessages();
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [resultPage, setResultPage] = useState(0);
  const words = archiveSearchWords(query);
  const searching = words.length > 0;
  const cards = Children.toArray(children);
  const cardTerms = useMemo(() => terms.map(normalizeArchiveSearch), [terms]);
  const matches = cards.map((_, i) => matchesArchiveSearch(cardTerms[i] ?? "", words));
  const visible = matches.filter(Boolean).length;
  // Match text is derived here rather than shipped: the server already sends each question, and
  // sending a lowercase copy of it alongside would double the weight of the whole off-page index.
  const otherTerms = useMemo(
    () => others.map((o) => normalizeArchiveSearch(`${o.question} ${o.sources}`)),
    [others],
  );
  // Only searched once the reader types — with an empty box this page shows its own cards, in order.
  const otherMatches = searching ? others.filter((_, i) => matchesArchiveSearch(otherTerms[i]!, words)) : [];
  const total = searching ? visible + otherMatches.length : cards.length;
  const lastPage = Math.max(0, Math.ceil(otherMatches.length / OTHERS_SHOWN) - 1);
  const page = Math.min(resultPage, lastPage);
  const shownOthers = otherMatches.slice(page * OTHERS_SHOWN, (page + 1) * OTHERS_SHOWN);

  return (
    <div className="mt-10">
      <label className="flex items-center gap-2.5 border border-ink bg-paper px-4 py-3">
        <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setResultPage(0); }}
          placeholder={placeholder ?? copy("archiveFilter.placeholder")}
          aria-label={copy("archiveFilter.label")}
          className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <span role="status" aria-atomic="true" className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {searching && copy(total === 1 ? "archiveFilter.found.one" : "archiveFilter.found.other", { count: total })}
        </span>
      </label>

      {filters}

      <div className="mt-4 flex flex-col gap-4">
        {cards.map((card, i) => (
          <div key={i} hidden={!matches[i]}>
            {card}
          </div>
        ))}
      </div>

      {otherMatches.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
            {copy(otherMatches.length === 1 ? "archiveFilter.elsewhere.one" : "archiveFilter.elsewhere.other", { count: otherMatches.length })}
          </h2>
          <ul id={resultsId} className="space-y-2.5">
            {shownOthers.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/dispatch/${o.id}`}
                  className="font-serif text-[15px] leading-[1.5] text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                >
                  {o.question}
                </Link>
              </li>
            ))}
          </ul>
          {lastPage > 0 && (
            <nav aria-label={copy(otherMatches.length === 1 ? "archiveFilter.elsewhere.one" : "archiveFilter.elsewhere.other", { count: otherMatches.length })}
              className="mt-4 flex gap-3 font-mono text-[11px]">
              <button type="button" aria-controls={resultsId} disabled={page === 0}
                onClick={() => setResultPage(page - 1)}
                className="border border-line px-4 py-3 disabled:opacity-40">
                {copy("archivePages.newer")}
              </button>
              <button type="button" aria-controls={resultsId} disabled={page === lastPage}
                onClick={() => setResultPage(page + 1)}
                className="border border-line px-4 py-3 disabled:opacity-40">
                {copy("archivePages.older")}
              </button>
            </nav>
          )}
        </section>
      )}

      {searching && total === 0 && (
        <p className="mt-6 border border-dashed border-line p-6 text-center font-serif text-[15px] text-ink-2">
          {copy("archiveFilter.empty", { query: query.trim() })}
        </p>
      )}
    </div>
  );
}
