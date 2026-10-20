"use client";


import Link from "next/link";
import bibliographyCopy from "@/locales/en/bibliographies.json";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LiteratureComparisonPreview } from "./literature-comparison-preview";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { PAPER_REPOSITORIES } from "@/lib/papers/types";
import { paperReferencesCslJson, paperReferencesRis } from "@/lib/papers/reference-export";
import { changeLiteratureWorkspace, clearLiteratureWorkspace, replaceLiteratureWorkspace, useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { literatureComparisonDraft, literatureScreeningCsv, MAX_LITERATURE_BYTES, MAX_SAVED_PAPERS,
  SCREENING_STATES, serializeLiteratureWorkspace, type LiteratureEntry, type LiteratureWorkspace as Workspace } from "@/lib/papers/literature-workspace";
import { useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import { searchLiteratureEntries } from "@/lib/papers/literature-search";
import { literatureSearchCopy as searchEnglish } from "@/locales/en/literature-search";
import { literatureImportCopy as importEnglish } from "@/locales/en/literature-import";
import { addMissingLiteraturePapers, previewLiteratureImport, readLiteratureWorkspaceFile } from "@/lib/papers/literature-import";





const field = "mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 py-2 font-serif text-base text-ink";
const buttonBase = "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-xs hover:border-ink disabled:opacity-50";
const button = `${buttonBase} border-line text-seal`;
type Action = (action: () => void | Promise<void>, success: string) => Promise<void>;

function ReviewFocus({ workspace, act }: { workspace: Workspace; act: Action }) {
  const copy = useUiMessages();
  const [base, setBase] = useState({ title: workspace.title, question: workspace.question });
  const [draft, setDraft] = useState(base);
  const stale = workspace.title !== base.title || workspace.question !== base.question;
  return <form className="mt-4 grid gap-4" onSubmit={event => {
    event.preventDefault();
    act(async () => {
      await changeLiteratureWorkspace(current => {
        if (current.title !== base.title || current.question !== base.question) throw new Error(copy("literatureWorkspace.staleFocusError"));
        return { ...current, ...draft };
      });
      setBase(draft);
    }, copy("literatureWorkspace.focusSaved"));
  }}>
    <label className="font-mono text-xs text-ink-2">{copy("literatureWorkspace.titleLabel")}<input name="title" maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder={copy("literatureWorkspace.titlePlaceholder")} className={field} /></label>
    <label className="font-mono text-xs text-ink-2">{copy("literatureWorkspace.questionLabel")}<textarea name="question" maxLength={600} value={draft.question} onChange={event => setDraft({ ...draft, question: event.target.value })} rows={3} className={field} /></label>
    {stale && <div role="status" className="font-serif text-sm text-seal"><p>{copy("literatureWorkspace.staleFocus")}</p>
      <button type="button" className={`${button} mt-2`} onClick={() => { const next = { title: workspace.title, question: workspace.question }; setBase(next); setDraft(next); }}>{copy("literatureWorkspace.loadFocus")}</button></div>}
    <button type="submit" className={`${button} justify-self-start`}>{copy("literatureWorkspace.saveFocus")}</button>
  </form>;
}

function ScreeningEditor({ entry, act }: { entry: LiteratureEntry; act: Action }) {
  const copy = useUiMessages();
  const [base, setBase] = useState({ screening: entry.screening, notes: entry.notes });
  const [draft, setDraft] = useState(base);
  const stale = entry.notes !== base.notes || entry.screening !== base.screening;
  return <form className="mt-2 space-y-3" onSubmit={event => {
    event.preventDefault();
    act(async () => {
      await changeLiteratureWorkspace(current => {
        const latest = current.entries.find(item => item.paper.url === entry.paper.url);
        if (!latest || latest.notes !== base.notes || latest.screening !== base.screening) throw new Error(copy("literatureWorkspace.stalePaperError"));
        return { ...current, entries: current.entries.map(item => item.paper.url === entry.paper.url ? { ...item, ...draft } : item) };
      });
      setBase(draft);
    }, copy("literatureWorkspace.screeningSaved"));
  }}>
    <label className="block font-mono text-xs text-ink-2">{copy("literatureWorkspace.screeningDecision")}
      <select name="screening" value={draft.screening} onChange={event => setDraft({ ...draft, screening: event.target.value as LiteratureEntry["screening"] })} className={field}>{Object.entries(SCREENING_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </label>
    <label className="block font-mono text-xs text-ink-2">{copy("literatureWorkspace.notesLabel")}
      <textarea name="notes" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={2000} rows={4} className={field} />
    </label>
    {stale && <div role="status" className="font-serif text-sm text-seal"><p>{copy("literatureWorkspace.staleScreening")}</p>
      <button type="button" className={`${button} mt-2`} onClick={() => { const next = { notes: entry.notes, screening: entry.screening }; setBase(next); setDraft(next); }}>{copy("literatureWorkspace.loadScreening")}</button></div>}
    <p className="font-serif text-xs text-ink-3">{copy("literatureWorkspace.notesNotice")}</p>
    <button className={button} type="submit">{copy("literatureWorkspace.saveScreening")}</button>
  </form>;
}

function SavedPaper({ entry, selected, selectionFull, toggle, act }: {
  entry: LiteratureEntry; selected: boolean; selectionFull: boolean; toggle: () => void;
  act: Action;
}) {
  const copy = useUiMessages();
  const paper = entry.paper;
  return <article className="min-w-0 border border-line bg-paper p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="font-mono text-xs text-ink-3">{SCREENING_STATES[entry.screening]} · {PAPER_REPOSITORIES[paper.repository]}</span>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-mono text-xs text-ink-2">
        <input type="checkbox" checked={selected} disabled={!selected && selectionFull} onChange={toggle} aria-label={copy("literatureWorkspace.compareLabel", { title: paper.title })} className="h-4 w-4 accent-seal" /> {copy("literatureWorkspace.compare")}
      </label>
    </div>
    <h2 className="mt-2 break-words font-display text-xl leading-snug text-ink"><a href={paper.url} target="_blank" rel="noopener noreferrer" className="hover:text-seal">{paper.title}</a></h2>
    <p className="mt-3 break-words font-serif text-sm text-ink-2">{paper.authors.join(", ") || copy("literatureWorkspace.contributorsUnavailable")}</p>
    <p className="mt-2 break-words font-mono text-xs text-ink-3">{[paper.publishedYear, paper.venue, paper.arxivId && `arXiv ${paper.arxivId}`, paper.doi && `DOI ${paper.doi}`].filter(Boolean).join(" · ")}</p>
    <p className="mt-2 font-serif text-xs text-ink-3">{paper.authorsTruncated ? copy("literatureWorkspace.metadataIncomplete", { recorded: paper.authors.length, total: String(paper.authorCount) }) : copy("literatureWorkspace.metadata")}</p>
    <div className="mt-3 flex flex-wrap gap-3"><a href={paper.url} target="_blank" rel="noopener noreferrer" className={button}>{copy("literatureWorkspace.open")}</a>
      {(paper.links ?? []).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className={button}>{link.label} ↗</a>)}
    </div>
    {entry.notes && <p className="mt-4 whitespace-pre-wrap break-words border-l-2 border-line pl-3 font-serif text-sm text-ink-2"><span className="mb-1 block font-mono text-xs text-ink-3">{copy("literatureWorkspace.notes")}</span>{entry.notes}</p>}
    <details className="mt-4 border-t border-line pt-2">
      <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-seal underline">{copy("literatureWorkspace.editNotes")}</summary>
      <ScreeningEditor entry={entry} act={act} />
    </details>
    <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-ink-3 underline">{copy("literatureWorkspace.removalDetails")}</summary>
      <a href={paper.metadataUrl} target="_blank" rel="noopener noreferrer" className="break-words font-serif text-sm text-seal underline">{copy("literatureWorkspace.observed", { date: paper.metadataObservedAt.slice(0, 10) })}</a>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy("literatureWorkspace.snapshot", { date: entry.savedAt.slice(0, 10) })}</p>
      <button type="button" className={`${button} mt-3`} onClick={() => act(async () => {
        if (window.confirm(copy("literatureWorkspace.removeConfirm"))) await changeLiteratureWorkspace(current => ({ ...current, entries: current.entries.filter(item => item.paper.url !== paper.url) }));
        else throw new Error(copy("literatureWorkspace.removeCancelled"));
      }, copy("literatureWorkspace.removed"))}>{copy("literatureWorkspace.remove")}</button>
    </details>
  </article>;
}

export function LiteratureWorkspace() {
  const copy = useUiMessages();
  const searchCopy = useUiCopy("literature-search", searchEnglish), searchHelpId = useId();
  const importCopy = useUiCopy("literature-import", importEnglish);
  const { ready, workspace, error, raw } = useLiteratureWorkspace();
  const [message, setMessage] = useState(""), [failure, setFailure] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ workspace: Workspace; filename: string }>();
  const [editingRevision, setEditingRevision] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [adding, setAdding] = useState(false);
  const importGeneration = useRef(0);
  useEffect(() => () => { ++importGeneration.current; }, []);
  const importPreview = useMemo(() => {
    if (!pending || error) return;
    const preview = previewLiteratureImport(workspace, pending.workspace);
    let issue = "";
    try { addMissingLiteraturePapers(workspace, pending.workspace); }
    catch (failure) { issue = failure instanceof Error ? failure.message : copy("literatureWorkspace.actionFailed"); }
    return { ...preview, issue };
  }, [workspace, pending, error, copy]);
  const act: Action = async (action, success) => {
    try { await action(); setFailure(""); setMessage(success); }
    catch (issue) { setMessage(""); setFailure(issue instanceof Error ? issue.message : copy("literatureWorkspace.actionFailed")); }
  };
  const active = selected.filter(url => workspace.entries.some(entry => entry.paper.url === url));
  let draft = "", draftError = "";
  if (active.length === 2) { try { draft = literatureComparisonDraft(workspace, active); } catch (issue) { draftError = (issue as Error).message; } }
  const searched = useMemo(() => searchLiteratureEntries(workspace.entries, query), [workspace.entries, query]);
  const searchMatches = new Set(searched.map(entry => entry.paper.url));
  const visible = searched.filter(entry => filter === "all" || entry.screening === filter);
  const visibleUrls = new Set(visible.map(entry => entry.paper.url));

  return <div className="mt-7 space-y-6">
    <p className="max-w-[75ch] font-serif text-sm leading-relaxed text-ink-2">{copy("literatureWorkspace.privacy")}</p>
    {!ready && <p role="status" className="font-serif text-sm text-ink-2">{copy("literatureWorkspace.loading")}</p>}
    {error && <p role="alert" className="border border-seal bg-paper p-4 font-serif text-sm text-seal">{error}</p>}
    <div role={failure ? "alert" : "status"} aria-live="polite" className="break-words font-serif text-sm text-seal">{failure || message}</div>

    {ready && !error && <>
      <section aria-labelledby="literature-project" className="border border-line bg-paper p-5 sm:p-6">
        <h2 id="literature-project" className="font-display text-2xl text-ink">{copy("literatureWorkspace.focusTitle")}</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy("literatureWorkspace.focusExample")}</p>
        <ReviewFocus key={editingRevision} workspace={workspace} act={act} />
      </section>

      <section aria-labelledby="literature-list">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3">
          <h2 id="literature-list" className="font-display text-2xl text-ink">{copy("literatureWorkspace.papers")} <span className="text-ink-3">{workspace.entries.length}/50</span></h2>
          <Link prefetch={false} href="/sources?kind=paper#research-papers" className={button}>{copy("literatureWorkspace.find")}</Link>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1 basis-64">
            <label className="block font-mono text-xs text-ink-2">{searchCopy.label}
              <input type="search" maxLength={200} autoComplete="off" autoCapitalize="none" spellCheck={false} value={query}
                onChange={event => setQuery(event.target.value)} aria-describedby={searchHelpId} className={field} />
            </label>
            <p id={searchHelpId} className="mt-2 font-serif text-xs text-ink-3">{searchCopy.guidance}</p>
            {query !== "" && <button type="button" className={`${button} mt-2`} onClick={() => setQuery("")}>{searchCopy.clear}</button>}
          </div>
          <label className="font-mono text-xs text-ink-2">{copy("literatureWorkspace.filter")}<select value={filter} onChange={event => setFilter(event.target.value)} className={field}>
            <option value="all">{copy("literatureWorkspace.filterAll")}</option>{Object.entries(SCREENING_STATES).map(([value, label]) => <option key={value} value={value}>{label} ({searched.filter(entry => entry.screening === value).length})</option>)}
          </select></label>
          <div className="space-y-2">
            <p role="status" className="font-serif text-sm text-ink-2">{copy(visible.length === 1 ? "literatureWorkspace.selection.one" : "literatureWorkspace.selection.other", { count: visible.length, selected: active.length })}</p>
            <button type="button" disabled={visible.length === 0} className={button} onClick={() => act(() => {
              const exported = paperReferencesRis(visible.map(entry => entry.paper));
              downloadBrowserText(exported.content, "keryx-literature-references.ris", "application/x-research-info-systems;charset=utf-8");
            }, copy(visible.length === 1 ? "literatureWorkspace.risPrepared.one" : "literatureWorkspace.risPrepared.other", { count: visible.length }))}>{copy("literatureWorkspace.ris")}</button>
            <button type="button" disabled={visible.length === 0} className={button} onClick={() => act(() => {
              const exported = paperReferencesCslJson(visible.map(entry => entry.paper));
              downloadBrowserText(exported.content, "keryx-literature-references.json", "application/json;charset=utf-8");
            }, copy(visible.length === 1 ? "literatureWorkspace.cslPrepared.one" : "literatureWorkspace.cslPrepared.other", { count: visible.length }))}>{copy("literatureWorkspace.csl")}</button>
          </div>
        </div>
        <p className="mt-2 font-serif text-xs text-ink-3">{copy("literatureWorkspace.referencesNotice")}</p>
        <p className="mt-2 font-serif text-xs text-ink-3">{searchCopy.scope}</p>
        <div className="mt-4 border border-line bg-panel p-4">
          <p className="font-serif text-sm text-ink-2">{copy("literatureWorkspace.compareNotice")}</p>
          <LiteratureComparisonPreview entries={active.flatMap(url => workspace.entries.filter(entry => entry.paper.url === url)
            .map(({ paper, screening }) => ({ paper, screening, matchesSearch: searchMatches.has(paper.url) })))} filter={filter} savedQuestion={workspace.question} draft={draft}
            onRemove={url => setSelected(active.filter(selectedUrl => selectedUrl !== url))} />
          <div className="mt-3 flex flex-wrap gap-3">{draft ? <Link prefetch={false} href={`/?q=${encodeURIComponent(draft)}&mode=deep`} className={`${buttonBase} border-ink bg-seal text-paper`}>{copy("literatureWorkspace.prepare")}</Link> : <button disabled className={button}>{copy("literatureWorkspace.selectTwo")}</button>}
            {active.length > 0 && <button type="button" className={button} onClick={() => setSelected([])}>{copy("literatureWorkspace.clearSelection")}</button>}
          </div>
          <p className="mt-2 font-serif text-xs text-ink-3">{copy("literatureWorkspace.draftPrivacy")}</p>
          {draftError && <p role="alert" className="mt-2 font-serif text-sm text-seal">{draftError}</p>}
        </div>
        {workspace.entries.length === 0 ? <div className="mt-5 border border-dashed border-line bg-paper p-6">
          <h3 className="font-display text-xl text-ink">{copy("literatureWorkspace.emptyTitle")}</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 font-serif text-sm text-ink-2"><li>{copy("literatureWorkspace.emptyFind")}</li><li>{copy("literatureWorkspace.emptySave")}</li><li>{copy("literatureWorkspace.emptyCompare")}</li></ol>
          <Link prefetch={false} href="/sources?kind=paper#research-papers" className={`${button} mt-4`}>{copy("literatureWorkspace.browse")}</Link>
        </div> : <>
          {visible.length === 0 && <p className="mt-5 font-serif text-sm text-ink-2">{query.trim() ? searchCopy.empty : copy("literatureWorkspace.filterEmpty")}</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2">{workspace.entries.map(entry => <div key={`${editingRevision}:${entry.paper.url}`} hidden={!visibleUrls.has(entry.paper.url)} className="min-w-0"><SavedPaper entry={entry} selected={active.includes(entry.paper.url)} selectionFull={active.length === 2}
            toggle={() => setSelected(active.includes(entry.paper.url) ? active.filter(url => url !== entry.paper.url) : [...active, entry.paper.url])} act={act} /></div>)}</div>
        </>}
      </section>
    </>}

    {ready && <section aria-labelledby="literature-portability" className="border border-line bg-paper p-5 sm:p-6">
      <h2 id="literature-portability" className="font-display text-2xl text-ink">{copy("literatureWorkspace.portable")}</h2>
      <p className="mt-2 font-serif text-sm leading-relaxed text-ink-2">{copy("literatureWorkspace.portableNotice")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/me/bibliographies" prefetch={false} className={button}>{bibliographyCopy.manage}</Link>
        <button type="button" disabled={!!error || workspace.entries.length === 0} className={button} onClick={() => act(() => downloadBrowserText(literatureScreeningCsv(workspace), "keryx-literature-screening.csv", "text/csv;charset=utf-8"), copy("literatureWorkspace.csvPrepared"))}>{copy("literatureWorkspace.csv")}</button>
        <button type="button" disabled={!!error} className={button} onClick={() => act(() => downloadBrowserText(serializeLiteratureWorkspace(workspace), "keryx-literature-backup.json", "application/json"), copy("literatureWorkspace.backupPrepared"))}>{copy("literatureWorkspace.backup")}</button>
        {raw !== undefined && <button type="button" className={button} onClick={() => act(() => downloadBrowserText(raw, "keryx-literature-stored-data.json", "application/json"), copy("literatureWorkspace.storedPrepared"))}>{copy("literatureWorkspace.stored")}</button>}
      </div>
      <label className="mt-5 block font-mono text-xs text-ink-2">{copy("literatureWorkspace.restoreLabel")}
        <input type="file" accept=".json,application/json" disabled={restoring || adding} className={`${field} max-w-full`} onChange={async event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          const generation = ++importGeneration.current; setPending(undefined);
          if (!file) return;
          try {
            if (file.size > MAX_LITERATURE_BYTES) throw new Error(copy("literatureWorkspace.tooLarge"));
            const imported = readLiteratureWorkspaceFile(new Uint8Array(await file.arrayBuffer()));
            if (generation !== importGeneration.current) return;
            setPending({ workspace: imported, filename: file.name }); setFailure(""); setMessage("");
          } catch (issue) { if (generation === importGeneration.current) setFailure(issue instanceof Error && issue.message.trim() ? issue.message : copy("literatureWorkspace.unreadable")); }
        }} />
      </label>
      {pending && <div className="mt-4 border border-seal p-4">
        <p className="break-words font-serif text-sm text-ink">{copy(pending.workspace.entries.length === 1 ? "literatureWorkspace.backupSummary.one" : "literatureWorkspace.backupSummary.other", { filename: pending.filename, count: pending.workspace.entries.length, title: pending.workspace.title || copy("literatureWorkspace.untitled") })}</p>
        {importPreview && <section aria-label={importCopy.preview} className="mt-4 border border-line p-4">
          <h3 className="font-display text-lg text-ink">{importCopy.preview}</h3>
          <p className="mt-2 font-serif text-sm text-ink-2">{importCopy.notice}</p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 font-mono text-xs text-ink-2">
            <dt>{importCopy.newPapers}</dt><dd>{importPreview.additions.length}</dd>
            <dt>{importCopy.duplicates}</dt><dd>{importPreview.duplicates}</dd>
            <dt>{importCopy.total}</dt><dd>{`${importPreview.total}/${MAX_SAVED_PAPERS}`}</dd>
          </dl>
          {importPreview.additions.length > 0 && <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-seal underline">{importCopy.review}</summary>
            <ul className="space-y-3">{importPreview.additions.map(entry => <li key={entry.paper.url} className="min-w-0 border-t border-line pt-3">
              <a href={entry.paper.url} target="_blank" rel="noopener noreferrer" className="break-words font-serif text-sm text-seal underline">{entry.paper.title}</a>
              <p className="break-words font-mono text-xs text-ink-3">{entry.paper.url}</p>
              <p className="mt-1 font-mono text-xs text-ink-2">{SCREENING_STATES[entry.screening]}</p>
              {entry.notes && <p className="mt-2 whitespace-pre-wrap break-words font-serif text-sm text-ink-2">{entry.notes}</p>}
            </li>)}</ul>
          </details>}
          {importPreview.issue && <p role="alert" className="mt-2 font-serif text-sm text-seal">{importPreview.issue}</p>}
          {!importPreview.additions.length && <p className="mt-2 font-serif text-sm text-ink-2">{importCopy.none}</p>}
          <button type="button" disabled={restoring || adding || !!importPreview.issue || !importPreview.additions.length} className={`${button} mt-3`} onClick={async () => {
            const generation = importGeneration.current, captured = pending, base = serializeLiteratureWorkspace(workspace);
            setAdding(true);
            await act(async () => {
              await changeLiteratureWorkspace(current => {
                if (generation !== importGeneration.current) throw new Error(importCopy.cancelled);
                if (serializeLiteratureWorkspace(current) !== base) throw new Error(importCopy.stale);
                return addMissingLiteraturePapers(current, captured.workspace);
              });
              if (generation === importGeneration.current) setPending(undefined);
            }, importCopy.added);
            setAdding(false);
          }}>{adding ? importCopy.adding : importCopy.add}</button>
        </section>}
        <p className="mt-2 font-serif text-sm text-ink-2">{copy("literatureWorkspace.restoreNotice")}</p>
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={restoring || adding} className={button} onClick={async () => {
          const generation = importGeneration.current, captured = pending;
          setRestoring(true);
          await act(async () => {
            await replaceLiteratureWorkspace(captured.workspace, () => generation === importGeneration.current);
            if (generation !== importGeneration.current) return;
            setPending(undefined); setSelected([]); setFilter("all"); setQuery(""); setEditingRevision(value => value + 1);
          }, copy("literatureWorkspace.restored"));
          setRestoring(false);
        }}>{restoring ? copy("literatureWorkspace.restoring") : copy("literatureWorkspace.restore")}</button>
          <button type="button" disabled={restoring} className={button} onClick={() => { ++importGeneration.current; setPending(undefined); }}>{copy("literatureWorkspace.cancelRestore")}</button></div>
      </div>}
      <details className="mt-5 border-t border-line pt-2"><summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-ink-3 underline">{copy("literatureWorkspace.clearDetails")}</summary>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy("literatureWorkspace.clearNotice")}</p>
        <button type="button" className={`${button} mt-3`} onClick={() => act(async () => {
          if (!window.confirm(copy("literatureWorkspace.clearConfirm"))) throw new Error(copy("literatureWorkspace.clearCancelled"));
          await clearLiteratureWorkspace(); ++importGeneration.current; setPending(undefined); setSelected([]); setFilter("all"); setQuery(""); setEditingRevision(value => value + 1);
        }, copy("literatureWorkspace.cleared"))}>{copy("literatureWorkspace.clear")}</button>
      </details>
    </section>}
  </div>;
}
