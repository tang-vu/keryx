"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { assembleEvidenceDraftRequest, buildEvidenceDraft, evidenceDraftReportSchema, evidenceDraftWorkspace, EVIDENCE_DRAFT_NOTICE, MAX_EVIDENCE_DRAFT_BYTES,
  type EvidenceDraftRequest } from "@/lib/research/evidence-draft";
import { exportEvidenceDraft } from "@/lib/research/evidence-draft-export";
import { evidenceDraftCopy as copy, evidenceDraftCopyText as copyText } from "@/lib/research/evidence-draft-copy";
import { RELATED_WORK_STATEMENT_KINDS } from "@/lib/research/related-work-statements";
import { relatedWorkReadingDraft } from "@/lib/research/related-work-generation";
import { appendCompletedEvidenceDraftImport } from "@/components/keryx/completed-evidence-draft-import";
import { CompletedEvidenceDraftSelector } from "@/components/keryx/completed-evidence-draft-selector";
import { completedEvidenceDraftSelectionCopy as completedCopy } from "@/locales/en/completed-evidence-draft-selection";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { EvidenceDraftRestore } from "./evidence-draft-restore";
import { evidenceDraftEditingCopy as editingEnglish } from "@/locales/en/evidence-draft-editing";
import { rebaseEvidenceDraftClaims, type PassageEditHint } from "@/lib/research/evidence-draft-passage";
const uiEnglish_completedCopy = completedCopy;


const field = "mt-2 block w-full min-w-0 rounded-none border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const assessmentLabels = copy.claim.verdicts;
type Editors = Pick<EvidenceDraftRequest, "reports" | "passage" | "claims" | "themes" | "readingStatuses">;
type ClearRecovery = { editors: Editors; workspace: EvidenceDraftRequest["workspace"]; reportJson: string;
  reviewer: string; retainedSnapshot: string; passageNeedsSelection: boolean };
type Statement = NonNullable<EvidenceDraftRequest["themes"][number]["statements"]>[number];
const choice = "mt-2 flex gap-3 font-serif text-sm text-ink-2";
const empty = (): Editors => ({ reports: [], passage: "", claims: [], themes: [{ id: "theme1", title: copy.theme.initialTitle, authorNote: "", excerptIds: [] }] });

// Match the downloadable inputs; unfinished editor rows are protected separately.
function retainedEditorsSnapshot(editors: Editors) {
  return JSON.stringify({ reports: editors.reports, passage: editors.passage, claims: editors.claims,
    themes: editors.themes.map(({ statements, ...theme }) => {
      const written = (statements ?? []).filter(row => row.text.trim());
      return written.length ? { ...theme, statements: written } : theme;
    }), readingStatuses: editors.readingStatuses });
}

/** Restored identifiers need not be consecutive. Never renumber an existing row. */
function nextEditorId(prefix: "claim" | "theme" | "statement", rows: readonly { id: string }[]) {
  const used = new Set(rows.map(row => row.id));
  let next = rows.length + 1;
  while (used.has(`${prefix}${next}`)) next++;
  return `${prefix}${next}`;
}

export function EvidenceDraftWorkspace() {
  const completedCopy = useUiCopy("completed-evidence-draft-selection", uiEnglish_completedCopy);
  const editingCopy = useUiCopy("evidence-draft-editing", editingEnglish);
  const store = useLiteratureWorkspace(), [editors, setEditors] = useState(empty), [reportJson, setReportJson] = useState("");
  const [restoredWorkspace, setRestoredWorkspace] = useState<EvidenceDraftRequest["workspace"]>();
  const workspace = restoredWorkspace ?? store.workspace;
  const workspaceReady = !!restoredWorkspace || store.ready, workspaceError = restoredWorkspace ? undefined : store.error;
  const [message, setMessage] = useState(""), [reviewer, setReviewer] = useState(""), passageRef = useRef<HTMLTextAreaElement>(null);
  const passageEdit = useRef<PassageEditHint | undefined>(undefined);
  const [passageNeedsSelection, setPassageNeedsSelection] = useState(false);
  useLayoutEffect(() => {
    const element = passageRef.current;
    if (!element) return;
    const capture = (event: Event) => {
      passageEdit.current = { passage: element.value, start: element.selectionStart, end: element.selectionEnd,
        inputType: (event as InputEvent).inputType };
    };
    element.addEventListener("beforeinput", capture);
    return () => element.removeEventListener("beforeinput", capture);
  }, []);
  const [retainedSnapshot, setRetainedSnapshot] = useState(() => retainedEditorsSnapshot(empty()));
  const [clearRecovery, setClearRecovery] = useState<ClearRecovery>();
  const hasUnretainedInputs = !!reportJson || !!reviewer || editors.themes.some(theme => theme.statements?.some(row => !row.text.trim()));
  const editorSnapshot = retainedEditorsSnapshot(editors);
  const hasUnsavedChanges = hasUnretainedInputs || editorSnapshot !== retainedSnapshot;
  useLayoutEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "true"; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);
  const [resetRevision, setResetRevision] = useState(0);
  const importEpoch = useRef(0), activeImportEpoch = resetRevision;
  const restoreContext = useMemo(() => ({ editors, reportJson, reviewer, workspace }), [editors, reportJson, reviewer, workspace]);
  const liveRestoreContext = useRef(restoreContext);
  useLayoutEffect(() => { liveRestoreContext.current = restoreContext; }, [restoreContext]);
  // A sentence still being written stays in this tab and out of the draft contract.
  const themes = editors.themes.map(({ statements, ...theme }) => {
    const written = (statements ?? []).filter(row => row.text.trim());
    return written.length ? { ...theme, statements: written } : theme;
  });
  const request: EvidenceDraftRequest = { version: 1, scope: "private-evidence-draft", workspace: evidenceDraftWorkspace(workspace), ...editors, themes };
  const liveEditors = useRef(editors), liveWorkspace = useRef(workspace);
  useLayoutEffect(() => { liveEditors.current = editors; liveWorkspace.current = workspace; }, [editors, workspace]);
  let draft: ReturnType<typeof buildEvidenceDraft> | undefined, error = "";
  try { draft = buildEvidenceDraft(request); } catch { error = copy.workspace.changed; }
  const included = workspace.entries.filter(row => row.screening === "include");
  const update = (changes: Partial<Editors>) => { setClearRecovery(undefined); setEditors(current => ({ ...current, ...changes })); setMessage(""); };
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
  const excerpts = draft?.excerpts ?? [];
  const exportFile = (format: "markdown" | "latex" | "bibtex" | "ris") => {
    try {
      const exports = exportEvidenceDraft(request), extension = { markdown: "md", latex: "tex", bibtex: "bib", ris: "ris" }[format];
      downloadBrowserText(exports[format], format === "bibtex" ? "references.bib" : `evidence-draft.${extension}`, "text/plain;charset=utf-8");
      setMessage(copy.download.success);
    } catch { setMessage(copy.download.refused); }
  };
  const backupFile = () => {
    try {
      buildEvidenceDraft(request);
      downloadBrowserText(JSON.stringify(request, null, 2) + "\n", "private-evidence-draft.json", "application/json");
      // This records a requested download, never filesystem delivery. Inputs
      // deliberately absent from the packet continue to require a warning.
      setRetainedSnapshot(retainedEditorsSnapshot(editors)); setMessage(copy.download.backupSuccess);
    }
    catch { setMessage(copy.download.backupRefused); }
  };
  return <section className="mt-8 space-y-6" aria-label={copy.workspace.label}>
    <p className="font-serif text-sm leading-relaxed text-ink-2">{EVIDENCE_DRAFT_NOTICE}</p>
    <p className="font-serif text-sm text-ink-2">{copy.workspace.privacy}</p>
    {!workspaceReady && <p role="status">{copy.workspace.loading}</p>}
    {workspaceError && <p role="alert" className="text-seal">{workspaceError}</p>}
    {included.length === 0 && <p className="font-serif text-sm text-ink-2">{copy.workspace.includeFirst}</p>}
    <EvidenceDraftRestore context={restoreContext} canSave={!!draft} onSave={backupFile} onRestore={(packet, expectedContext) => {
      if (liveRestoreContext.current !== expectedContext) return false;
      try {
        buildEvidenceDraft(packet);
        const next: Editors = { reports: packet.reports, passage: packet.passage, claims: packet.claims, themes: packet.themes, readingStatuses: packet.readingStatuses };
        importEpoch.current++; setResetRevision(importEpoch.current);
        liveEditors.current = next; liveWorkspace.current = packet.workspace;
        liveRestoreContext.current = { editors: next, workspace: packet.workspace, reportJson: "", reviewer: "" };
        setClearRecovery(undefined);
        setRestoredWorkspace(packet.workspace); setEditors(next); setRetainedSnapshot(retainedEditorsSnapshot(next)); setReportJson(""); setReviewer(""); setMessage("");
        passageEdit.current = undefined; setPassageNeedsSelection(false);
        return true;
      } catch { return false; }
    }} />
    <CompletedEvidenceDraftSelector key={resetRevision} workspace={workspace} disabled={!workspaceReady || !!workspaceError} onImport={value => {
      if (activeImportEpoch !== importEpoch.current) return false;
      try {
        const next = appendCompletedEvidenceDraftImport(liveEditors.current, liveWorkspace.current, value);
        setClearRecovery(undefined);
        liveEditors.current = next; setEditors(next); setMessage(completedCopy.imported);
        return true;
      } catch { return false; }
    }} />
    <form className="border border-line bg-paper p-5" onSubmit={event => {
      event.preventDefault();
      try {
        if (new TextEncoder().encode(reportJson).length > MAX_EVIDENCE_DRAFT_BYTES) throw new Error();
        const raw = JSON.parse(reportJson), report = evidenceDraftReportSchema.parse({ ...raw, id: raw.id ?? raw.queryId });
        if (editors.reports.some(row => row.id === report.id)) throw new Error();
        const reports = [...editors.reports, report];
        // Imported usable evidence supersedes a former caller observation. Other
        // observations and author edits remain attached to their exact records.
        const fresh = buildEvidenceDraft({ ...request, reports, readingStatuses: [] }).excerpts;
        const readingStatuses = editors.readingStatuses?.filter(row => !fresh.some(excerpt => excerpt.paperUrl === row.paperUrl));
        buildEvidenceDraft({ ...request, reports, readingStatuses }); update({ reports, readingStatuses }); setReportJson("");
        setMessage(copy.import.success);
      } catch { setMessage(copy.import.refused); }
    }}>
      <label className="font-mono text-xs text-ink-2">{copy.import.label}
        <textarea className={field} value={reportJson} onChange={event => { setClearRecovery(undefined); setReportJson(event.target.value); }} maxLength={MAX_EVIDENCE_DRAFT_BYTES} rows={5} spellCheck={false} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.import.guidance}</p>
      <button type="submit" className={`${button} mt-3`} disabled={!workspaceReady || !included.length || editors.reports.length >= 8}>{copy.import.button}</button>
      <p className="mt-2 font-mono text-xs text-ink-3">{copyText(copy.import.summary, { reports: editors.reports.length, excerpts: draft?.excerpts.length ?? 0 })}</p>
    </form>
    <section className="border border-line bg-paper p-5" aria-label={copy.claim.label}>
      <label className="font-mono text-xs text-ink-2">{copy.claim.passage}
        <textarea ref={passageRef} className={field} rows={6} maxLength={12000} value={editors.passage} onChange={event => {
          const passage = event.target.value;
          const rebased = rebaseEvidenceDraftClaims(editors.passage, passage, editors.claims, passageEdit.current);
          passageEdit.current = undefined;
          update({ passage, claims: rebased.claims });
          if (rebased.removed) setPassageNeedsSelection(true);
        }} />
      </label>
      <p role={passageNeedsSelection ? "status" : undefined} className={`mt-2 font-serif text-xs ${passageNeedsSelection ? "text-seal" : "text-ink-3"}`}>{copy.claim.selectFirst}</p>
      <button type="button" className={`${button} mt-3`} disabled={!included.length || editors.claims.length >= 32} onClick={() => {
        const element = passageRef.current; if (!element || element.selectionStart === element.selectionEnd) { setMessage(copy.claim.selectFirst); return; }
        update({ claims: [...editors.claims, { id: nextEditorId("claim", editors.claims), start: element.selectionStart,
          end: element.selectionEnd, paperUrls: [included[0].paper.url], excerptIds: [] }] });
        setPassageNeedsSelection(false);
      }}>{copy.claim.add}</button>
      <label className="mt-4 block font-mono text-xs text-ink-2">{copy.claim.reviewer}
        <input className={field} value={reviewer} maxLength={120} onChange={event => { setClearRecovery(undefined); setReviewer(event.target.value); }} />
      </label>
      {editors.claims.map(claim => {
        const result = draft?.claims.find(row => row.id === claim.id);
        const replace = (changes: Partial<typeof claim>) => update({ claims: editors.claims.map(row => row.id === claim.id ? { ...row, ...changes } : row) });
        return <article className="mt-5 border-t border-line pt-4" key={claim.id}>
          <p className="whitespace-pre-wrap font-serif text-sm text-ink">{editors.passage.slice(claim.start, claim.end)}</p>
          <label className="mt-3 block font-mono text-xs text-ink-2">{copy.claim.paper}
            <select className={field} value={claim.paperUrls[0]} onChange={event => replace({ paperUrls: [event.target.value], excerptIds: [], assessment: undefined })}>
              {included.map(row => <option key={row.paper.url} value={row.paper.url}>{row.paper.title}</option>)}
            </select>
          </label>
          {(draft?.excerpts ?? []).filter(row => claim.paperUrls.includes(row.paperUrl)).map(row => <label key={row.id} className="mt-3 flex gap-3 font-serif text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={claim.excerptIds.includes(row.id)} onChange={() => replace({ excerptIds: toggle(claim.excerptIds, row.id), assessment: undefined })} />
            <span>{row.quote}<span className="block font-mono text-xs text-ink-3">{copyText(copy.claim.excerptVersion, { version: row.contentVersion, report: row.reportId })}</span></span>
          </label>)}
          <p className="mt-3 font-mono text-xs text-seal">{result?.status === "source-unavailable" ? copy.claim.unavailable : result?.assessment ? copyText(copy.claim.assessed, { assessment: assessmentLabels[result.assessment.verdict] }) : copy.claim.pending}</p>
          <p className="mt-2 font-serif text-xs text-ink-3">{result?.evidenceNotice} {copy.claim.unavailableGuidance}</p>
          {(["supported", "partly-supported", "not-found"] as const).map(verdict => <button key={verdict} type="button" className={`${button} mr-2 mt-3`}
            disabled={!reviewer.trim() || !result || result.unavailable.length > 0 || (verdict === "not-found" ? claim.excerptIds.length > 0 : claim.excerptIds.length === 0)} onClick={() => replace({ assessment: {
              origin: "user-assessment", reviewer: reviewer.trim(), reviewedAt: new Date().toISOString(), verdict,
              claimText: result!.text, paperUrls: [...claim.paperUrls], excerptIds: [...claim.excerptIds], excerpts: result!.excerpts,
            } })}>{copyText(copy.claim.recordAssessment, { assessment: assessmentLabels[verdict] })}</button>)}
          <button type="button" className={`${button} mt-3`} onClick={() => {
            if (!window.confirm(editingCopy.confirmClaim)) return;
            setClearRecovery(undefined);
            setEditors(current => ({ ...current, claims: current.claims.filter(row => row.id !== claim.id) }));
            setMessage(editingCopy.claimRemoved);
          }}>{editingCopy.removeClaim}</button>
        </article>;
      })}
    </section>
    <section aria-label={copy.theme.label} className="border border-line bg-paper p-5">
      <h2 className="font-display text-xl text-ink">{copy.theme.heading}</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">{copy.theme.guidance}</p>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.theme.assemblyGuidance}</p>
      <button type="button" className={`${button} mt-3`} disabled={!draft || !excerpts.length} onClick={() => {
        try {
          const assembled = assembleEvidenceDraftRequest(request, { mode: "append" });
          // The request omits unfinished sentences; existing editor rows must stay.
          update({ themes: [...editors.themes, ...assembled.themes.slice(request.themes.length)] }); setMessage(copy.theme.assembled);
        }
        catch { setMessage(copy.theme.assemblyRefused); }
      }}>{copy.theme.assemble}</button>
      {editors.themes.map(theme => {
        const replace = (changes: Partial<typeof theme>) => update({ themes: editors.themes.map(row => row.id === theme.id ? { ...row, ...changes } : row) });
        return <article key={theme.id} className="mt-5 border-t border-line pt-4">
          <label className="font-mono text-xs text-ink-2">{copy.theme.title}<input className={field} maxLength={120} value={theme.title} onChange={event => replace({ title: event.target.value })} /></label>
          <label className="mt-3 block font-mono text-xs text-ink-2">{copy.theme.notes}<textarea className={field} rows={4} maxLength={2000} value={theme.authorNote} onChange={event => replace({ authorNote: event.target.value })} /></label>
          {(draft?.excerpts ?? []).map(row => <label key={row.id} className="mt-3 flex gap-3 font-serif text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={theme.excerptIds.includes(row.id)} onChange={() => replace({ excerptIds: toggle(theme.excerptIds, row.id) })} />
            <span>{row.quote}<span className="block break-all font-mono text-xs text-ink-3">{row.paperUrl} · {row.contentVersion}</span></span>
          </label>)}
          <button type="button" className={`${button} mt-3`} onClick={() => replace({ excerptIds: [] })}>{copy.theme.clearExcerpts}</button>
          <button type="button" className={`${button} ml-2 mt-3`} disabled={!draft || !theme.excerptIds.length} onClick={() => {
            try {
              const assembled = assembleEvidenceDraftRequest(request, { mode: "regenerate", themeId: theme.id });
              replace({ statements: assembled.themes.find(row => row.id === theme.id)!.statements }); setMessage(copy.theme.regenerated);
            }
            catch { setMessage(copy.theme.assemblyRefused); }
          }}>{copy.theme.regenerate}</button>
          <h3 className="mt-5 font-mono text-xs text-ink-2">{copy.statement.heading}</h3>
          <p className="mt-2 font-serif text-xs text-ink-3">{copy.statement.guidance}</p>
          {(theme.statements ?? []).map(statement => {
            const result = draft?.themes.find(row => row.id === theme.id)?.statements.find(row => row.id === statement.id);
            const change = (changes: Partial<Statement>) => replace({ statements: (theme.statements ?? []).map(row => row.id === statement.id ? { ...row, ...changes } : row) });
            const status = !statement.text.trim() ? copy.statement.empty : !result ? "" : result.status === "excerpt-bound" ? copy.statement.bound
              : result.status === "author-gap" ? copy.statement.authorGap : result.withheldReason !== "paper-count" ? copy.statement.needsExcerpt
              : statement.kind === "contribution" ? copy.statement.needsOnePaper : copy.statement.needsTwoPapers;
            return <div key={statement.id} className="mt-4 min-w-0 border-l border-line pl-4">
              <label className="block font-mono text-xs text-ink-2">{copy.statement.kind}
                <select className={field} value={statement.kind} onChange={event => change({ kind: event.target.value as Statement["kind"] })}>
                  {RELATED_WORK_STATEMENT_KINDS.map(kind => <option key={kind} value={kind}>{copy.statement.kinds[kind]}</option>)}
                </select>
              </label>
              <label className="mt-3 block font-mono text-xs text-ink-2">{copy.statement.text}
                <textarea className={field} rows={3} maxLength={600} value={statement.text} onChange={event => change({ text: event.target.value })} />
              </label>
              <fieldset className="mt-3 min-w-0"><legend className="font-mono text-xs text-ink-2">{copy.statement.papers}</legend>
                {included.map(row => {
                  const url = row.paper.url, named = statement.paperUrls.includes(url), read = excerpts.some(excerpt => excerpt.paperUrl === url);
                  return <label key={url} className={choice}>
                    <input type="checkbox" className="mt-1" checked={named} disabled={!named && (!read || statement.paperUrls.length >= 8)} onChange={() => {
                      // A sentence never keeps an excerpt from a paper it no longer names.
                      const paperUrls = toggle(statement.paperUrls, url);
                      change({ paperUrls, excerptIds: statement.excerptIds.filter(id => excerpts.some(excerpt => excerpt.id === id && paperUrls.includes(excerpt.paperUrl))) });
                    }} />
                    <span>{read ? row.paper.title : copyText(copy.statement.paperUnread, { title: row.paper.title })}</span>
                  </label>;
                })}
              </fieldset>
              {statement.paperUrls.length > 0 && <fieldset className="mt-3 min-w-0"><legend className="font-mono text-xs text-ink-2">{copy.statement.excerpts}</legend>
                {excerpts.filter(row => statement.paperUrls.includes(row.paperUrl)).map(row => {
                  const chosen = statement.excerptIds.includes(row.id);
                  return <label key={row.id} className={choice}>
                    <input type="checkbox" className="mt-1" checked={chosen} disabled={!chosen && statement.excerptIds.length >= 16} onChange={() => change({ excerptIds: toggle(statement.excerptIds, row.id) })} />
                    <span>{row.quote}<span className="block break-all font-mono text-xs text-ink-3">{row.paperUrl} · {row.contentVersion}</span></span>
                  </label>;
                })}
              </fieldset>}
              <p className="mt-3 font-mono text-xs text-seal">{status}</p>
              <button type="button" className={`${button} mt-3`} onClick={() => replace({ statements: (theme.statements ?? []).filter(row => row.id !== statement.id) })}>{copy.statement.remove}</button>
            </div>;
          })}
          <button type="button" className={`${button} mt-4`} disabled={(theme.statements ?? []).length >= 24} onClick={() => replace({
            statements: [...(theme.statements ?? []), { id: nextEditorId("statement", editors.themes.flatMap(row => row.statements ?? [])), kind: "contribution", text: "", paperUrls: [], excerptIds: [] }] })}>{copy.statement.add}</button>
          <button type="button" className={`${button} ml-2 mt-4`} onClick={() => {
            if (!window.confirm(editingCopy.confirmTheme)) return;
            setClearRecovery(undefined);
            setEditors(current => ({ ...current, themes: current.themes.filter(row => row.id !== theme.id) }));
            setMessage(editingCopy.themeRemoved);
          }}>{editingCopy.removeTheme}</button>
        </article>;
      })}
      <button type="button" className={`${button} mt-4`} disabled={editors.themes.length >= 16} onClick={() => update({ themes: [...editors.themes, { id: nextEditorId("theme", editors.themes), title: copy.theme.newTitle, authorNote: "", excerptIds: [] }] })}>{copy.theme.add}</button>
      <button type="button" className={`${button} ml-2 mt-4`} disabled={!editors.readingStatuses?.length} onClick={() => update({ readingStatuses: [] })}>{copy.reading.clear}</button>
      {!!draft?.unread.length && <div className="mt-5">
        <h3 className="font-mono text-xs text-ink-2">{copy.theme.unreadHeading}</h3>
        <p className="mt-2 font-serif text-xs text-ink-3">{copy.reading.guidance}</p>
        <p className="mt-2 font-serif text-xs text-ink-3">{copy.reading.prepareGuidance}</p>
        {draft.unread.map(row => {
          const observation = editors.readingStatuses?.find(status => status.paperUrl === row.paper.url);
          const observe = (status: "unread" | "unavailable" | "", reason: string) => update({ readingStatuses: [
            ...(editors.readingStatuses ?? []).filter(status => status.paperUrl !== row.paper.url),
            ...(status ? [{ paperUrl: row.paper.url, status, reason }] : []),
          ] });
          let readHref: string | undefined;
          try { readHref = `/?${new URLSearchParams({ q: relatedWorkReadingDraft(workspace, row.paper.url), mode: "deep" })}`; } catch { /* Keep the editor when the normal question limit refuses. */ }
          return <div key={row.paper.url} className="mt-3">
            <p className="break-all font-serif text-sm text-ink-2">{row.paper.title} · {row.paper.url}</p>
            {readHref && <a href={readHref} target="_blank" rel="noopener noreferrer" className={`${button} mt-2`}>{copy.reading.prepare}</a>}
            <label className="font-mono text-xs text-ink-2">{copy.reading.status}
              <select className={field} value={observation?.status ?? ""} onChange={event => observe(event.target.value as "unread" | "unavailable" | "", observation?.reason ?? "")}>
                <option value="">{copy.reading.unknown}</option><option value="unread">{copy.reading.unread}</option><option value="unavailable">{copy.reading.unavailable}</option>
              </select>
            </label>
            {observation && <label className="mt-2 block font-mono text-xs text-ink-2">{copy.reading.reason}
              <input className={field} maxLength={300} value={observation.reason} onChange={event => observe(observation.status, event.target.value)} />
            </label>}
          </div>;
        })}
        {draft.reading.unread.length > 0 && <p className="mt-3 font-serif text-sm">{copy.reading.unreadHeading}: {draft.reading.unread.map(row => row.paper.title).join("; ")}</p>}
        {draft.reading.unavailable.length > 0 && <p className="mt-3 font-serif text-sm">{copy.reading.unavailableHeading}: {draft.reading.unavailable.map(row => row.paper.title).join("; ")}</p>}
      </div>}
    </section>
    {error && <p role="alert" className="font-serif text-sm text-seal">{error}</p>}
    <div className="flex flex-wrap gap-3">{(["markdown", "latex", "bibtex", "ris"] as const).map(format => <button key={format} type="button" className={button} disabled={!draft} onClick={() => exportFile(format)}>{copy.download[format]}</button>)}
      <button type="button" className={button} disabled={!draft} onClick={backupFile}>{copy.download.backup}</button>
      <button type="button" className={button} onClick={() => {
        if (!window.confirm(editingCopy.confirmClear)) return;
        try {
          // Retain the whole editing session, including inputs deliberately absent
          // from downloadable drafts. Freeze the exact old paper/version context.
          const recovery: ClearRecovery = clearRecovery ?? structuredClone({ editors, workspace: evidenceDraftWorkspace(workspace),
            reportJson, reviewer, retainedSnapshot, passageNeedsSelection });
          const next = empty();
          importEpoch.current++; setResetRevision(importEpoch.current);
          liveEditors.current = next; liveWorkspace.current = store.workspace;
          liveRestoreContext.current = { editors: next, workspace: store.workspace, reportJson: "", reviewer: "" };
          setClearRecovery(recovery); setRestoredWorkspace(undefined); setEditors(next);
          setRetainedSnapshot(retainedEditorsSnapshot(next)); setReportJson(""); setReviewer("");
          passageEdit.current = undefined; setPassageNeedsSelection(false); setMessage(copy.workspace.cleared);
        } catch { setMessage(editingCopy.clearRefused); }
      }}>{copy.workspace.clear}</button>
      {clearRecovery && <button type="button" className={button} onClick={() => {
        // Remount the completed-read selector and invalidate file previews before
        // restoring. Neither side of clear/undo may accept an older async import.
        importEpoch.current++; setResetRevision(importEpoch.current);
        const next = clearRecovery;
        liveEditors.current = next.editors; liveWorkspace.current = next.workspace;
        liveRestoreContext.current = { editors: next.editors, workspace: next.workspace, reportJson: next.reportJson, reviewer: next.reviewer };
        setClearRecovery(undefined); setRestoredWorkspace(next.workspace); setEditors(next.editors);
        setRetainedSnapshot(next.retainedSnapshot); setReportJson(next.reportJson); setReviewer(next.reviewer);
        passageEdit.current = undefined; setPassageNeedsSelection(next.passageNeedsSelection);
        setMessage(editingCopy.clearRestored); passageRef.current?.focus();
      }}>{editingCopy.undoClear}</button>}</div>
    {clearRecovery && <p className="font-serif text-xs text-ink-3">{editingCopy.undoClearGuidance}</p>}
    <p role="status" aria-live="polite" className="font-serif text-sm text-seal">{message}</p>
  </section>;
}
