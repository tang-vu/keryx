"use client";

/**
 * Instant filter over an archive list.
 *
 * The cards stay server-rendered — they are the corpus a crawler comes for, and re-rendering them
 * on the client would hide them from anyone (or anything) that doesn't run JS. So this component
 * takes the finished cards as `children` and, alongside them, one lowercase match string per card:
 * filtering is then a pure render, with no DOM reads and nothing to keep in sync.
 *
 * With JavaScript off the box does nothing and the full list stays visible — the archive reads
 * exactly as it did before this existed.
 */

import { Children, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

export function ArchiveSearch({
  terms,
  children,
  placeholder = "Filter these answers…",
}: {
  /** Lowercase searchable text per card, in the same order as `children`. */
  terms: string[];
  children: ReactNode;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const cards = Children.toArray(children);
  const matches = cards.map((_, i) => q === "" || (terms[i] ?? "").includes(q));
  const visible = matches.filter(Boolean).length;

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
            {visible}/{cards.length}
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

      {q !== "" && visible === 0 && (
        <p className="mt-6 border border-dashed border-line p-6 text-center font-serif text-[15px] text-ink-2">
          No answer in the archive matches “{query.trim()}” yet — ask it, and Keryx will pay the
          sources that answer it.
        </p>
      )}
    </div>
  );
}
