import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import Form from "next/form";
import { LIBRARY_KINDS, LIBRARY_TOPICS, libraryBrowseHref, type LibraryFilters } from "@/lib/sources/library-browse";
import { UiAttributes, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

/** GET navigation keeps discovery shareable and usable before JavaScript loads. */
export function SourceLibraryFilters({ filters, total, matched, publishers }: {
  filters: LibraryFilters; total: number; matched: number; publishers: number;
}) {
  const active = !!filters.q || filters.topic !== "all" || filters.kind !== "all" || filters.sort !== "default" || !!filters.author || !!filters.year || !!filters.doi;
  return <section id="browse-sources" aria-labelledby="browse-sources-title" className="mt-9 scroll-mt-6 border border-line bg-paper p-5 sm:p-6">
    <h2 id="browse-sources-title" className="font-display text-2xl text-ink"><UiMessage messageKey={"sourceFilter.title"} /></h2>
    <div key={JSON.stringify(filters)}><Form action="/sources#browse-sources" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="sm:col-span-2 lg:col-span-3">
        <span className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.search"} /></span>
        <UiAttributes names={["placeholder"]}><input type="search" name="q" maxLength={120} defaultValue={filters.q} placeholder={copy("sourceFilter.placeholder", { database: "PostgreSQL", domain: "circle.com" })} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 font-serif text-base text-ink" /></UiAttributes>
      </label>
      <div><label htmlFor="source-topic" className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.topic"} /></label>
        <select id="source-topic" name="topic" defaultValue={filters.topic} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-2 text-sm text-ink">
          <option value="all"><UiMessage messageKey={"sourceFilter.allTopics"} /></option>{Object.entries(LIBRARY_TOPICS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div><label htmlFor="source-collection" className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.collection"} /></label>
        <select id="source-collection" name="kind" defaultValue={filters.kind} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-2 text-sm text-ink">
          <option value="all"><UiMessage messageKey={"sourceFilter.allCollections"} /></option>{Object.entries(LIBRARY_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div><label htmlFor="source-sort" className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.sort"} /></label>
        <select id="source-sort" name="sort" defaultValue={filters.sort} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-2 text-sm text-ink">
          <option value="default"><UiMessage messageKey={"sourceFilter.collectionOrder"} /></option><option value="name"><UiMessage messageKey={"sourceFilter.nameOrder"} /></option><option value="recent"><UiMessage messageKey={"sourceFilter.latest"} /></option>
        </select>
      </div>
      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3 lg:col-span-3">
        <legend className="mb-2 font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.paperFilters"} /></legend>
        <label className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.author"} />
          <UiAttributes names={["placeholder"]}><input name="author" maxLength={120} defaultValue={filters.author ?? ""} placeholder={copy("sourceFilter.authorPlaceholder")} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 font-serif text-base text-ink" /></UiAttributes>
        </label>
        <label className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.year"} />
          <input name="year" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" defaultValue={filters.year ?? ""} placeholder="2024" className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 font-serif text-base text-ink" />
        </label>
        <label className="font-mono text-[11px] text-ink-2"><UiMessage messageKey={"sourceFilter.doi"} />
          <UiAttributes names={["placeholder"]}><input name="doi" maxLength={200} defaultValue={filters.doi ?? ""} placeholder={copy("sourceFilter.doiPlaceholder", { identifier: "10.…", url: "https://doi.org/…" })} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 font-serif text-base text-ink" /></UiAttributes>
        </label>
      </fieldset>
      <button type="submit" className="sm:col-span-2 lg:col-span-1 lg:col-start-3 mt-auto min-h-11 border border-ink bg-seal px-4 py-2 font-mono text-xs text-paper hover:bg-ink"><UiMessage messageKey={"sourceFilter.find"} /></button>
    </Form></div>
    <UiAttributes names={["aria-label"]}><nav aria-label={copy("sourceFilter.topicsLabel")} className="mt-4 flex flex-wrap gap-2">
      {Object.entries(LIBRARY_TOPICS).filter(([value]) => value !== "other").map(([value, label]) => <Link key={value}
        href={libraryBrowseHref(filters, { topic: value as LibraryFilters["topic"] })} aria-current={filters.topic === value ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border px-3 py-2 font-mono text-[11px] ${filters.topic === value ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink"}`}>{label}</Link>)}
    </nav></UiAttributes>
    <p role="status" className="mt-4 font-serif text-sm text-ink-2"><UiMessage messageKey={publishers === 1 ? "sourceFilter.summary.one" : "sourceFilter.summary.other"} values={{ matched, total, publishers }} />
      {active && <> <Link href="/sources#browse-sources" className="inline-flex min-h-11 items-center text-seal underline underline-offset-4"><UiMessage messageKey={"sourceFilter.clear"} /></Link></>}
    </p>
    <p className="mt-1 font-serif text-xs leading-relaxed text-ink-3"><UiMessage messageKey={"sourceFilter.notice"} /></p>
  </section>;
}
