import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import Form from "next/form";
import { LIBRARY_KINDS, LIBRARY_TOPICS, libraryBrowseHref, type LibraryFilters } from "@/lib/sources/library-browse";
import { UiElement, UiMessage, UiText } from "@/lib/i18n/ui-copy";
import { SourceLibraryInput } from "./source-library-input";



const copy = createMessages("en");

/** GET navigation keeps discovery shareable and usable before JavaScript loads. */
export function SourceLibraryFilters({ filters, total, matched, publishers }: {
  filters: LibraryFilters; total: number; matched: number; publishers: number;
}) {
  const active = !!filters.q || filters.topic !== "all" || filters.kind !== "all" || filters.sort !== "default" || !!filters.author || !!filters.year || !!filters.doi;
  const paperExpanded = filters.kind === "paper" || !!filters.author || !!filters.year || !!filters.doi;
  const fieldClass = "mt-2 block min-h-12 w-full min-w-0 max-w-full border border-line bg-paper-2 px-3 py-2 font-serif text-base normal-case tracking-normal text-ink focus-visible:border-brass focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";
  const labelClass = "font-mono text-[11px] uppercase leading-relaxed tracking-[0.06em] text-ink-2";
  return <section id="browse-sources" aria-labelledby="browse-sources-title" className="mt-9 scroll-mt-6 border border-line bg-paper p-5 [overflow-wrap:anywhere] sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <h2 id="browse-sources-title" className="font-display text-[30px] leading-tight text-ink"><UiMessage messageKey={"sourceFilter.title"} /></h2>
        <p role="status" className="mt-2 max-w-[65ch] font-serif text-sm leading-relaxed text-ink-3"><UiMessage messageKey={publishers === 1 ? "sourceFilter.summary.one" : "sourceFilter.summary.other"} values={{ matched, total, publishers }} /></p>
      </div>
      {active && <Link href="/sources#browse-sources" className="inline-flex min-h-11 shrink-0 items-center border border-line bg-paper-2 px-3 py-2 font-mono text-[11px] text-seal hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"><UiMessage messageKey={"sourceFilter.clear"} /></Link>}
    </header>
    <div key={JSON.stringify(filters)}><Form action="/sources#browse-sources" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="min-w-0 sm:col-span-2 lg:col-span-3">
        <span className={labelClass}><UiMessage messageKey={"sourceFilter.search"} /></span>
        <div className="relative">
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <SourceLibraryInput kind="query" defaultValue={filters.q} className={fieldClass + " pl-10"} />
        </div>
      </label>
      <div className="min-w-0"><label htmlFor="source-topic" className={labelClass}><UiMessage messageKey={"sourceFilter.topic"} /></label>
        <select id="source-topic" name="topic" defaultValue={filters.topic} className={fieldClass}>
          <option value="all"><UiMessage plain messageKey={"sourceFilter.allTopics"} /></option>{Object.entries(LIBRARY_TOPICS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="min-w-0"><label htmlFor="source-collection" className={labelClass}><UiMessage messageKey={"sourceFilter.collection"} /></label>
        <select id="source-collection" name="kind" defaultValue={filters.kind} className={fieldClass}>
          <option value="all"><UiMessage plain messageKey={"sourceFilter.allCollections"} /></option>{Object.entries(LIBRARY_KINDS).map(([value, label]) => <option key={value} value={value}><UiText plain namespaces={["source-directory"]} source={label} /></option>)}
        </select>
      </div>
      <div className="min-w-0"><label htmlFor="source-sort" className={labelClass}><UiMessage messageKey={"sourceFilter.sort"} /></label>
        <select id="source-sort" name="sort" defaultValue={filters.sort} className={fieldClass}>
          <option value="default"><UiMessage plain messageKey={"sourceFilter.collectionOrder"} /></option><option value="name"><UiMessage plain messageKey={"sourceFilter.nameOrder"} /></option><option value="recent"><UiMessage plain messageKey={"sourceFilter.latest"} /></option>
        </select>
      </div>
      <fieldset className="min-w-0 sm:col-span-2 lg:col-span-3">
        <legend className={"mb-3 max-w-full " + labelClass}><UiMessage messageKey={"sourceFilter.paperFilters"} /></legend>
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <label className={labelClass}><UiMessage messageKey={"sourceFilter.year"} />
            <input name="year" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" defaultValue={filters.year ?? ""} placeholder="2024" className={fieldClass} />
          </label>
          <details open={paperExpanded} className="group min-w-0 border border-line bg-paper-2 lg:col-span-2">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 font-mono text-[11px] uppercase leading-relaxed tracking-[0.06em] text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal [&::-webkit-details-marker]:hidden">
              <span><UiMessage messageKey={"sourceFilter.author"} />{" "}<span aria-hidden="true">·</span>{" "}<UiMessage messageKey={"sourceFilter.doi"} /></span>
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 7.5 5 5 5-5" /></svg>
            </summary>
            <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
              <label className={"min-w-0 " + labelClass}><UiMessage messageKey={"sourceFilter.author"} />
                <SourceLibraryInput kind="author" defaultValue={filters.author ?? ""} className={fieldClass} />
              </label>
              <label className={"min-w-0 " + labelClass}><UiMessage messageKey={"sourceFilter.doi"} />
                <SourceLibraryInput kind="doi" defaultValue={filters.doi ?? ""} className={fieldClass} />
              </label>
            </div>
          </details>
        </div>
      </fieldset>
      <button type="submit" className="mt-1 inline-flex min-h-12 items-center justify-between gap-3 border border-ink bg-ink px-4 py-3 font-mono text-xs text-paper transition-colors hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal sm:col-span-2 lg:col-span-1 lg:col-start-3"><UiMessage messageKey={"sourceFilter.find"} /><span aria-hidden="true" className="rtl:rotate-180">→</span></button>
    </Form></div>
    <UiElement as="nav" namespaces={["source-directory"]} names={["aria-label"]} attributes={{ "aria-label": copy("sourceFilter.topicsLabel"), "className": "mt-5 flex flex-wrap gap-2 border-t border-line pt-4" }}>
      {Object.entries(LIBRARY_TOPICS).filter(([value]) => value !== "other").map(([value, label]) => <Link key={value}
        href={libraryBrowseHref(filters, { topic: value as LibraryFilters["topic"] })} aria-current={filters.topic === value ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border px-3 py-2 font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal ${filters.topic === value ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2 hover:border-ink hover:bg-paper-2"}`}>{label}</Link>)}
    </UiElement>
    <p className="mt-3 font-serif text-[13px] leading-relaxed text-ink-3"><UiMessage messageKey={"sourceFilter.notice"} /></p>
  </section>;
}
