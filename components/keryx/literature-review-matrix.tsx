"use client";

import { useEffect, useId, useRef, useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { emptyMatrixRow, literatureMatrixCsv, MATRIX_FIELDS, MAX_MATRIX_CELL_CHARS, MAX_MATRIX_ROWS, type MatrixField, type MatrixRow } from "@/lib/research-tools/literature-matrix";
import { appendLiteratureMatrix, literatureMatrixJson, MatrixFileError, MAX_MATRIX_FILE_BYTES, readLiteratureMatrixFile, type MatrixDocument } from "@/lib/research-tools/literature-matrix-file";
import { researchGuidesCopy } from "@/locales/en/research-guides";

const fieldClass = "mt-2 block min-h-11 w-full min-w-0 rounded-none border border-line bg-paper-2 px-3 py-2 font-serif text-base text-ink";
const buttonBase = "inline-flex min-h-11 items-center justify-center border border-ink px-4 py-2 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal disabled:opacity-50";
const buttonClass = `${buttonBase} text-seal hover:bg-panel`;

export function LiteratureReviewMatrix() {
  const { tool: copy } = useUiCopy("research-guides", researchGuidesCopy);
  const [question, setQuestion] = useState("");
  const [rows, setRows] = useState<{ id: number; value: MatrixRow }[]>([]);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState<{ document: MatrixDocument; filename: string; kind: "csv" | "json"; revision: number }>();
  const [reading, setReading] = useState(false);
  const [revision, setRevision] = useState(0), [savedRevision, setSavedRevision] = useState(0);
  const currentRevision = useRef(0), importGeneration = useRef(0);
  const nextId = useRef(1);
  const addButton = useRef<HTMLButtonElement>(null);
  const prefix = useId();
  const csv = () => literatureMatrixCsv(question, rows.map(row => row.value));
  const snapshot = () => ({ question, rows: rows.map(row => row.value) });
  const hasNotes = question !== "" || rows.length > 0;
  useEffect(() => () => { ++importGeneration.current; }, []);
  useEffect(() => {
    if (!hasNotes || revision === savedRevision) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasNotes, revision, savedRevision]);
  function changed() {
    currentRevision.current++; setRevision(currentRevision.current); setStatus(""); setFailure("");
  }
  function edit(id: number, field: MatrixField, value: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, value: { ...row.value, [field]: value } } : row)); changed();
  }
  function download(content: string, filename: string, type: string, message: string, editable = false) {
    try {
      downloadBrowserText(content, filename, type);
      if (editable) setSavedRevision(currentRevision.current);
      setFailure(""); setStatus(message);
    } catch { setStatus(""); setFailure(copy.fileErrors.download); }
  }
  async function openFile(file: File) {
    const generation = ++importGeneration.current, baseRevision = currentRevision.current;
    setPending(undefined); setStatus(""); setFailure(""); setReading(true);
    try {
      if (file.size > MAX_MATRIX_FILE_BYTES) throw new MatrixFileError("size");
      const incoming = readLiteratureMatrixFile(new Uint8Array(await file.arrayBuffer()));
      if (generation !== importGeneration.current) return;
      setPending({ document: incoming, filename: file.name, kind: incoming.kind, revision: baseRevision });
    } catch (issue) {
      if (generation === importGeneration.current) setFailure(copy.fileErrors[issue instanceof MatrixFileError ? issue.issue : "read"]);
    } finally { if (generation === importGeneration.current) setReading(false); }
  }
  const stale = pending !== undefined && pending.revision !== revision;
  let appendIssue = "";
  if (pending) {
    try { appendLiteratureMatrix(snapshot(), pending.document); }
    catch (issue) { appendIssue = issue instanceof MatrixFileError && issue.issue === "questions" ? copy.appendQuestion : copy.appendCapacity; }
  }
  function applyImport(append: boolean) {
    if (!pending) return;
    if (pending.revision !== currentRevision.current) { setFailure(copy.staleImport); return; }
    let next: MatrixDocument;
    try { next = append ? appendLiteratureMatrix(snapshot(), pending.document) : pending.document; }
    catch { setFailure(appendIssue); return; }
    setQuestion(next.question); setRows(next.rows.map(value => ({ id: nextId.current++, value })));
    changed();
    if (!append) setSavedRevision(currentRevision.current);
    setPending(undefined); setStatus(append ? copy.appended : copy.loaded);
  }
  return <section aria-labelledby="matrix-heading" className="mt-8 border border-ink bg-paper p-4 sm:p-7">
    <h2 id="matrix-heading" className="font-display text-2xl text-ink">{copy.title}</h2>
    <p className="mt-3 max-w-[78ch] font-serif leading-relaxed text-ink-2">{copy.localNotice}</p>
    {hasNotes && revision !== savedRevision && <p className="mt-3 font-serif text-sm text-seal">{copy.unsaved}</p>}
    <div className="mt-6 font-mono text-xs text-ink-2"><label htmlFor={`${prefix}-question`}>{copy.question}</label>
      <textarea id={`${prefix}-question`} maxLength={MAX_MATRIX_CELL_CHARS} rows={2} value={question} placeholder={copy.questionPlaceholder} onChange={event => { setQuestion(event.target.value); changed(); }} className={fieldClass} />
    </div>
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" className={`${buttonBase} bg-seal text-paper hover:bg-ink`} onClick={() => {
        download(literatureMatrixJson(question, rows.map(row => row.value)), "literature-review-matrix.json", "application/json;charset=utf-8", copy.saved, true);
      }}>{copy.save}</button>
      <button type="button" className={buttonClass} onClick={() => {
        download(csv(), "literature-review-matrix.csv", "text/csv;charset=utf-8", copy.downloaded);
      }}>{copy.download}</button>
      <button type="button" className={buttonClass} onClick={() => {
        download(literatureMatrixCsv("", []), "literature-review-matrix-template.csv", "text/csv;charset=utf-8", copy.downloaded);
      }}>{copy.template}</button>
      <button type="button" className={buttonClass} onClick={async () => {
        setFailure(""); try { await navigator.clipboard.writeText(csv()); setStatus(copy.copied); } catch { setStatus(copy.copyFailed); }
      }}>{copy.copy}</button>
    </div>
    <p role={failure ? "alert" : "status"} aria-live="polite" className="mt-3 min-h-6 font-serif text-sm text-seal">{failure || status}</p>
    <div className="mt-4 border-y border-line py-4">
      <label htmlFor={`${prefix}-file`} className="block font-mono text-xs text-ink-2">{copy.open}</label>
      <input id={`${prefix}-file`} type="file" accept=".json,.csv,application/json,text/csv" className="mt-3 block min-h-11 w-full min-w-0 max-w-full font-serif text-sm text-ink-2 file:mr-3 file:min-h-11 file:border file:border-ink file:bg-paper-2 file:px-3 file:font-mono file:text-xs file:text-seal"
        aria-describedby={`${prefix}-file-help`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openFile(file); }} />
      <p id={`${prefix}-file-help`} className="mt-2 max-w-[78ch] font-serif text-sm leading-relaxed text-ink-3">{copy.fileHelp}</p>
      {reading && <p role="status" className="mt-3 font-serif text-seal">{copy.reading}</p>}
      {pending && <section aria-labelledby={`${prefix}-preview`} className="mt-4 min-w-0 border border-line bg-paper-2 p-4">
        <h3 id={`${prefix}-preview`} className="font-display text-xl text-ink">{copy.preview}</h3>
        <dl className="mt-3 space-y-2 break-words font-serif text-sm text-ink-2">
          <div><dt className="font-mono text-xs">{copy.fileName}</dt><dd>{pending.filename}</dd></div>
          <div><dt className="font-mono text-xs">{copy.importedQuestion}</dt><dd className="whitespace-pre-wrap">{pending.document.question || copy.noQuestion}</dd></div>
          <div><dt className="inline">{copy.incomingCount}: </dt><dd className="inline">{pending.document.rows.length}</dd></div>
          <div><dt className="inline">{copy.currentCount}: </dt><dd className="inline">{rows.length}</dd></div>
        </dl>
        {pending.document.rows.length > 0 && <><p className="mt-3 font-mono text-xs text-ink-2">{copy.previewSources}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 font-serif text-sm text-ink-2">{pending.document.rows.slice(0, 3).map((row, index) => <li key={index} className="break-words"><span className="line-clamp-2">{row.title || copy.untitledSource}</span></li>)}</ol>
        </>}
        <p className="mt-3 max-w-[75ch] font-serif text-sm leading-relaxed text-ink-2">{copy.replaceWarning}</p>
        <p className="mt-3 max-w-[75ch] font-serif text-sm leading-relaxed text-ink-3">{copy.appendNotice}</p>
        {pending.kind === "csv" && <p className="mt-3 max-w-[75ch] font-serif text-sm leading-relaxed text-ink-3">{copy.csvNotice}</p>}
        {(stale || appendIssue) && <p role="status" className="mt-3 font-serif text-sm text-seal">{stale ? copy.staleImport : appendIssue}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={buttonClass} disabled={stale || !!appendIssue || !pending.document.rows.length} onClick={() => applyImport(true)}>{copy.append}</button>
          <button type="button" className={buttonClass} disabled={stale} onClick={() => applyImport(false)}>{copy.replace}</button>
          <button type="button" className={buttonClass} onClick={() => { setPending(undefined); setFailure(""); }}>{copy.cancel}</button>
        </div>
      </section>}
    </div>
    <p className="mt-2 font-mono text-xs text-ink-3">{copy.countLabel}: {rows.length} / {MAX_MATRIX_ROWS}</p>
    {!rows.length && <p className="mt-5 border-l-2 border-seal pl-4 font-serif text-ink-2">{copy.empty}</p>}
    <div className="mt-5 space-y-5">{rows.map((row, index) => <fieldset key={row.id} className="min-w-0 border border-line px-4 pb-5">
      <legend className="px-2 font-mono text-xs text-ink-3">{copy.sourceNumber} {index + 1}</legend>
      <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">{MATRIX_FIELDS.map(field => <div key={field} className="min-w-0 font-mono text-xs text-ink-2">
        <label htmlFor={`${prefix}-${row.id}-${field}`}>{copy.columns[field]}</label>
        <textarea id={`${prefix}-${row.id}-${field}`} rows={field === "finding" || field === "limitation" ? 3 : 2} maxLength={MAX_MATRIX_CELL_CHARS} value={row.value[field]} onChange={event => edit(row.id, field, event.target.value)} className={fieldClass} />
      </div>)}</div>
      <button type="button" className={`${buttonClass} mt-4`} onClick={() => {
        setRows(current => current.filter(item => item.id !== row.id)); changed(); addButton.current?.focus();
      }}>{copy.remove} {index + 1}</button>
    </fieldset>)}</div>
    <button ref={addButton} type="button" disabled={rows.length >= MAX_MATRIX_ROWS} className={`${buttonClass} mt-5`} onClick={() => {
      const id = nextId.current++; setRows(current => current.length >= MAX_MATRIX_ROWS ? current : [...current, { id, value: emptyMatrixRow() }]); changed();
    }}>{copy.add}</button>
    {rows.length >= MAX_MATRIX_ROWS && <p className="mt-3 font-serif text-sm text-ink-3">{copy.limit}</p>}
    <p className="mt-5 max-w-[80ch] font-serif text-sm leading-relaxed text-ink-3">{copy.exportNotice}</p>
  </section>;
}
