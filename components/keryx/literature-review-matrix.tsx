"use client";

import { useId, useRef, useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { emptyMatrixRow, literatureMatrixCsv, MATRIX_FIELDS, MAX_MATRIX_CELL_CHARS, MAX_MATRIX_ROWS, type MatrixField, type MatrixRow } from "@/lib/research-tools/literature-matrix";
import { researchGuidesCopy } from "@/locales/en/research-guides";

const fieldClass = "mt-2 block min-h-11 w-full min-w-0 rounded-none border border-line bg-paper-2 px-3 py-2 font-serif text-base text-ink";
const buttonBase = "inline-flex min-h-11 items-center justify-center border border-ink px-4 py-2 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seal disabled:opacity-50";
const buttonClass = `${buttonBase} text-seal hover:bg-panel`;

export function LiteratureReviewMatrix() {
  const { tool: copy } = useUiCopy("research-guides", researchGuidesCopy);
  const [question, setQuestion] = useState("");
  const [rows, setRows] = useState<{ id: number; value: MatrixRow }[]>([]);
  const [status, setStatus] = useState("");
  const nextId = useRef(1);
  const addButton = useRef<HTMLButtonElement>(null);
  const prefix = useId();
  const csv = () => literatureMatrixCsv(question, rows.map(row => row.value));
  function edit(id: number, field: MatrixField, value: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, value: { ...row.value, [field]: value } } : row)); setStatus("");
  }
  return <section aria-labelledby="matrix-heading" className="mt-8 border border-ink bg-paper p-4 sm:p-7">
    <h2 id="matrix-heading" className="font-display text-2xl text-ink">{copy.title}</h2>
    <p className="mt-3 max-w-[78ch] font-serif leading-relaxed text-ink-2">{copy.localNotice}</p>
    <div className="mt-6 font-mono text-xs text-ink-2"><label htmlFor={`${prefix}-question`}>{copy.question}</label>
      <textarea id={`${prefix}-question`} maxLength={MAX_MATRIX_CELL_CHARS} rows={2} value={question} placeholder={copy.questionPlaceholder} onChange={event => { setQuestion(event.target.value); setStatus(""); }} className={fieldClass} />
    </div>
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" className={`${buttonBase} bg-seal text-paper hover:bg-ink`} onClick={() => {
        downloadBrowserText(csv(), "literature-review-matrix.csv", "text/csv;charset=utf-8"); setStatus(copy.downloaded);
      }}>{copy.download}</button>
      <button type="button" className={buttonClass} onClick={() => {
        downloadBrowserText(literatureMatrixCsv("", []), "literature-review-matrix-template.csv", "text/csv;charset=utf-8"); setStatus(copy.downloaded);
      }}>{copy.template}</button>
      <button type="button" className={buttonClass} onClick={async () => {
        try { await navigator.clipboard.writeText(csv()); setStatus(copy.copied); } catch { setStatus(copy.copyFailed); }
      }}>{copy.copy}</button>
    </div>
    <p role="status" aria-live="polite" className="mt-3 min-h-6 font-serif text-sm text-seal">{status}</p>
    <p className="mt-2 font-mono text-xs text-ink-3">{copy.countLabel}: {rows.length} / {MAX_MATRIX_ROWS}</p>
    {!rows.length && <p className="mt-5 border-l-2 border-seal pl-4 font-serif text-ink-2">{copy.empty}</p>}
    <div className="mt-5 space-y-5">{rows.map((row, index) => <fieldset key={row.id} className="min-w-0 border border-line px-4 pb-5">
      <legend className="px-2 font-mono text-xs text-ink-3">{copy.sourceNumber} {index + 1}</legend>
      <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">{MATRIX_FIELDS.map(field => <div key={field} className="min-w-0 font-mono text-xs text-ink-2">
        <label htmlFor={`${prefix}-${row.id}-${field}`}>{copy.columns[field]}</label>
        <textarea id={`${prefix}-${row.id}-${field}`} rows={field === "finding" || field === "limitation" ? 3 : 2} maxLength={MAX_MATRIX_CELL_CHARS} value={row.value[field]} onChange={event => edit(row.id, field, event.target.value)} className={fieldClass} />
      </div>)}</div>
      <button type="button" className={`${buttonClass} mt-4`} onClick={() => {
        setRows(current => current.filter(item => item.id !== row.id)); setStatus(""); addButton.current?.focus();
      }}>{copy.remove} {index + 1}</button>
    </fieldset>)}</div>
    <button ref={addButton} type="button" disabled={rows.length >= MAX_MATRIX_ROWS} className={`${buttonClass} mt-5`} onClick={() => {
      const id = nextId.current++; setRows(current => current.length >= MAX_MATRIX_ROWS ? current : [...current, { id, value: emptyMatrixRow() }]); setStatus("");
    }}>{copy.add}</button>
    {rows.length >= MAX_MATRIX_ROWS && <p className="mt-3 font-serif text-sm text-ink-3">{copy.limit}</p>}
    <p className="mt-5 max-w-[80ch] font-serif text-sm leading-relaxed text-ink-3">{copy.exportNotice}</p>
  </section>;
}
