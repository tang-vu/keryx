import Link from "next/link";
import type { PublicReference } from "@/lib/public-references/catalog";
import type { PublicReferencePage } from "@/lib/public-references/archive";
import { createMessages } from "@/lib/i18n/messages";
import { DisplayTime } from "./display-time";

const copy = createMessages("en");
export interface ArticleLibraryFilters {
  query: string;
  referenceId: string;
  cursor: string;
  sort: "recent" | "oldest" | "relevance";
}
export function parseArticleLibraryFilters(params: Record<string, string | string[] | undefined>): ArticleLibraryFilters {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : params[key]?.[0] ?? "";
  const sort = value("articleSort");
  return { query: value("articleQuery").trim().slice(0, 500), referenceId: value("publisher").slice(0, 100),
    cursor: value("articleCursor").slice(0, 4096), sort: sort === "oldest" || sort === "relevance" ? sort : "recent" };
}
function browseHref(filters: ArticleLibraryFilters, cursor = "") {
  const params = new URLSearchParams();
  if (filters.query) params.set("articleQuery", filters.query);
  if (filters.referenceId) params.set("publisher", filters.referenceId);
  if (filters.sort !== "recent") params.set("articleSort", filters.sort);
  if (cursor) params.set("articleCursor", cursor);
  return `/sources${params.size ? `?${params}` : ""}#article-library`;
}

/** Public article metadata is rendered server-side; whole bodies stay out of the browsing payload. */
export function PublicReferenceLibrary({ page, status, references, filters }: {
  page: PublicReferencePage | null;
  status: "ready" | "unavailable" | "unsupported";
  references: PublicReference[];
  filters: ArticleLibraryFilters;
}) {
  const publishers = new Map(references.map(reference => [reference.id, reference]));
  return <section id="article-library" aria-labelledby="article-library-title" className="mt-10 scroll-mt-6 border-t border-ink pt-6">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id="article-library-title" className="font-display text-2xl text-ink">{copy("sourceArchive.title")}</h2>
      {page && <span className="font-mono text-xs text-ink-3">{copy(filters.query
        ? page.total === 1 ? "sourceArchive.results.one" : "sourceArchive.results.other"
        : page.total === 1 ? "sourceArchive.total.one" : "sourceArchive.total.other", { count: page.total })}</span>}
    </div>
    <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">{copy("sourceArchive.description")}</p>
    <form action="/sources#article-library" method="get" className="mt-5 grid gap-3 border border-line bg-paper p-4 sm:grid-cols-[minmax(0,1fr)_180px_150px_auto]">
      <label className="block font-mono text-[11px] text-ink-3">{copy("sourceArchive.search")}
        <input name="articleQuery" defaultValue={filters.query} maxLength={500} placeholder={copy("sourceArchive.placeholder")}
          className="mt-1 block min-h-11 w-full border border-line bg-paper-2 px-3 font-serif text-sm text-ink" />
      </label>
      <label className="block font-mono text-[11px] text-ink-3">{copy("sourceArchive.publisher")}
        <select name="publisher" defaultValue={filters.referenceId} className="mt-1 min-h-11 w-full border border-line bg-paper-2 px-2 text-xs text-ink">
          <option value="">{copy("sourceArchive.all")}</option>
          {references.map(reference => <option key={reference.id} value={reference.id}>{reference.name}</option>)}
        </select>
      </label>
      <label className="block font-mono text-[11px] text-ink-3">{copy("sourceArchive.sort")}
        <select name="articleSort" defaultValue={filters.sort} className="mt-1 min-h-11 w-full border border-line bg-paper-2 px-2 text-xs text-ink">
          <option value="recent">{copy("sourceArchive.recent")}</option><option value="oldest">{copy("sourceArchive.oldest")}</option><option value="relevance">{copy("sourceArchive.relevance")}</option>
        </select>
      </label>
      <button className="min-h-11 self-end border border-ink bg-seal px-4 font-mono text-xs text-paper">{copy("sourceArchive.button")}</button>
    </form>
    {status !== "ready" ? <p role="status" className="mt-4 border border-line bg-paper p-5 font-serif text-sm text-ink-2">{copy(status === "unsupported" ? "sourceArchive.notEnabled" : "sourceArchive.unavailable")}</p>
      : !page?.items.length ? <p className="mt-4 font-serif text-sm text-ink-2">{copy("sourceArchive.empty")}</p>
      : <div className="mt-5 grid gap-4 md:grid-cols-2">{page.items.map(item => {
        const publisher = publishers.get(item.referenceId);
        const question = `Read ${item.link} and explain its main findings, limits and relevance.`;
        return <article key={`${item.referenceId}:${item.id}`} className="flex min-w-0 flex-col border border-line bg-paper p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-paid">{publisher?.name ?? new URL(item.link).hostname}</p>
          <h3 className="mt-2 font-display text-xl leading-snug text-ink"><a href={item.link} target="_blank" rel="noopener noreferrer" className="break-words hover:text-seal">{item.title}</a></h3>
          <p className="mt-2 font-mono text-[11px] text-ink-3">{item.publishedAt ? <DisplayTime value={item.publishedAt} dateOnly /> : copy("sourceArchive.publishedUnknown")}</p>
          <p className="mt-3 line-clamp-4 break-words font-serif text-sm leading-relaxed text-ink-2">{item.summary.slice(0, 600)}</p>
          <p className="mt-3 font-mono text-[10px] text-ink-3">{copy("sourceArchive.scope", { scope: copy(item.collectionKind === "article" ? "sourceArchive.article" : "sourceArchive.feed") })}</p>
          <div className="mt-auto flex flex-wrap gap-4 pt-4 font-mono text-[11px] text-seal">
            <a href={item.link} target="_blank" rel="noopener noreferrer" className="min-h-11 py-2 underline underline-offset-4">{copy("sourceArchive.open")} ↗</a>
            <Link href={`/?q=${encodeURIComponent(question)}`} className="min-h-11 py-2 underline underline-offset-4">{copy("sourceArchive.ask")} →</Link>
          </div>
        </article>;
      })}</div>}
    {page && (filters.cursor || page.nextCursor) && <nav aria-label={copy("sourceArchive.pages")} className="mt-5 flex flex-wrap gap-4 font-mono text-xs text-seal">
      {filters.cursor && <Link href={browseHref(filters)} className="min-h-11 border border-line bg-paper px-4 py-3">{copy("sourceArchive.start")}</Link>}
      {page.nextCursor && <Link href={browseHref(filters, page.nextCursor)} className="min-h-11 border border-line bg-paper px-4 py-3">{copy("sourceArchive.next")} →</Link>}
    </nav>}
  </section>;
}
