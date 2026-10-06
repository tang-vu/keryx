import Link from "next/link";
import { LIBRARY_KINDS, LIBRARY_TOPICS, libraryBrowseHref, type LibraryFilters } from "@/lib/sources/library-browse";

/** GET navigation keeps discovery shareable and usable before JavaScript loads. */
export function SourceLibraryFilters({ filters, total, matched, publishers }: {
  filters: LibraryFilters; total: number; matched: number; publishers: number;
}) {
  const active = !!filters.q || filters.topic !== "all" || filters.kind !== "all" || filters.sort !== "default";
  return <section id="browse-sources" aria-labelledby="browse-sources-title" className="mt-9 scroll-mt-6 border border-line bg-paper p-5 sm:p-6">
    <h2 id="browse-sources-title" className="font-display text-2xl text-ink">Find a source</h2>
    <form action="/sources#browse-sources" method="get" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="sm:col-span-2 lg:col-span-4">
        <span className="font-mono text-[11px] text-ink-2">Search titles, publishers, domains or tags</span>
        <input type="search" name="q" maxLength={120} defaultValue={filters.q} placeholder="Try PostgreSQL, agents or circle.com" className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 font-serif text-base text-ink" />
      </label>
      <div><label htmlFor="source-topic" className="font-mono text-[11px] text-ink-2">Topic</label>
        <select id="source-topic" name="topic" defaultValue={filters.topic} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-2 text-sm text-ink">
          <option value="all">All topics</option>{Object.entries(LIBRARY_TOPICS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div><label htmlFor="source-collection" className="font-mono text-[11px] text-ink-2">Collection</label>
        <select id="source-collection" name="kind" defaultValue={filters.kind} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-2 text-sm text-ink">
          <option value="all">All collections</option>{Object.entries(LIBRARY_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div><label htmlFor="source-sort" className="font-mono text-[11px] text-ink-2">Sort</label>
        <select id="source-sort" name="sort" defaultValue={filters.sort} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-2 text-sm text-ink">
          <option value="default">Collection order</option><option value="name">Name A–Z</option><option value="recent">Latest recorded observation</option>
        </select>
      </div>
      <button type="submit" className="mt-auto min-h-11 border border-ink bg-seal px-4 py-2 font-mono text-xs text-paper hover:bg-ink">Find sources</button>
    </form>
    <nav aria-label="Browse source topics" className="mt-4 flex flex-wrap gap-2">
      {Object.entries(LIBRARY_TOPICS).filter(([value]) => value !== "other").map(([value, label]) => <Link key={value}
        href={libraryBrowseHref(filters, { topic: value as LibraryFilters["topic"] })} aria-current={filters.topic === value ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border px-3 py-2 font-mono text-[11px] ${filters.topic === value ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink"}`}>{label}</Link>)}
    </nav>
    <p role="status" className="mt-4 font-serif text-sm text-ink-2">{matched} of {total} available records · {publishers} publisher domain group{publishers === 1 ? "" : "s"} in these results.
      {active && <> <Link href="/sources#browse-sources" className="inline-flex min-h-11 items-center text-seal underline underline-offset-4">Clear filters</Link></>}
    </p>
    <p className="mt-1 font-serif text-xs leading-relaxed text-ink-3">Topics use catalog tags and document metadata. Domain groups indicate breadth; they do not verify publisher control. Dates sort recorded citations, feed collections and listings; directory links have no reading date.</p>
  </section>;
}
