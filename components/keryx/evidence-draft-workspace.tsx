"use client";

import { Fragment, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { assembleEvidenceDraftRequest, buildEvidenceDraft, evidenceDraftReportSchema, evidenceDraftWorkspace, EVIDENCE_DRAFT_NOTICE, MAX_EVIDENCE_DRAFT_BYTES,
  type EvidenceDraftRequest } from "@/lib/research/evidence-draft";
import { exportEvidenceDraft } from "@/lib/research/evidence-draft-export";
import { evidenceDraftCopy as copy } from "@/lib/research/evidence-draft-copy";
import { RELATED_WORK_STATEMENT_KINDS } from "@/lib/research/related-work-statements";
import { relatedWorkReadingDraft } from "@/lib/research/related-work-generation";
import { appendCompletedEvidenceDraftImport } from "@/components/keryx/completed-evidence-draft-import";
import { CompletedEvidenceDraftSelector } from "@/components/keryx/completed-evidence-draft-selector";
import { completedEvidenceDraftSelectionCopy as completedCopy } from "@/locales/en/completed-evidence-draft-selection";
import { UiText, useUiCopy } from "@/lib/i18n/ui-copy";
import { EvidenceDraftText } from "./evidence-draft-text";
import { UiCopyContext } from "@/lib/i18n/ui-copy-context";
import { EvidenceDraftRestore } from "./evidence-draft-restore";
import { PdfReadingScope } from "./pdf-reading-scope";
import { evidenceDraftEditingCopy as editingEnglish } from "@/locales/en/evidence-draft-editing";
import { rebaseEvidenceDraftClaims, type PassageEditHint } from "@/lib/research/evidence-draft-passage";
const uiEnglish_completedCopy = completedCopy;


const field = "mt-2 block w-full min-w-0 rounded-none border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
// Native select text cannot wrap. Repeat its value visibly for narrow/zoomed views;
// hide the duplicate from the accessible label because the control exposes it.
const selectionCaption = "mt-1 block font-serif text-sm text-ink-2 [overflow-wrap:anywhere]";
const button = "inline-flex min-h-11 min-w-0 max-w-full items-center whitespace-normal [overflow-wrap:anywhere] border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const assessmentLabels = copy.claim.verdicts;
type Editors = Pick<EvidenceDraftRequest, "reports" | "passage" | "claims" | "themes" | "readingStatuses">;
type DraftRecovery = { kind: "clear" | "claim" | "theme"; editors: Editors; workspace: EvidenceDraftRequest["workspace"]; reportJson: string;
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
  const ui = useUiCopy("evidence-drafts", copy);
  const locale = useContext(UiCopyContext)?.locale ?? "en";
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
  const [recovery, setRecovery] = useState<DraftRecovery>();
  const undoRef = useRef<HTMLButtonElement>(null), recoveryHintId = useId();
  useLayoutEffect(() => { if (recovery) undoRef.current?.focus(); }, [recovery]);
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
  const update = (changes: Partial<Editors>) => { setRecovery(undefined); setEditors(current => ({ ...current, ...changes })); setMessage(""); };
  const recoverySnapshot = (kind: DraftRecovery["kind"]): DraftRecovery => structuredClone({ kind, editors,
    workspace: evidenceDraftWorkspace(workspace), reportJson, reviewer, retainedSnapshot, passageNeedsSelection });
  const restoreRecovery = () => {
    if (!recovery) return;
    // Remount the completed-read selector and invalidate file previews before
    // restoring. Neither side of removal/clear undo accepts an older import.
    importEpoch.current++; setResetRevision(importEpoch.current);
    const next = recovery;
    liveEditors.current = next.editors; liveWorkspace.current = next.workspace;
    liveRestoreContext.current = { editors: next.editors, workspace: next.workspace, reportJson: next.reportJson, reviewer: next.reviewer };
    setRecovery(undefined); setRestoredWorkspace(next.workspace); setEditors(next.editors);
    setRetainedSnapshot(next.retainedSnapshot); setReportJson(next.reportJson); setReviewer(next.reviewer);
    passageEdit.current = undefined; setPassageNeedsSelection(next.passageNeedsSelection);
    setMessage(next.kind === "clear" ? editingEnglish.clearRestored : editingEnglish.removalRestored); passageRef.current?.focus();
  };
  const recoveryControl = recovery && <aside className="mt-5 min-w-0 border border-line bg-paper-2 p-4">
    <button type="button" ref={undoRef} className={button} aria-describedby={recoveryHintId} onClick={restoreRecovery}>
      {recovery.kind === "clear" ? editingCopy.undoClear : editingCopy.undoRemoval}
    </button>
    <p id={recoveryHintId} className="mt-3 font-serif text-xs text-ink-3">{editingCopy.undoClearGuidance}</p>
  </aside>;
  const claimUndoIndex = recovery?.kind === "claim"
    ? recovery.editors.claims.findIndex(old => !editors.claims.some(current => current.id === old.id)) : -1;
  const themeUndoIndex = recovery?.kind === "theme"
    ? recovery.editors.themes.findIndex(old => !editors.themes.some(current => current.id === old.id)) : -1;
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
  return <section className="mt-8 min-w-0 space-y-6 [overflow-wrap:anywhere]" aria-label={ui.workspace.label}>
    <p className="font-serif text-sm leading-relaxed text-ink-2"><span lang="en" dir="ltr">{EVIDENCE_DRAFT_NOTICE}</span></p>
    <p className="font-serif text-sm text-ink-2"><UiText source={copy.workspace.privacy} namespaces={["evidence-drafts"]} /></p>
    {!workspaceReady && <p role="status"><UiText source={copy.workspace.loading} namespaces={["evidence-drafts"]} /></p>}
    {workspaceError && <p role="alert" className="text-seal">{workspaceError}</p>}
    {included.length === 0 && <p className="font-serif text-sm text-ink-2"><UiText source={copy.workspace.includeFirst} namespaces={["evidence-drafts"]} /></p>}
    <EvidenceDraftRestore context={restoreContext} canSave={!!draft} onSave={backupFile} onRestore={(packet, expectedContext) => {
      if (liveRestoreContext.current !== expectedContext) return false;
      try {
        buildEvidenceDraft(packet);
        const next: Editors = { reports: packet.reports, passage: packet.passage, claims: packet.claims, themes: packet.themes, readingStatuses: packet.readingStatuses };
        importEpoch.current++; setResetRevision(importEpoch.current);
        liveEditors.current = next; liveWorkspace.current = packet.workspace;
        liveRestoreContext.current = { editors: next, workspace: packet.workspace, reportJson: "", reviewer: "" };
        setRecovery(undefined);
        setRestoredWorkspace(packet.workspace); setEditors(next); setRetainedSnapshot(retainedEditorsSnapshot(next)); setReportJson(""); setReviewer(""); setMessage("");
        passageEdit.current = undefined; setPassageNeedsSelection(false);
        return true;
      } catch { return false; }
    }} />
    <CompletedEvidenceDraftSelector key={resetRevision} workspace={workspace} disabled={!workspaceReady || !!workspaceError} onImport={value => {
      if (activeImportEpoch !== importEpoch.current) return false;
      try {
        const next = appendCompletedEvidenceDraftImport(liveEditors.current, liveWorkspace.current, value);
        setRecovery(undefined);
        liveEditors.current = next; setEditors(next); setMessage(uiEnglish_completedCopy.imported);
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
      <label className="font-mono text-xs text-ink-2"><UiText source={copy.import.label} namespaces={["evidence-drafts"]} />
        <textarea dir="ltr" translate="no" className={field} value={reportJson} onChange={event => { setRecovery(undefined); setReportJson(event.target.value); }} maxLength={MAX_EVIDENCE_DRAFT_BYTES} rows={5} spellCheck={false} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3"><UiText source={copy.import.guidance} namespaces={["evidence-drafts"]} /></p>
      <button type="submit" className={`${button} mt-3`} disabled={!workspaceReady || !included.length || editors.reports.length >= 8}><UiText source={copy.import.button} namespaces={["evidence-drafts"]} /></button>
      <p className="mt-2 font-mono text-xs text-ink-3"><EvidenceDraftText source={copy.import.summary} values={{ reports: editors.reports.length, excerpts: draft?.excerpts.length ?? 0 }} /></p>
    </form>
    <section className="border border-line bg-paper p-5" aria-label={ui.claim.label}>
      <label className="font-mono text-xs text-ink-2"><UiText source={copy.claim.passage} namespaces={["evidence-drafts"]} />
        <textarea ref={passageRef} dir="auto" translate="no" className={field} rows={6} maxLength={12000} value={editors.passage} onChange={event => {
          const passage = event.target.value;
          const rebased = rebaseEvidenceDraftClaims(editors.passage, passage, editors.claims, passageEdit.current);
          passageEdit.current = undefined;
          update({ passage, claims: rebased.claims });
          if (rebased.removed) setPassageNeedsSelection(true);
        }} />
      </label>
      <p role={passageNeedsSelection ? "status" : undefined} className={`mt-2 font-serif text-xs ${passageNeedsSelection ? "text-seal" : "text-ink-3"}`}><UiText source={copy.claim.selectFirst} namespaces={["evidence-drafts"]} /></p>
      <button type="button" className={`${button} mt-3`} disabled={!included.length || editors.claims.length >= 32} onClick={() => {
        const element = passageRef.current; if (!element || element.selectionStart === element.selectionEnd) { setMessage(copy.claim.selectFirst); return; }
        update({ claims: [...editors.claims, { id: nextEditorId("claim", editors.claims), start: element.selectionStart,
          end: element.selectionEnd, paperUrls: [included[0].paper.url], excerptIds: [] }] });
        setPassageNeedsSelection(false);
      }}><UiText source={copy.claim.add} namespaces={["evidence-drafts"]} /></button>
      <label className="mt-4 block font-mono text-xs text-ink-2"><UiText source={copy.claim.reviewer} namespaces={["evidence-drafts"]} />
        <input dir="auto" translate="no" className={field} value={reviewer} maxLength={120} onChange={event => { setRecovery(undefined); setReviewer(event.target.value); }} />
      </label>
      {editors.claims.map((claim, index) => {
        const result = draft?.claims.find(row => row.id === claim.id);
        const replace = (changes: Partial<typeof claim>) => update({ claims: editors.claims.map(row => row.id === claim.id ? { ...row, ...changes } : row) });
        return <Fragment key={claim.id}>{claimUndoIndex === index && recoveryControl}<article className="mt-5 border-t border-line pt-4">
          <p dir="auto" translate="no" className="whitespace-pre-wrap font-serif text-sm text-ink">{editors.passage.slice(claim.start, claim.end)}</p>
          <label className="mt-3 block font-mono text-xs text-ink-2"><UiText source={copy.claim.paper} namespaces={["evidence-drafts"]} />
            <select className={field} value={claim.paperUrls[0]} onChange={event => replace({ paperUrls: [event.target.value], excerptIds: [], assessment: undefined })}>
              {included.map(row => <option key={row.paper.url} value={row.paper.url} dir="auto" translate="no">{row.paper.title}</option>)}
            </select>
            <span aria-hidden="true" className={selectionCaption}><bdi dir="auto" translate="no">{included.find(row => row.paper.url === claim.paperUrls[0])?.paper.title}</bdi></span>
          </label>
          {(draft?.excerpts ?? []).filter(row => claim.paperUrls.includes(row.paperUrl)).map(row => <label key={row.id} className="mt-3 flex gap-3 font-serif text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={claim.excerptIds.includes(row.id)} onChange={() => replace({ excerptIds: toggle(claim.excerptIds, row.id), assessment: undefined })} />
            <span className="min-w-0"><bdi dir="auto" translate="no">{row.quote}</bdi><span className="block font-mono text-xs text-ink-3"><EvidenceDraftText source={copy.claim.excerptVersion} values={{ version: <bdi dir="ltr" translate="no">{row.contentVersion}</bdi>, report: <bdi dir="ltr" translate="no">{row.reportId}</bdi> }} /></span><PdfReadingScope provenance={{ extraction: "pdf", pdfTextScope: row.pdfTextScope }} /></span>
          </label>)}
          <p className="mt-3 font-mono text-xs text-seal">{result?.status === "source-unavailable" ? <UiText source={copy.claim.unavailable} namespaces={["evidence-drafts"]} /> : result?.assessment ? <EvidenceDraftText source={copy.claim.assessed} values={{ assessment: <UiText source={assessmentLabels[result.assessment.verdict]} namespaces={["evidence-drafts"]} /> }} /> : <UiText source={copy.claim.pending} namespaces={["evidence-drafts"]} />}</p>
          <p className="mt-2 font-serif text-xs text-ink-3">{result?.evidenceNotice && <span lang="en" dir="ltr" className="block">{result.evidenceNotice}</span>}<UiText source={copy.claim.unavailableGuidance} namespaces={["evidence-drafts"]} /></p>
          {(["supported", "partly-supported", "not-found"] as const).map(verdict => <button key={verdict} type="button" className={`${button} mr-2 mt-3`}
            disabled={!reviewer.trim() || !result || result.unavailable.length > 0 || (verdict === "not-found" ? claim.excerptIds.length > 0 : claim.excerptIds.length === 0)} onClick={() => replace({ assessment: {
              origin: "user-assessment", reviewer: reviewer.trim(), reviewedAt: new Date().toISOString(), verdict,
              claimText: result!.text, paperUrls: [...claim.paperUrls], excerptIds: [...claim.excerptIds], excerpts: result!.excerpts,
            } })}><EvidenceDraftText source={copy.claim.recordAssessment} values={{ assessment: <UiText source={assessmentLabels[verdict]} namespaces={["evidence-drafts"]} /> }} /></button>)}
          <button type="button" className={`${button} mt-3`} onClick={() => {
            if (!window.confirm(editingCopy.confirmClaim)) return;
            try {
              const checkpoint = recoverySnapshot("claim");
              setRecovery(checkpoint);
              setEditors(current => ({ ...current, claims: current.claims.filter(row => row.id !== claim.id) }));
              setMessage(editingEnglish.claimRemoved);
            } catch { setMessage(editingEnglish.removalRefused); }
          }}>{editingCopy.removeClaim}</button>
        </article></Fragment>;
      })}
      {claimUndoIndex === editors.claims.length && recoveryControl}
    </section>
    <section aria-label={ui.theme.label} className="border border-line bg-paper p-5">
      <h2 className="font-display text-xl text-ink"><UiText source={copy.theme.heading} namespaces={["evidence-drafts"]} /></h2>
      <p className="mt-2 font-serif text-sm text-ink-2"><UiText source={copy.theme.guidance} namespaces={["evidence-drafts"]} /></p>
      <p className="mt-2 font-serif text-xs text-ink-3"><UiText source={copy.theme.assemblyGuidance} namespaces={["evidence-drafts"]} /></p>
      <button type="button" className={`${button} mt-3`} disabled={!draft || !excerpts.length} onClick={() => {
        try {
          const assembled = assembleEvidenceDraftRequest(request, { mode: "append" });
          // The request omits unfinished sentences; existing editor rows must stay.
          update({ themes: [...editors.themes, ...assembled.themes.slice(request.themes.length)] }); setMessage(copy.theme.assembled);
        }
        catch { setMessage(copy.theme.assemblyRefused); }
      }}><UiText source={copy.theme.assemble} namespaces={["evidence-drafts"]} /></button>
      {editors.themes.map((theme, index) => {
        const replace = (changes: Partial<typeof theme>) => update({ themes: editors.themes.map(row => row.id === theme.id ? { ...row, ...changes } : row) });
        return <Fragment key={theme.id}>{themeUndoIndex === index && recoveryControl}<article className="mt-5 border-t border-line pt-4">
          <label className="font-mono text-xs text-ink-2"><UiText source={copy.theme.title} namespaces={["evidence-drafts"]} /><input dir="auto" translate="no" className={field} maxLength={120} value={theme.title} onChange={event => replace({ title: event.target.value })} /></label>
          <label className="mt-3 block font-mono text-xs text-ink-2"><UiText source={copy.theme.notes} namespaces={["evidence-drafts"]} /><textarea dir="auto" translate="no" className={field} rows={4} maxLength={2000} value={theme.authorNote} onChange={event => replace({ authorNote: event.target.value })} /></label>
          {(draft?.excerpts ?? []).map(row => <label key={row.id} className="mt-3 flex gap-3 font-serif text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={theme.excerptIds.includes(row.id)} onChange={() => replace({ excerptIds: toggle(theme.excerptIds, row.id) })} />
            <span className="min-w-0"><bdi dir="auto" translate="no">{row.quote}</bdi><span className="block break-all font-mono text-xs text-ink-3"><bdi dir="ltr" translate="no">{row.paperUrl}</bdi> · <bdi dir="ltr" translate="no">{row.contentVersion}</bdi></span><PdfReadingScope provenance={{ extraction: "pdf", pdfTextScope: row.pdfTextScope }} /></span>
          </label>)}
          <button type="button" className={`${button} mt-3`} onClick={() => replace({ excerptIds: [] })}><UiText source={copy.theme.clearExcerpts} namespaces={["evidence-drafts"]} /></button>
          <button type="button" className={`${button} ml-2 mt-3`} disabled={!draft || !theme.excerptIds.length} onClick={() => {
            try {
              const assembled = assembleEvidenceDraftRequest(request, { mode: "regenerate", themeId: theme.id });
              replace({ statements: assembled.themes.find(row => row.id === theme.id)!.statements }); setMessage(copy.theme.regenerated);
            }
            catch { setMessage(copy.theme.assemblyRefused); }
          }}><UiText source={copy.theme.regenerate} namespaces={["evidence-drafts"]} /></button>
          <h3 className="mt-5 font-mono text-xs text-ink-2"><UiText source={copy.statement.heading} namespaces={["evidence-drafts"]} /></h3>
          <p className="mt-2 font-serif text-xs text-ink-3"><UiText source={copy.statement.guidance} namespaces={["evidence-drafts"]} /></p>
          {(theme.statements ?? []).map(statement => {
            const result = draft?.themes.find(row => row.id === theme.id)?.statements.find(row => row.id === statement.id);
            const change = (changes: Partial<Statement>) => replace({ statements: (theme.statements ?? []).map(row => row.id === statement.id ? { ...row, ...changes } : row) });
            const status = !statement.text.trim() ? copy.statement.empty : !result ? "" : result.status === "excerpt-bound" ? copy.statement.bound
              : result.status === "author-gap" ? copy.statement.authorGap : result.withheldReason !== "paper-count" ? copy.statement.needsExcerpt
              : statement.kind === "contribution" ? copy.statement.needsOnePaper : copy.statement.needsTwoPapers;
            return <div key={statement.id} className="mt-4 min-w-0 border-l border-line pl-4">
              <label className="block font-mono text-xs text-ink-2"><UiText source={copy.statement.kind} namespaces={["evidence-drafts"]} />
                <select className={field} value={statement.kind} onChange={event => change({ kind: event.target.value as Statement["kind"] })}>
                  {RELATED_WORK_STATEMENT_KINDS.map(kind => <option key={kind} value={kind} lang={ui.statement.kinds[kind] === copy.statement.kinds[kind] ? "en" : locale} dir="auto">{ui.statement.kinds[kind]}</option>)}
                </select>
                <span aria-hidden="true" className={selectionCaption}><UiText source={copy.statement.kinds[statement.kind]} namespaces={["evidence-drafts"]} /></span>
              </label>
              <label className="mt-3 block font-mono text-xs text-ink-2"><UiText source={copy.statement.text} namespaces={["evidence-drafts"]} />
                <textarea dir="auto" translate="no" className={field} rows={3} maxLength={600} value={statement.text} onChange={event => change({ text: event.target.value })} />
              </label>
              <fieldset className="mt-3 min-w-0"><legend className="font-mono text-xs text-ink-2"><UiText source={copy.statement.papers} namespaces={["evidence-drafts"]} /></legend>
                {included.map(row => {
                  const url = row.paper.url, named = statement.paperUrls.includes(url), read = excerpts.some(excerpt => excerpt.paperUrl === url);
                  return <label key={url} className={choice}>
                    <input type="checkbox" className="mt-1" checked={named} disabled={!named && (!read || statement.paperUrls.length >= 8)} onChange={() => {
                      // A sentence never keeps an excerpt from a paper it no longer names.
                      const paperUrls = toggle(statement.paperUrls, url);
                      change({ paperUrls, excerptIds: statement.excerptIds.filter(id => excerpts.some(excerpt => excerpt.id === id && paperUrls.includes(excerpt.paperUrl))) });
                    }} />
                    <span className="min-w-0">{read ? <bdi dir="auto" translate="no">{row.paper.title}</bdi> : <EvidenceDraftText source={copy.statement.paperUnread} values={{ title: <bdi dir="auto" translate="no">{row.paper.title}</bdi> }} />}</span>
                  </label>;
                })}
              </fieldset>
              {statement.paperUrls.length > 0 && <fieldset className="mt-3 min-w-0"><legend className="font-mono text-xs text-ink-2"><UiText source={copy.statement.excerpts} namespaces={["evidence-drafts"]} /></legend>
                {excerpts.filter(row => statement.paperUrls.includes(row.paperUrl)).map(row => {
                  const chosen = statement.excerptIds.includes(row.id);
                  return <label key={row.id} className={choice}>
                    <input type="checkbox" className="mt-1" checked={chosen} disabled={!chosen && statement.excerptIds.length >= 16} onChange={() => change({ excerptIds: toggle(statement.excerptIds, row.id) })} />
                    <span className="min-w-0"><bdi dir="auto" translate="no">{row.quote}</bdi><span className="block break-all font-mono text-xs text-ink-3"><bdi dir="ltr" translate="no">{row.paperUrl}</bdi> · <bdi dir="ltr" translate="no">{row.contentVersion}</bdi></span><PdfReadingScope provenance={{ extraction: "pdf", pdfTextScope: row.pdfTextScope }} /></span>
                  </label>;
                })}
              </fieldset>}
              <p className="mt-3 font-mono text-xs text-seal"><UiText source={status} namespaces={["evidence-drafts"]} /></p>
              <button type="button" className={`${button} mt-3`} onClick={() => replace({ statements: (theme.statements ?? []).filter(row => row.id !== statement.id) })}><UiText source={copy.statement.remove} namespaces={["evidence-drafts"]} /></button>
            </div>;
          })}
          <button type="button" className={`${button} mt-4`} disabled={(theme.statements ?? []).length >= 24} onClick={() => replace({
            statements: [...(theme.statements ?? []), { id: nextEditorId("statement", editors.themes.flatMap(row => row.statements ?? [])), kind: "contribution", text: "", paperUrls: [], excerptIds: [] }] })}><UiText source={copy.statement.add} namespaces={["evidence-drafts"]} /></button>
          <button type="button" className={`${button} ml-2 mt-4`} onClick={() => {
            if (!window.confirm(editingCopy.confirmTheme)) return;
            try {
              const checkpoint = recoverySnapshot("theme");
              setRecovery(checkpoint);
              setEditors(current => ({ ...current, themes: current.themes.filter(row => row.id !== theme.id) }));
              setMessage(editingEnglish.themeRemoved);
            } catch { setMessage(editingEnglish.removalRefused); }
          }}>{editingCopy.removeTheme}</button>
        </article></Fragment>;
      })}
      {themeUndoIndex === editors.themes.length && recoveryControl}
      <button type="button" className={`${button} mt-4`} disabled={editors.themes.length >= 16} onClick={() => update({ themes: [...editors.themes, { id: nextEditorId("theme", editors.themes), title: copy.theme.newTitle, authorNote: "", excerptIds: [] }] })}><UiText source={copy.theme.add} namespaces={["evidence-drafts"]} /></button>
      <button type="button" className={`${button} ml-2 mt-4`} disabled={!editors.readingStatuses?.length} onClick={() => update({ readingStatuses: [] })}><UiText source={copy.reading.clear} namespaces={["evidence-drafts"]} /></button>
      {!!draft?.unread.length && <div className="mt-5">
        <h3 className="font-mono text-xs text-ink-2"><UiText source={copy.theme.unreadHeading} namespaces={["evidence-drafts"]} /></h3>
        <p className="mt-2 font-serif text-xs text-ink-3"><UiText source={copy.reading.guidance} namespaces={["evidence-drafts"]} /></p>
        <p className="mt-2 font-serif text-xs text-ink-3"><UiText source={copy.reading.prepareGuidance} namespaces={["evidence-drafts"]} /></p>
        {draft.unread.map(row => {
          const observation = editors.readingStatuses?.find(status => status.paperUrl === row.paper.url);
          const observe = (status: "unread" | "unavailable" | "", reason: string) => update({ readingStatuses: [
            ...(editors.readingStatuses ?? []).filter(status => status.paperUrl !== row.paper.url),
            ...(status ? [{ paperUrl: row.paper.url, status, reason }] : []),
          ] });
          let readHref: string | undefined;
          try { readHref = `/?${new URLSearchParams({ q: relatedWorkReadingDraft(workspace, row.paper.url), mode: "deep" })}`; } catch { /* Keep the editor when the normal question limit refuses. */ }
          return <div key={row.paper.url} className="mt-3">
            <p className="break-all font-serif text-sm text-ink-2"><bdi dir="auto" translate="no">{row.paper.title}</bdi> · <bdi dir="ltr" translate="no">{row.paper.url}</bdi></p>
            {readHref && <a href={readHref} target="_blank" rel="noopener noreferrer" className={`${button} mt-2`}><UiText source={copy.reading.prepare} namespaces={["evidence-drafts"]} /></a>}
            <label className="mt-3 block font-mono text-xs text-ink-2"><UiText source={copy.reading.status} namespaces={["evidence-drafts"]} />
              <select className={field} value={observation?.status ?? ""} onChange={event => observe(event.target.value as "unread" | "unavailable" | "", observation?.reason ?? "")}>
                <option value="" lang={ui.reading.unknown === copy.reading.unknown ? "en" : locale} dir="auto">{ui.reading.unknown}</option><option value="unread" lang={ui.reading.unread === copy.reading.unread ? "en" : locale} dir="auto">{ui.reading.unread}</option><option value="unavailable" lang={ui.reading.unavailable === copy.reading.unavailable ? "en" : locale} dir="auto">{ui.reading.unavailable}</option>
              </select>
              <span aria-hidden="true" className={selectionCaption}><UiText source={observation?.status === "unread" ? copy.reading.unread : observation?.status === "unavailable" ? copy.reading.unavailable : copy.reading.unknown} namespaces={["evidence-drafts"]} /></span>
            </label>
            {observation && <label className="mt-2 block font-mono text-xs text-ink-2"><UiText source={copy.reading.reason} namespaces={["evidence-drafts"]} />
              <input dir="auto" translate="no" className={field} maxLength={300} value={observation.reason} onChange={event => observe(observation.status, event.target.value)} />
            </label>}
          </div>;
        })}
        {draft.reading.unread.length > 0 && <p className="mt-3 font-serif text-sm"><UiText source={copy.reading.unreadHeading} namespaces={["evidence-drafts"]} />: <bdi dir="auto" translate="no">{draft.reading.unread.map(row => row.paper.title).join("; ")}</bdi></p>}
        {draft.reading.unavailable.length > 0 && <p className="mt-3 font-serif text-sm"><UiText source={copy.reading.unavailableHeading} namespaces={["evidence-drafts"]} />: <bdi dir="auto" translate="no">{draft.reading.unavailable.map(row => row.paper.title).join("; ")}</bdi></p>}
      </div>}
    </section>
    {error && <p role="alert" className="font-serif text-sm text-seal"><UiText source={error} namespaces={["evidence-drafts"]} /></p>}
    <div className="flex flex-wrap gap-3">{(["markdown", "latex", "bibtex", "ris"] as const).map(format => <button key={format} type="button" className={button} disabled={!draft} onClick={() => exportFile(format)}><UiText source={copy.download[format]} namespaces={["evidence-drafts"]} /></button>)}
      <button type="button" className={button} disabled={!draft} onClick={backupFile}><UiText source={copy.download.backup} namespaces={["evidence-drafts"]} /></button>
      <button type="button" className={button} onClick={() => {
        if (!window.confirm(editingCopy.confirmClear)) return;
        try {
          // Retain the whole editing session, including inputs deliberately absent
          // from downloadable drafts. Freeze the exact old paper/version context.
          const checkpoint = recovery?.kind === "clear" ? recovery : recoverySnapshot("clear");
          const next = empty();
          importEpoch.current++; setResetRevision(importEpoch.current);
          liveEditors.current = next; liveWorkspace.current = store.workspace;
          liveRestoreContext.current = { editors: next, workspace: store.workspace, reportJson: "", reviewer: "" };
          setRecovery(checkpoint); setRestoredWorkspace(undefined); setEditors(next);
          setRetainedSnapshot(retainedEditorsSnapshot(next)); setReportJson(""); setReviewer("");
          passageEdit.current = undefined; setPassageNeedsSelection(false); setMessage(copy.workspace.cleared);
        } catch { setMessage(editingEnglish.clearRefused); }
      }}><UiText source={copy.workspace.clear} namespaces={["evidence-drafts"]} /></button></div>
    {recovery?.kind === "clear" && recoveryControl}
    <p role="status" aria-live="polite" className="font-serif text-sm text-seal"><UiText source={message} namespaces={["evidence-drafts", "evidence-draft-editing", "completed-evidence-draft-selection"]} /></p>
  </section>;
}
