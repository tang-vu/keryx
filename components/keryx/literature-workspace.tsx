"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { PAPER_REPOSITORIES } from "@/lib/papers/types";
import { paperReferencesRis } from "@/lib/papers/reference-export";
import { changeLiteratureWorkspace, clearLiteratureWorkspace, replaceLiteratureWorkspace, useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { literatureComparisonDraft, literatureScreeningCsv, MAX_LITERATURE_BYTES, parseLiteratureWorkspace,
  SCREENING_STATES, serializeLiteratureWorkspace, type LiteratureEntry, type LiteratureWorkspace as Workspace } from "@/lib/papers/literature-workspace";

const field = "mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 py-2 font-serif text-base text-ink";
const button = "inline-flex min-h-11 items-center justify-center border border-line px-3 py-2 font-mono text-xs text-seal hover:border-ink disabled:opacity-50";
type Action = (action: () => void | Promise<void>, success: string) => Promise<void>;

function ReviewFocus({ workspace, act }: { workspace: Workspace; act: Action }) {
  const [base, setBase] = useState({ title: workspace.title, question: workspace.question });
  const [draft, setDraft] = useState(base);
  const stale = workspace.title !== base.title || workspace.question !== base.question;
  return <form className="mt-4 grid gap-4" onSubmit={event => {
    event.preventDefault();
    act(async () => {
      await changeLiteratureWorkspace(current => {
        if (current.title !== base.title || current.question !== base.question) throw new Error("Your review focus changed in another tab. Load the saved focus before saving again.");
        return { ...current, ...draft };
      });
      setBase(draft);
    }, "Review focus saved on this browser.");
  }}>
    <label className="font-mono text-xs text-ink-2">Review title<input name="title" maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="My literature review" className={field} /></label>
    <label className="font-mono text-xs text-ink-2">Research question or inclusion criteria<textarea name="question" maxLength={600} value={draft.question} onChange={event => setDraft({ ...draft, question: event.target.value })} rows={3} className={field} /></label>
    {stale && <div role="status" className="font-serif text-sm text-seal"><p>The saved review focus changed in another tab or restore. Your unsaved draft is still here.</p>
      <button type="button" className={`${button} mt-2`} onClick={() => { const next = { title: workspace.title, question: workspace.question }; setBase(next); setDraft(next); }}>Load saved focus</button></div>}
    <button type="submit" className={`${button} justify-self-start`}>Save review focus</button>
  </form>;
}

function ScreeningEditor({ entry, act }: { entry: LiteratureEntry; act: Action }) {
  const [base, setBase] = useState({ screening: entry.screening, notes: entry.notes });
  const [draft, setDraft] = useState(base);
  const stale = entry.notes !== base.notes || entry.screening !== base.screening;
  return <form className="mt-2 space-y-3" onSubmit={event => {
    event.preventDefault();
    act(async () => {
      await changeLiteratureWorkspace(current => {
        const latest = current.entries.find(item => item.paper.url === entry.paper.url);
        if (!latest || latest.notes !== base.notes || latest.screening !== base.screening) throw new Error("This paper changed in another tab. Load its saved screening before saving again.");
        return { ...current, entries: current.entries.map(item => item.paper.url === entry.paper.url ? { ...item, ...draft } : item) };
      });
      setBase(draft);
    }, "Screening and notes saved on this browser.");
  }}>
    <label className="block font-mono text-xs text-ink-2">Your screening decision
      <select name="screening" value={draft.screening} onChange={event => setDraft({ ...draft, screening: event.target.value as LiteratureEntry["screening"] })} className={field}>{Object.entries(SCREENING_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </label>
    <label className="block font-mono text-xs text-ink-2">Why keep or exclude this paper? What needs checking?
      <textarea name="notes" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={2000} rows={4} className={field} />
    </label>
    {stale && <div role="status" className="font-serif text-sm text-seal"><p>Saved screening changed in another tab or restore. Your unsaved notes are still here.</p>
      <button type="button" className={`${button} mt-2`} onClick={() => { const next = { notes: entry.notes, screening: entry.screening }; setBase(next); setDraft(next); }}>Load saved screening</button></div>}
    <p className="font-serif text-xs text-ink-3">These are your own notes. Saving them does not read the paper or verify its findings.</p>
    <button className={button} type="submit">Save screening and notes</button>
  </form>;
}

function SavedPaper({ entry, selected, selectionFull, toggle, act }: {
  entry: LiteratureEntry; selected: boolean; selectionFull: boolean; toggle: () => void;
  act: Action;
}) {
  const paper = entry.paper;
  return <article className="min-w-0 border border-line bg-paper p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="font-mono text-xs text-ink-3">{SCREENING_STATES[entry.screening]} · {PAPER_REPOSITORIES[paper.repository]}</span>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-mono text-xs text-ink-2">
        <input type="checkbox" checked={selected} disabled={!selected && selectionFull} onChange={toggle} aria-label={`Compare ${paper.title}`} className="h-4 w-4 accent-seal" /> Compare
      </label>
    </div>
    <h2 className="mt-2 break-words font-display text-xl leading-snug text-ink"><a href={paper.url} target="_blank" rel="noopener noreferrer" className="hover:text-seal">{paper.title}</a></h2>
    <p className="mt-3 break-words font-serif text-sm text-ink-2">{paper.authors.join(", ") || "Contributors unavailable"}</p>
    <p className="mt-2 break-words font-mono text-xs text-ink-3">{[paper.publishedYear, paper.venue, paper.arxivId && `arXiv ${paper.arxivId}`, paper.doi && `DOI ${paper.doi}`].filter(Boolean).join(" · ")}</p>
    <p className="mt-2 font-serif text-xs text-ink-3">Metadata only · Peer review unknown{paper.authorsTruncated && ` · Incomplete contributors (${paper.authors.length}/${paper.authorCount})`}</p>
    <div className="mt-3 flex flex-wrap gap-3"><a href={paper.url} target="_blank" rel="noopener noreferrer" className={button}>Open paper record ↗</a>
      {(paper.links ?? []).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className={button}>{link.label} ↗</a>)}
    </div>
    {entry.notes && <p className="mt-4 whitespace-pre-wrap break-words border-l-2 border-line pl-3 font-serif text-sm text-ink-2"><span className="mb-1 block font-mono text-xs text-ink-3">Your screening notes</span>{entry.notes}</p>}
    <details className="mt-4 border-t border-line pt-2">
      <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-seal underline">Edit screening and notes</summary>
      <ScreeningEditor entry={entry} act={act} />
    </details>
    <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-ink-3 underline">Saved record and removal</summary>
      <a href={paper.metadataUrl} target="_blank" rel="noopener noreferrer" className="break-words font-serif text-sm text-seal underline">Metadata observed {paper.metadataObservedAt.slice(0, 10)} ↗</a>
      <p className="mt-2 font-serif text-xs text-ink-3">Saved {entry.savedAt.slice(0, 10)}. Retains the first saved snapshot of this exact paper link; imported records are not revalidated.</p>
      <button type="button" className={`${button} mt-3`} onClick={() => act(async () => {
        if (window.confirm("Remove this paper and its screening notes from this browser?")) await changeLiteratureWorkspace(current => ({ ...current, entries: current.entries.filter(item => item.paper.url !== paper.url) }));
        else throw new Error("Removal cancelled. Your paper is still saved.");
      }, "Paper removed from this browser.")}>Remove saved paper</button>
    </details>
  </article>;
}

export function LiteratureWorkspace() {
  const { ready, workspace, error, raw } = useLiteratureWorkspace();
  const [message, setMessage] = useState(""), [failure, setFailure] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [filter, setFilter] = useState("all");
  const [pending, setPending] = useState<{ workspace: Workspace; filename: string }>();
  const [editingRevision, setEditingRevision] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const importGeneration = useRef(0);
  const act: Action = async (action, success) => {
    try { await action(); setFailure(""); setMessage(success); }
    catch (issue) { setMessage(""); setFailure(issue instanceof Error ? issue.message : "The workspace action failed."); }
  };
  const active = selected.filter(url => workspace.entries.some(entry => entry.paper.url === url));
  let draft = "", draftError = "";
  if (active.length === 2) { try { draft = literatureComparisonDraft(workspace, active); } catch (issue) { draftError = (issue as Error).message; } }
  const visible = workspace.entries.filter(entry => filter === "all" || entry.screening === filter);

  return <div className="mt-7 space-y-6">
    <p className="max-w-[75ch] font-serif text-sm leading-relaxed text-ink-2">Saved only in this browser, without an account or cloud sync. Export a backup before clearing browser data or changing devices. Notes stay here; preparing a comparison uses only your research question and the two paper links.</p>
    {!ready && <p role="status" className="font-serif text-sm text-ink-2">Loading your saved workspace…</p>}
    {error && <p role="alert" className="border border-seal bg-paper p-4 font-serif text-sm text-seal">{error}</p>}
    <div role={failure ? "alert" : "status"} aria-live="polite" className="break-words font-serif text-sm text-seal">{failure || message}</div>

    {ready && !error && <>
      <section aria-labelledby="literature-project" className="border border-line bg-paper p-5 sm:p-6">
        <h2 id="literature-project" className="font-display text-2xl text-ink">Start with your review question</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">Keep a focus for screening. For example: which retrieval methods improve factual grounding, and under what evaluation conditions?</p>
        <ReviewFocus key={editingRevision} workspace={workspace} act={act} />
      </section>

      <section aria-labelledby="literature-list">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3">
          <h2 id="literature-list" className="font-display text-2xl text-ink">Your papers <span className="text-ink-3">{workspace.entries.length}/50</span></h2>
          <Link prefetch={false} href="/sources?kind=paper#research-papers" className={button}>Find and save papers →</Link>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <label className="font-mono text-xs text-ink-2">Show screening decisions<select value={filter} onChange={event => setFilter(event.target.value)} className={field}>
            <option value="all">All saved papers</option>{Object.entries(SCREENING_STATES).map(([value, label]) => <option key={value} value={value}>{label} ({workspace.entries.filter(entry => entry.screening === value).length})</option>)}
          </select></label>
          <div className="space-y-2">
            <p role="status" className="font-serif text-sm text-ink-2">{visible.length} shown · {active.length}/2 selected for comparison</p>
            <button type="button" disabled={visible.length === 0} className={button} onClick={() => act(() => {
              const exported = paperReferencesRis(visible.map(entry => entry.paper));
              downloadBrowserText(exported.content, "keryx-literature-references.ris", "application/x-research-info-systems;charset=utf-8");
            }, `RIS download prepared for ${visible.length} shown papers.`)}>Download shown references (RIS)</button>
          </div>
        </div>
        <p className="mt-2 font-serif text-xs text-ink-3">RIS exports only the papers shown by this filter, for a reference manager such as Zotero. It keeps saved metadata and exact versions; your review question, screening decisions and personal notes stay out of this file.</p>
        <div className="mt-4 border border-line bg-panel p-4">
          <p className="font-serif text-sm text-ink-2">Select two saved papers to prepare an editable comparison using your saved review question. Deep research can inspect more targets; its existing reading, evidence, availability and budget limits still apply.</p>
          <div className="mt-3 flex flex-wrap gap-3">{draft ? <Link prefetch={false} href={`/?q=${encodeURIComponent(draft)}&mode=deep`} className={`${button} border-ink bg-seal text-paper`}>Prepare comparison →</Link> : <button disabled className={button}>Select two papers to compare</button>}
            {active.length > 0 && <button type="button" className={button} onClick={() => setSelected([])}>Clear comparison selection</button>}
          </div>
          <p className="mt-2 font-serif text-xs text-ink-3">Opens the question composer for your review. The question and links enter its URL and browser history. Nothing is submitted automatically; paper text has not been read by this workspace.</p>
          {draftError && <p role="alert" className="mt-2 font-serif text-sm text-seal">{draftError}</p>}
        </div>
        {workspace.entries.length === 0 ? <div className="mt-5 border border-dashed border-line bg-paper p-6">
          <h3 className="font-display text-xl text-ink">Build a review you can return to.</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 font-serif text-sm text-ink-2"><li>Find papers in the starter library or search repositories.</li><li>Save an exact paper record, then record why it belongs in your review.</li><li>Compare two papers or export the screening list to continue your work.</li></ol>
          <Link prefetch={false} href="/sources?kind=paper#research-papers" className={`${button} mt-4`}>Browse research papers →</Link>
        </div> : <>
          {visible.length === 0 && <p className="mt-5 font-serif text-sm text-ink-2">No papers have this screening decision. Choose another filter to see your saved list.</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2">{workspace.entries.map(entry => <div key={`${editingRevision}:${entry.paper.url}`} hidden={filter !== "all" && entry.screening !== filter} className="min-w-0"><SavedPaper entry={entry} selected={active.includes(entry.paper.url)} selectionFull={active.length === 2}
            toggle={() => setSelected(active.includes(entry.paper.url) ? active.filter(url => url !== entry.paper.url) : [...active, entry.paper.url])} act={act} /></div>)}</div>
        </>}
      </section>
    </>}

    {ready && <section aria-labelledby="literature-portability" className="border border-line bg-paper p-5 sm:p-6">
      <h2 id="literature-portability" className="font-display text-2xl text-ink">Keep your work portable</h2>
      <p className="mt-2 font-serif text-sm leading-relaxed text-ink-2">Screening CSV includes all saved papers, your notes and metadata provenance. JSON backup also restores your review focus and screening. These are personal bibliography records; they contain no paper text, generated answer or settlement receipt.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={!!error || workspace.entries.length === 0} className={button} onClick={() => act(() => downloadBrowserText(literatureScreeningCsv(workspace), "keryx-literature-screening.csv", "text/csv;charset=utf-8"), "Screening CSV download prepared.")}>Download screening CSV</button>
        <button type="button" disabled={!!error} className={button} onClick={() => act(() => downloadBrowserText(serializeLiteratureWorkspace(workspace), "keryx-literature-backup.json", "application/json"), "Workspace backup download prepared.")}>Download JSON backup</button>
        {raw !== undefined && <button type="button" className={button} onClick={() => act(() => downloadBrowserText(raw, "keryx-literature-stored-data.json", "application/json"), "Original stored data download prepared.")}>Download stored data</button>}
      </div>
      <label className="mt-5 block font-mono text-xs text-ink-2">Restore a workspace backup (JSON, up to 1 MiB)
        <input type="file" accept=".json,application/json" disabled={restoring} className={`${field} max-w-full`} onChange={async event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          const generation = ++importGeneration.current; setPending(undefined);
          if (!file) return;
          try {
            if (file.size > MAX_LITERATURE_BYTES) throw new Error("Backup exceeds the 1 MiB limit. Existing workspace has been kept.");
            const imported = parseLiteratureWorkspace(await file.text());
            if (generation !== importGeneration.current) return;
            setPending({ workspace: imported, filename: file.name }); setFailure(""); setMessage("");
          } catch (issue) { if (generation === importGeneration.current) setFailure(issue instanceof Error ? issue.message : "Backup could not be read."); }
        }} />
      </label>
      {pending && <div className="mt-4 border border-seal p-4">
        <p className="break-words font-serif text-sm text-ink">{pending.filename}: {pending.workspace.entries.length} papers · {pending.workspace.title || "Untitled review"}</p>
        <p className="mt-2 font-serif text-sm text-ink-2">Restoring replaces this browser’s entire saved list, focus and notes. Download your current backup first. Imported metadata is not checked against repositories.</p>
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={restoring} className={button} onClick={async () => {
          const generation = importGeneration.current, captured = pending;
          setRestoring(true);
          await act(async () => {
            await replaceLiteratureWorkspace(captured.workspace, () => generation === importGeneration.current);
            if (generation !== importGeneration.current) return;
            setPending(undefined); setSelected([]); setFilter("all"); setEditingRevision(value => value + 1);
          }, "Backup restored on this browser.");
          setRestoring(false);
        }}>{restoring ? "Restoring workspace…" : "Replace workspace with this backup"}</button>
          <button type="button" disabled={restoring} className={button} onClick={() => { ++importGeneration.current; setPending(undefined); }}>Cancel restore</button></div>
      </div>}
      <details className="mt-5 border-t border-line pt-2"><summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-ink-3 underline">Clear this browser’s literature workspace</summary>
        <p className="mt-2 font-serif text-sm text-ink-2">Clears only this saved bibliography and notes. Export a backup first.</p>
        <button type="button" className={`${button} mt-3`} onClick={() => act(async () => {
          if (!window.confirm("Clear all saved papers, review focus and notes on this browser? Export a backup first.")) throw new Error("Clear cancelled. Your workspace has been kept.");
          await clearLiteratureWorkspace(); ++importGeneration.current; setPending(undefined); setSelected([]); setFilter("all"); setEditingRevision(value => value + 1);
        }, "Literature workspace cleared on this browser.")}>Clear saved workspace</button>
      </details>
    </section>}
  </div>;
}
