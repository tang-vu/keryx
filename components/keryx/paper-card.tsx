import Link from "next/link";
import { PAPER_REPOSITORIES, type PaperGroup, type PaperRecord } from "@/lib/papers/types";

function RecordDetails({ record }: { record: PaperRecord }) {
  return <div className="min-w-0 space-y-2 text-sm">
    <p className="break-words font-serif text-ink-2">{record.authors.join(", ") || "Contributors unavailable"}</p>
    {record.authorsTruncated && <p className="font-serif text-xs text-ink-3">Incomplete contributor list: {record.authors.length} of {record.authorCount} provider entries have names here.</p>}
    <p className="break-words font-mono text-[11px] text-ink-3">{[record.venue, record.publishedYear, record.arxivId && `arXiv ${record.arxivId}`, record.doi && `DOI ${record.doi}`].filter(Boolean).join(" · ")}</p>
    <a href={record.metadataUrl} target="_blank" rel="noopener noreferrer" className="inline-block min-h-11 py-2 font-mono text-[11px] text-seal underline">Metadata observed {record.metadataObservedAt.slice(0, 10)} · {PAPER_REPOSITORIES[record.repository]}</a>
  </div>;
}

/** An original record or PDF link is an unread destination, never delivered paper evidence. */
export function PaperCard({ group }: { group: PaperGroup }) {
  const record = group.record;
  return <article className="flex min-w-0 flex-col border border-line bg-paper p-5 sm:p-6">
    <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">Research paper · metadata only</p>
    <h3 className="mt-2 break-words font-display text-xl font-medium leading-snug text-ink"><a href={record.url} target="_blank" rel="noopener noreferrer" className="hover:text-seal">{record.title}</a></h3>
    <div className="mt-3"><RecordDetails record={record} /></div>
    <p className="mt-2 font-mono text-[11px] text-ink-3">{record.publicationKind === "preprint" ? "Preprint" : record.publicationKind === "conference-paper" ? "Conference paper" : record.publicationKind === "journal-article" ? "Journal article" : "Publication type unknown"} · Peer review unknown</p>
    <div className="mt-3 flex flex-wrap gap-x-4"><a href={record.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-mono text-[11px] text-seal underline">Open paper record ↗</a>
      {(record.links ?? []).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-mono text-[11px] text-seal underline">{link.label} ↗</a>)}
    </div>
    {group.records.length > 1 && <details className="mt-3 border-t border-line pt-2"><summary className="min-h-11 cursor-pointer py-2 font-mono text-[11px] text-seal underline">Inspect all {group.records.length} observed records</summary>
      <ul className="space-y-4">{group.records.map((alternative, index) => <li key={`${alternative.url}:${index}`} className="border-t border-line pt-3"><a href={alternative.url} target="_blank" rel="noopener noreferrer" className="break-words font-serif text-sm text-seal underline">{alternative.title}</a><RecordDetails record={alternative} /></li>)}</ul>
    </details>}
    <div className="mt-auto pt-4"><Link prefetch={false} href={`/?q=${encodeURIComponent(`Explain the research in ${record.url}, with citations to the original paper and explicit abstract-only or extraction limitations.`)}`} className="inline-block min-h-11 py-2 font-mono text-[11px] text-seal underline">Ask with this paper →</Link>
      <p className="font-serif text-xs leading-relaxed text-ink-3">Opens an editable question draft. Paper text has not been read here; abstract-only and bounded full-text reads are labelled when research runs.</p>
    </div>
  </article>;
}
