import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ExploreSource } from "@/lib/public-references/explore-catalog";
import { LIBRARY_TOPICS } from "@/lib/sources/library-browse";

/** Unread directory metadata never enters the reading or payment pipeline. */
export function ExploreSourceCard({ source }: { source: ExploreSource }) {
  const domain = new URL(source.url).hostname.replace(/^www\./, "");
  return <article className="flex min-w-0 flex-col border border-line bg-paper p-5 sm:p-6">
    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">Publisher directory · unread link</p>
    <h3 className="mt-2 font-display text-xl font-medium leading-snug text-ink"><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words hover:text-seal">{source.name}<ArrowUpRight aria-hidden="true" className="ml-1 inline h-4 w-4" /></a></h3>
    <p className="mt-1 break-words font-mono text-[11px] text-ink-3">{domain}</p>
    <p className="mt-3 font-serif text-sm leading-relaxed text-ink-2">{source.description}</p>
    <ul aria-label="Topics" className="mt-3 flex flex-wrap gap-1.5">{[LIBRARY_TOPICS[source.topic], ...source.tags].slice(0, 5).map(tag => <li key={tag} className="rounded border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{tag}</li>)}</ul>
    <div className="mt-auto pt-4"><Link href={`/?q=${encodeURIComponent(`Summarize the guidance in ${source.url}, with citations and evidence gaps clearly stated.`)}`} className="inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4">Ask with this source →</Link>
      <p className="font-serif text-xs leading-relaxed text-ink-3">Opens a question draft. Available content is read only after you submit; inclusion here creates no creator payment.</p>
    </div>
  </article>;
}
