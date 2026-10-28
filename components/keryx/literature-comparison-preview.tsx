"use client";


import { useId } from "react";
import { PAPER_REPOSITORIES } from "@/lib/papers/types";
import { SCREENING_STATES, type LiteratureEntry } from "@/lib/papers/literature-workspace";
import { UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";
import { literatureSearchCopy as searchEnglish } from "@/locales/en/literature-search";





/** Selection stays inspectable when search or screening hides the saved cards. */
export function LiteratureComparisonPreview({ entries, filter, savedQuestion, draft, onRemove }: {
  entries: (Pick<LiteratureEntry, "paper" | "screening"> & { matchesSearch?: boolean })[];
  filter: string;
  savedQuestion: string;
  draft: string;
  onRemove: (url: string) => void;
}) {
  const id = useId();
  if (!entries.length) return null;
  return <section aria-labelledby={`${id}-label`} className="mt-4 min-w-0">
    <span id={`${id}-label`} className="sr-only"><UiMessage messageKey="literatureComparison.label" /></span>
    <h3 className="font-mono text-xs text-ink"><UiMessage messageKey="literatureComparison.title" /></h3>
    <ol className="mt-2 grid gap-3 sm:grid-cols-2">
      {entries.map(({ paper, screening, matchesSearch }, index) => <li key={paper.url} className="min-w-0 border border-line bg-paper p-3">
        <div id={`${id}-${index}`}>
          <p className="font-mono text-xs text-ink-3"><UiRichMessage messageKey="literatureComparison.paper" values={{ number: index + 1,
            screening: <span lang="en">{SCREENING_STATES[screening]}</span>, repository: <span lang="en">{PAPER_REPOSITORIES[paper.repository]}</span> }} /></p>
          <a href={paper.url} target="_blank" rel="noopener noreferrer" className="mt-2 block break-words font-serif text-sm text-seal underline">{paper.title}</a>
          {paper.arxivId && <p className="mt-1 font-mono text-xs text-ink-2">arXiv {paper.arxivId}</p>}
          <p className="mt-1 break-all font-mono text-xs text-ink-3">{paper.url}</p>
        </div>
        {filter !== "all" && screening !== filter && <p className="mt-2 font-serif text-xs text-ink-2"><UiMessage messageKey="literatureComparison.outsideFilter" /></p>}
        {matchesSearch === false && <p className="mt-2 font-serif text-xs text-ink-2"><UiText source={searchEnglish.outsideSearch} namespaces={["literature-search"]} /></p>}
        <span id={`${id}-remove-${index}`} className="sr-only"><UiMessage messageKey="literatureComparison.removeLabel" values={{ number: index + 1 }} /></span>
        <button type="button" aria-labelledby={`${id}-remove-${index}`} aria-describedby={`${id}-${index}`}
          className="mt-2 inline-flex min-h-11 items-center justify-center border border-line px-3 py-2 font-mono text-xs text-seal hover:border-ink"
          onClick={() => onRemove(paper.url)}><UiMessage messageKey="literatureComparison.remove" /></button>
      </li>)}
    </ol>
    <p className="mt-3 font-mono text-xs text-ink-3"><UiMessage messageKey="literatureComparison.focus" /></p>
    <p className="mt-1 whitespace-pre-wrap break-words font-serif text-sm text-ink-2">{savedQuestion.trim() || <UiMessage messageKey="literatureComparison.noFocus" />}</p>
    {draft && <details className="mt-3 border-t border-line">
      <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-seal underline"><UiMessage messageKey="literatureComparison.reviewQuestion" /></summary>
      <span id={`${id}-prepared`} className="sr-only"><UiMessage messageKey="literatureComparison.preparedQuestion" /></span>
      <pre aria-labelledby={`${id}-prepared`} className="min-w-0 whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{draft}</pre>
    </details>}
  </section>;
}
