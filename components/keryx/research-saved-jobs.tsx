"use client";
import { DisplayTime } from "@/components/keryx/display-time";

import { createMessages } from "@/lib/i18n/messages";

import { useEffect, useState } from "react";
import { listBrowserJournals, importBrowserJournal, exportBrowserJournal, deleteBrowserJournal, type BrowserJournal } from "@/lib/buyer/browser-journal";
import { resumeBrowserResearch } from "@/lib/buyer/browser-client";
import { downloadBuyerJson } from "@/lib/buyer/download";
import { useResearchWorkspace } from "./research-workspace";
import { ResearchJobDetails } from "./research-job-details";

const message = createMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
type Result = Awaited<ReturnType<typeof resumeBrowserResearch>>;

export function ResearchSavedJobs() {
  const { selection, revision, select, refresh } = useResearchWorkspace();
  const [rows, setRows] = useState<BrowserJournal[]>([]);
  const [storageError, setStorageError] = useState("");
  const [lookup, setLookup] = useState<{ key: string; result: Result | null; error: string } | null>(null);
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
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

  function open(id: string) { setLookup(null); setActionError(null); setRemoval(null); select(id); }
  const key = selection ? `${selection.id}:${selection.revision}` : "";
  const visible = lookup?.key === key ? lookup.result : null;
  const loading = !!selection && lookup?.key !== key;
  const error = actionError?.key === key ? actionError.message : lookup?.key === key ? lookup.error : "";
  const setError = (message: string) => setActionError({ key, message });

  return <section aria-labelledby="saved-jobs-heading" className="border border-line bg-paper p-6">
    <h2 id="saved-jobs-heading" className="font-display text-3xl">{message("savedResearch.title")}</h2>
    <p className="mt-3 font-serif text-sm text-ink-3">{message("savedResearch.privacyNotice")}</p>
    <p className="mt-2 font-serif text-sm text-ink-3">{message("savedResearch.acknowledgementNotice")}</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className={control} onClick={refresh}>{message("savedResearch.refresh")}</button>
      <label className={`${control} cursor-pointer`}>{message("savedResearch.import")}<input type="file" accept="application/json,.json" className="sr-only" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        try {
          if (file.size > 65536) throw new Error("Recovery file too large");
          const row = await importBrowserJournal(await file.text()); setStorageError(""); open(row.queryId);
        } catch { setStorageError(message("savedResearch.importFailed")); }
      }} /></label>
    </div>
    {storageError && <p role="alert" className="mt-3 font-serif text-seal">{storageError}</p>}
    {!rows.length && !storageError && <p className="mt-4 font-serif text-sm">{message("savedResearch.empty")}</p>}
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">{rows.map(row => <li key={row.queryId}><button type="button" onClick={() => open(row.queryId)} aria-pressed={selection?.id === row.queryId} className="h-full w-full border border-line p-4 text-left aria-pressed:border-ink">
      <span className="block break-words font-serif">{row.intent.request.question}</span>
      <span className="mt-2 block font-mono text-xs text-ink-3">{row.intent.request.researchMode} · {<DisplayTime value={row.createdAt} />} · {row.origin === "imported" ? message("savedResearch.imported") : row.submission === "prepared" ? message("savedResearch.prepared") : message("savedResearch.submissionRecorded")}</span>
    </button></li>)}</ul>
    {selection && <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={control} onClick={() => open(selection.id)}>{message("savedResearch.refreshJob")}</button>
        <button type="button" className={control} onClick={() => {
          void exportBrowserJournal(selection.id).then(text => downloadBuyerJson(text, "recovery"), () => setError(message("savedResearch.exportFailed")));
        }}>{message("savedResearch.export")}</button>
        <button type="button" className={control} onClick={() => setRemoval(selection.id)}>{message("savedResearch.remove")}</button>
        <button type="button" className={control} onClick={() => { select(null); setLookup(null); setActionError(null); setRemoval(null); }}>{message("savedResearch.close")}</button>
      </div>
      {removal === selection.id && <div className="mt-4 border border-seal p-4">
        <p className="font-serif text-sm">{message("savedResearch.removalBoundary")}</p>
        <button type="button" className={`${control} mt-3`} onClick={() => {
          void deleteBrowserJournal(selection.id).then(() => { select(null); setLookup(null); setRemoval(null); }, () => setError(message("savedResearch.removalFailed")));
        }}>{message("savedResearch.confirmRemoval")}</button>
      </div>}
      <p role="status" aria-live="polite" className="mt-4 font-mono text-xs">{loading ? message("savedResearch.loading") : visible?.status.replaceAll("_", " ")}</p>
      {error && <p role="alert" className="mt-3 font-serif text-seal">{error}</p>}
      {visible && <>
        <p className="mt-3 font-serif text-sm">{visible.payment.state === "seller_reported_settled" ? message("savedResearch.sellerAcknowledged") : message("savedResearch.noAcknowledgement")}</p>
        {visible.status === "not_found_uncertain" ? <p className="mt-3 font-serif text-seal">{message("savedResearch.notFoundUncertain")}</p> : <>
          {"verification" in visible && visible.verification && <p className="mt-3 font-serif text-sm">{message("savedResearch.integrityNotice")}</p>}
          <ResearchJobDetails job={visible} onDownloadReceipt={"receipt" in visible ? () => downloadBuyerJson(JSON.stringify(visible.receipt, null, 2) + "\n", "receipt") : undefined} />
        </>}
      </>}
    </div>}
  </section>;
}
