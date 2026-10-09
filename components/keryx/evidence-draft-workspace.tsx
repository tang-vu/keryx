"use client";

import { useRef, useState } from "react";
import { useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { buildEvidenceDraft, evidenceDraftReportSchema, evidenceDraftWorkspace, EVIDENCE_DRAFT_NOTICE, MAX_EVIDENCE_DRAFT_BYTES,
  type EvidenceDraftRequest } from "@/lib/research/evidence-draft";
import { exportEvidenceDraft } from "@/lib/research/evidence-draft-export";
import { evidenceDraftCopy as copy, evidenceDraftCopyText as copyText } from "@/lib/research/evidence-draft-copy";

const field = "mt-2 block w-full min-w-0 rounded-none border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const assessmentLabels = copy.claim.verdicts;
type Editors = Pick<EvidenceDraftRequest, "reports" | "passage" | "claims" | "themes">;
const empty = (): Editors => ({ reports: [], passage: "", claims: [], themes: [{ id: "theme1", title: copy.theme.initialTitle, authorNote: "", excerptIds: [] }] });

export function EvidenceDraftWorkspace() {
  const store = useLiteratureWorkspace(), [editors, setEditors] = useState(empty), [reportJson, setReportJson] = useState("");
  const [message, setMessage] = useState(""), [reviewer, setReviewer] = useState(""), passageRef = useRef<HTMLTextAreaElement>(null);
  const request: EvidenceDraftRequest = { version: 1, scope: "private-evidence-draft", workspace: evidenceDraftWorkspace(store.workspace), ...editors };
  let draft: ReturnType<typeof buildEvidenceDraft> | undefined, error = "";
  try { draft = buildEvidenceDraft(request); } catch { error = copy.workspace.changed; }
  const included = store.workspace.entries.filter(row => row.screening === "include");
  const update = (changes: Partial<Editors>) => { setEditors(current => ({ ...current, ...changes })); setMessage(""); };
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
  const exportFile = (format: "markdown" | "latex" | "bibtex" | "ris") => {
    try {
      const exports = exportEvidenceDraft(request), extension = { markdown: "md", latex: "tex", bibtex: "bib", ris: "ris" }[format];
      downloadBrowserText(exports[format], format === "bibtex" ? "references.bib" : `evidence-draft.${extension}`, "text/plain;charset=utf-8");
      setMessage(copy.download.success);
    } catch { setMessage(copy.download.refused); }
  };
  return <section className="mt-8 space-y-6" aria-label={copy.workspace.label}>
    <p className="font-serif text-sm leading-relaxed text-ink-2">{EVIDENCE_DRAFT_NOTICE}</p>
    <p className="font-serif text-sm text-ink-2">{copy.workspace.privacy}</p>
    {!store.ready && <p role="status">{copy.workspace.loading}</p>}
    {store.error && <p role="alert" className="text-seal">{store.error}</p>}
    {included.length === 0 && <p className="font-serif text-sm text-ink-2">{copy.workspace.includeFirst}</p>}
    <form className="border border-line bg-paper p-5" onSubmit={event => {
      event.preventDefault();
      try {
        if (new TextEncoder().encode(reportJson).length > MAX_EVIDENCE_DRAFT_BYTES) throw new Error();
        const raw = JSON.parse(reportJson), report = evidenceDraftReportSchema.parse({ ...raw, id: raw.id ?? raw.queryId });
        if (editors.reports.some(row => row.id === report.id)) throw new Error();
        const reports = [...editors.reports, report]; buildEvidenceDraft({ ...request, reports }); update({ reports }); setReportJson("");
        setMessage(copy.import.success);
      } catch { setMessage(copy.import.refused); }
    }}>
      <label className="font-mono text-xs text-ink-2">{copy.import.label}
        <textarea className={field} value={reportJson} onChange={event => setReportJson(event.target.value)} maxLength={MAX_EVIDENCE_DRAFT_BYTES} rows={5} spellCheck={false} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.import.guidance}</p>
      <button type="submit" className={`${button} mt-3`} disabled={!store.ready || !included.length || editors.reports.length >= 8}>{copy.import.button}</button>
      <p className="mt-2 font-mono text-xs text-ink-3">{copyText(copy.import.summary, { reports: editors.reports.length, excerpts: draft?.excerpts.length ?? 0 })}</p>
    </form>
    <section className="border border-line bg-paper p-5" aria-label={copy.claim.label}>
      <label className="font-mono text-xs text-ink-2">{copy.claim.passage}
        <textarea ref={passageRef} className={field} rows={6} maxLength={12000} value={editors.passage} onChange={event => {
          // Existing spans refer to these exact bytes. Never silently shift a claim to new prose.
          update({ passage: event.target.value, claims: [] });
        }} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.claim.guidance}</p>
      <button type="button" className={`${button} mt-3`} disabled={!included.length || editors.claims.length >= 32} onClick={() => {
        const element = passageRef.current; if (!element || element.selectionStart === element.selectionEnd) { setMessage(copy.claim.selectFirst); return; }
        update({ claims: [...editors.claims, { id: `claim${editors.claims.length + 1}`, start: element.selectionStart,
          end: element.selectionEnd, paperUrls: [included[0].paper.url], excerptIds: [] }] });
      }}>{copy.claim.add}</button>
      <label className="mt-4 block font-mono text-xs text-ink-2">{copy.claim.reviewer}
        <input className={field} value={reviewer} maxLength={120} onChange={event => setReviewer(event.target.value)} />
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
        </article>;
      })}
    </section>
    <section aria-label={copy.theme.label} className="border border-line bg-paper p-5">
      <h2 className="font-display text-xl text-ink">{copy.theme.heading}</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">{copy.theme.guidance}</p>
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
        </article>;
      })}
      <button type="button" className={`${button} mt-4`} disabled={editors.themes.length >= 16} onClick={() => update({ themes: [...editors.themes, { id: `theme${editors.themes.length + 1}`, title: copy.theme.newTitle, authorNote: "", excerptIds: [] }] })}>{copy.theme.add}</button>
      {!!draft?.unread.length && <div className="mt-5"><h3 className="font-mono text-xs text-ink-2">{copy.theme.unreadHeading}</h3><ul className="mt-2 list-disc pl-5 font-serif text-sm text-ink-2">{draft.unread.map(row => <li key={row.paper.url}>{copyText(copy.theme.unreadPaper, { title: row.paper.title })}</li>)}</ul></div>}
    </section>
    {error && <p role="alert" className="font-serif text-sm text-seal">{error}</p>}
    <div className="flex flex-wrap gap-3">{(["markdown", "latex", "bibtex", "ris"] as const).map(format => <button key={format} type="button" className={button} disabled={!draft} onClick={() => exportFile(format)}>{copy.download[format]}</button>)}
      <button type="button" className={button} disabled={!draft} onClick={() => {
        try { buildEvidenceDraft(request); downloadBrowserText(JSON.stringify(request, null, 2) + "\n", "private-evidence-draft.json", "application/json"); setMessage(copy.download.backupSuccess); }
        catch { setMessage(copy.download.backupRefused); }
      }}>{copy.download.backup}</button>
      <button type="button" className={button} onClick={() => { setEditors(empty()); setReportJson(""); setReviewer(""); setMessage(copy.workspace.cleared); }}>{copy.workspace.clear}</button></div>
    <p role="status" aria-live="polite" className="font-serif text-sm text-seal">{message}</p>
  </section>;
}
