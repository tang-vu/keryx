"use client";

import { useId } from "react";
import { PAPER_REPOSITORIES } from "@/lib/papers/types";
import { SCREENING_STATES, type LiteratureEntry } from "@/lib/papers/literature-workspace";

/** Selection stays inspectable when screening filters hide the saved cards. */
export function LiteratureComparisonPreview({ entries, filter, savedQuestion, draft, onRemove }: {
  entries: Pick<LiteratureEntry, "paper" | "screening">[];
  filter: string;
  savedQuestion: string;
  draft: string;
  onRemove: (url: string) => void;
}) {
  const id = useId();
  if (!entries.length) return null;
  return <section aria-label="Comparison selection" className="mt-4 min-w-0">
    <h3 className="font-mono text-xs text-ink">Papers selected for comparison</h3>
    <ol className="mt-2 grid gap-3 sm:grid-cols-2">
      {entries.map(({ paper, screening }, index) => <li key={paper.url} className="min-w-0 border border-line bg-paper p-3">
        <div id={`${id}-${index}`}>
          <p className="font-mono text-xs text-ink-3">Paper {index + 1} · {SCREENING_STATES[screening]} · {PAPER_REPOSITORIES[paper.repository]}</p>
          <a href={paper.url} target="_blank" rel="noopener noreferrer" className="mt-2 block break-words font-serif text-sm text-seal underline">{paper.title}</a>
          {paper.arxivId && <p className="mt-1 font-mono text-xs text-ink-2">arXiv {paper.arxivId}</p>}
          <p className="mt-1 break-all font-mono text-xs text-ink-3">{paper.url}</p>
        </div>
        {filter !== "all" && screening !== filter && <p className="mt-2 font-serif text-xs text-ink-2">Outside the current screening filter; still selected.</p>}
        <button type="button" aria-label={`Remove paper ${index + 1} from comparison`} aria-describedby={`${id}-${index}`}
          className="mt-2 inline-flex min-h-11 items-center justify-center border border-line px-3 py-2 font-mono text-xs text-seal hover:border-ink"
          onClick={() => onRemove(paper.url)}>Remove from comparison</button>
      </li>)}
    </ol>
    <p className="mt-3 font-mono text-xs text-ink-3">Saved focus used in the draft</p>
    <p className="mt-1 whitespace-pre-wrap break-words font-serif text-sm text-ink-2">{savedQuestion.trim() || "No saved review focus. The draft uses the general comparison questions."}</p>
    {draft && <details className="mt-3 border-t border-line">
      <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-seal underline">Review prepared question</summary>
      <pre aria-label="Prepared comparison question" className="min-w-0 whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{draft}</pre>
    </details>}
  </section>;
}
