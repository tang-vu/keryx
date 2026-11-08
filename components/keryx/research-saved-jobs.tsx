"use client";
import { DisplayTime } from "@/components/keryx/display-time";



import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listBrowserJournals, importBrowserJournal, exportBrowserJournal, deleteBrowserJournal, type BrowserJournal } from "@/lib/buyer/browser-journal";
import { resumeBrowserResearch } from "@/lib/buyer/browser-client";
import { downloadBuyerJson } from "@/lib/buyer/download";
import { useResearchWorkspace } from "./research-workspace";
import { ResearchJobDetails } from "./research-job-details";
import { useUiMessages } from "@/lib/i18n/ui-copy";





const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
type Result = Awaited<ReturnType<typeof resumeBrowserResearch>>;
type LocalAction = "export" | "removal" | "receipt";

export function ResearchSavedJobs() {
  const message = useUiMessages();
  const { selection, revision, importSelection, select, beginImport, completeImport, clearSelection, refresh } = useResearchWorkspace();
  const [rows, setRows] = useState<BrowserJournal[]>([]);
  const [storageError, setStorageError] = useState("");
  const [importError, setImportError] = useState<{ attempt: symbol; message: string } | null>(null);
  const importState = useRef<{ active: boolean; attempt: symbol | null }>({ active: false, attempt: null });
  useLayoutEffect(() => {
    importState.current.active = true;
    return () => { importState.current.active = false; };
  }, []);
  const [lookup, setLookup] = useState<{ key: string; result: Result | null; error: string } | null>(null);
  const [removalError, setRemovalError] = useState<{ key: string; message: string } | null>(null);
  const [exportError, setExportError] = useState<{ key: string; message: string } | null>(null);
  const [receiptError, setReceiptError] = useState<{ key: string; message: string } | null>(null);
  const actions = useRef<{ selection: typeof selection; export: symbol | null; removal: symbol | null; receipt: symbol | null } | null>(null);
  useLayoutEffect(() => {
    // A reopened view of the same journal is a different feedback context.
    actions.current = { selection, export: null, removal: null, receipt: null };
    return () => { actions.current = null; };
  }, [selection]);
  const [removal, setRemoval] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listBrowserJournals().then(values => { if (active) { setRows(values); setStorageError(""); } }, () => {
      if (active) setStorageError(message("savedResearch.storageUnavailable"));
    });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    if (!selection) return;
    const id = selection.id;
    const key = `${id}:${selection.revision}`;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const started = Date.now();
    async function poll() {
      try {
        const next = await resumeBrowserResearch(id, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setLookup({ key, result: next, error: "" }); attempts++;
        if (next.status === "queued" || next.status === "processing") {
          if (attempts < 150 && Date.now() - started < 600_000) timer = setTimeout(poll, 4000);
          else setLookup({ key, result: next, error: message("savedResearch.lookupPaused") });
        }
      } catch {
        if (!abort.signal.aborted) setLookup(previous => ({ key, result: previous?.key === key ? previous.result : null,
          error: message("savedResearch.lookupFailed") }));
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [selection]);

  function open(id: string) { setLookup(null); setRemovalError(null); setExportError(null); setReceiptError(null); setRemoval(null); select(id); }
  const key = selection ? `${selection.id}:${selection.revision}` : "";
  const visible = lookup?.key === key ? lookup.result : null;
  const loading = !!selection && lookup?.key !== key;
  const error = removalError?.key === key ? removalError.message : lookup?.key === key ? lookup.error : "";
  function beginAction(kind: LocalAction) {
    const attempt = Symbol(kind), active = actions.current;
    if (active && active.selection === selection) active[kind] = attempt;
    if (kind === "export") setExportError(null); else if (kind === "removal") setRemovalError(null); else setReceiptError(null);
    return attempt;
  }
  function failAction(kind: LocalAction, expected: symbol, message: string) {
    const active = actions.current;
    if (!active || active.selection !== selection || active[kind] !== expected) return;
    // An older callback cannot erase another view's error or an unrelated
    // local operation's feedback. Storage effects remain owned by the operation.
    if (kind === "export") setExportError({ key, message }); else if (kind === "removal") setRemovalError({ key, message }); else setReceiptError({ key, message });
  }

  return <section aria-labelledby="saved-jobs-heading" className="border border-line bg-paper p-6">
    <h2 id="saved-jobs-heading" className="font-display text-3xl">{message("savedResearch.title")}</h2>
    <p className="mt-3 font-serif text-sm text-ink-3">{message("savedResearch.privacyNotice")}</p>
    <p className="mt-2 font-serif text-sm text-ink-3">{message("savedResearch.acknowledgementNotice")}</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className={control} onClick={refresh}>{message("savedResearch.refresh")}</button>
      <label className={`${control} cursor-pointer`}>{message("savedResearch.import")}<input type="file" accept="application/json,.json" className="sr-only" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        const attempt = beginImport(); importState.current.attempt = attempt; setImportError(null);
        try {
          if (file.size > 65536) throw new Error("Recovery file too large");
          const row = await importBrowserJournal(await file.text());
          if (importState.current.active) completeImport(row.queryId, attempt);
        } catch {
          if (importState.current.active && importState.current.attempt === attempt)
            setImportError({ attempt, message: message("savedResearch.importFailed") });
        }
      }} /></label>
    </div>
    {storageError && <p role="alert" className="mt-3 font-serif text-seal">{storageError}</p>}
    {importError && importError.attempt === importSelection && <p role="alert" className="mt-3 font-serif text-seal">{importError.message}</p>}
    {!rows.length && !storageError && <p className="mt-4 font-serif text-sm">{message("savedResearch.empty")}</p>}
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">{rows.map(row => <li key={row.queryId}><button type="button" onClick={() => open(row.queryId)} aria-pressed={selection?.id === row.queryId} className="h-full w-full border border-line p-4 text-left aria-pressed:border-ink">
      <span className="block break-words font-serif">{row.intent.request.question}</span>
      <span className="mt-2 block font-mono text-xs text-ink-3">{row.intent.request.researchMode} · {<DisplayTime value={row.createdAt} />} · {row.origin === "imported" ? message("savedResearch.imported") : row.submission === "prepared" ? message("savedResearch.prepared") : message("savedResearch.submissionRecorded")}</span>
    </button></li>)}</ul>
    {selection && <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={control} onClick={() => open(selection.id)}>{message("savedResearch.refreshJob")}</button>
        <button type="button" className={control} onClick={async () => {
          const attempt = beginAction("export");
          try { downloadBuyerJson(await exportBrowserJournal(selection.id), "recovery"); }
          catch { failAction("export", attempt, message("savedResearch.exportFailed")); }
        }}>{message("savedResearch.export")}</button>
        <button type="button" className={control} onClick={() => setRemoval(key)}>{message("savedResearch.remove")}</button>
        <button type="button" className={control} onClick={() => { select(null); setLookup(null); setRemovalError(null); setExportError(null); setReceiptError(null); setRemoval(null); }}>{message("savedResearch.close")}</button>
      </div>
      {removal === key && <div className="mt-4 border border-seal p-4">
        <p className="font-serif text-sm">{message("savedResearch.removalBoundary")}</p>
        <button type="button" className={`${control} mt-3`} onClick={() => {
          const attempt = beginAction("removal");
          void deleteBrowserJournal(selection.id).then(() => {
            clearSelection(selection);
            setLookup(previous => previous?.key === key ? null : previous);
            setRemoval(previous => previous === key ? null : previous);
          }, () => failAction("removal", attempt, message("savedResearch.removalFailed")));
        }}>{message("savedResearch.confirmRemoval")}</button>
      </div>}
      <p role="status" aria-live="polite" className="mt-4 font-mono text-xs">{loading ? message("savedResearch.loading") : visible?.status.replaceAll("_", " ")}</p>
      {error && <p role="alert" className="mt-3 font-serif text-seal">{error}</p>}
      {exportError?.key === key && <p role="alert" className="mt-3 font-serif text-seal">{exportError.message}</p>}
      {visible && <>
        <p className="mt-3 font-serif text-sm">{visible.payment.state === "seller_reported_settled" ? message("savedResearch.sellerAcknowledged") : message("savedResearch.noAcknowledgement")}</p>
        {visible.status === "not_found_uncertain" ? <p className="mt-3 font-serif text-seal">{message("savedResearch.notFoundUncertain")}</p> : <>
          {"verification" in visible && visible.verification && <p className="mt-3 font-serif text-sm">{message("savedResearch.integrityNotice")}</p>}
          <ResearchJobDetails job={visible} receiptDownloadError={receiptError?.key === key ? receiptError.message : undefined} onDownloadReceipt={"receipt" in visible ? () => {
            const attempt = beginAction("receipt");
            try { downloadBuyerJson(JSON.stringify(visible.receipt, null, 2) + "\n", "receipt"); }
            catch { failAction("receipt", attempt, message("evidenceMatrix.downloadUnavailable")); }
          } : undefined} />
        </>}
      </>}
    </div>}
  </section>;
}
