"use client";

/**
 * Instant filter over an archive list.
 *
 * The cards stay server-rendered — they are the corpus a crawler comes for, and re-rendering them
 * on the client would hide them from anyone (or anything) that doesn't run JS. So this component
 * takes the finished cards as `children` and, alongside them, one lowercase match string per card:
 * filtering is then a pure render, with no DOM reads and nothing to keep in sync.
 *
 * `others` is what keeps the filter honest once the archive is paginated. Only one page of cards is
 * rendered, but a reader typing "settlement" means the whole archive, not the sixty answers that
 * happen to be on screen. So every entry beyond this page comes down as a question and an id — a
 * fraction of a card's weight — and matches surface as compact links below the cards.
 *
 * With JavaScript off the box does nothing and the full page stays visible — the archive reads
 * exactly as it did before this existed.
 */

import { Children, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

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
  others = [],
  placeholder = "Filter these answers…",
}: {
  /** Lowercase searchable text per card, in the same order as `children`. */
  terms: string[];
  children: ReactNode;
  /** The rest of the archive, searchable but not rendered as cards. */
  others?: ArchiveSearchEntry[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const cards = Children.toArray(children);
  const matches = cards.map((_, i) => q === "" || (terms[i] ?? "").includes(q));
  const visible = matches.filter(Boolean).length;
  // Match text is derived here rather than shipped: the server already sends each question, and
  // sending a lowercase copy of it alongside would double the weight of the whole off-page index.
  const otherTerms = useMemo(
    () => others.map((o) => `${o.question} ${o.sources}`.toLowerCase()),
    [others],
  );
  // Only searched once the reader types — with an empty box this page shows its own cards, in order.
  const otherMatches = q === "" ? [] : others.filter((_, i) => otherTerms[i]!.includes(q));
  const total = q === "" ? cards.length : visible + otherMatches.length;

  return (
    <div className="mt-10">
      <label className="flex items-center gap-2.5 border border-ink bg-paper px-4 py-3">
        <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Filter answers"
          className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        {q !== "" && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            {total} found
          </span>
        )}
      </label>

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
            Elsewhere in the archive · {otherMatches.length}
          </h2>
          <ul className="space-y-2.5">
            {otherMatches.slice(0, OTHERS_SHOWN).map((o) => (
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
          {otherMatches.length > OTHERS_SHOWN && (
            <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              + {otherMatches.length - OTHERS_SHOWN} more — narrow the filter
            </p>
          )}
        </section>
      )}

      {q !== "" && total === 0 && (
        <p className="mt-6 border border-dashed border-line p-6 text-center font-serif text-[15px] text-ink-2">
          No answer in the archive matches “{query.trim()}” yet — ask it, and Keryx will pay the
          sources that answer it.
        </p>
      )}
    </div>
  );
}
