"use client";

import { useEffect, useState } from "react";
import { listBrowserJournals, importBrowserJournal, exportBrowserJournal, deleteBrowserJournal, type BrowserJournal } from "@/lib/buyer/browser-journal";
import { resumeBrowserResearch } from "@/lib/buyer/browser-client";
import { downloadBuyerJson } from "@/lib/buyer/download";
import { useResearchWorkspace } from "./research-workspace";
import { ResearchJobDetails } from "./research-job-details";

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
      if (active) setStorageError("Saved jobs could not be read. Check browser storage or import your private recovery file. No payment was made.");
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
          else setLookup({ key, result: next, error: "Automatic lookup paused. Refresh the same job to continue; no payment is needed." });
        }
      } catch {
        if (!abort.signal.aborted) setLookup(previous => ({ key, result: previous?.key === key ? previous.result : null,
          error: "Could not load or verify this job and receipt. Keep the recovery file and retry this job; do not submit another payment to recover it." }));
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
    <h2 id="saved-jobs-heading" className="font-display text-3xl">Saved research jobs</h2>
    <p className="mt-3 font-serif text-sm text-ink-3">Private recovery data is stored in this browser. Anyone using this browser profile can read it. A recovery file grants access to the job; keep it private. This is local history, not an account backup.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className={control} onClick={refresh}>Refresh saved jobs</button>
      <label className={`${control} cursor-pointer`}>Import recovery file<input type="file" accept="application/json,.json" className="sr-only" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        try {
          if (file.size > 65536) throw new Error("Recovery file too large");
          const row = await importBrowserJournal(await file.text()); setStorageError(""); open(row.queryId);
        } catch { setStorageError("Recovery file could not be imported. It must be an unmodified Keryx recovery file under 64 KB. If already saved, open the existing job below."); }
      }} /></label>
    </div>
    {storageError && <p role="alert" className="mt-3 font-serif text-seal">{storageError}</p>}
    {!rows.length && !storageError && <p className="mt-4 font-serif text-sm">No jobs saved here yet. Buy a job or import a CLI recovery file.</p>}
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">{rows.map(row => <li key={row.queryId}><button type="button" onClick={() => open(row.queryId)} aria-pressed={selection?.id === row.queryId} className="h-full w-full border border-line p-4 text-left aria-pressed:border-ink">
      <span className="block break-words font-serif">{row.intent.request.question}</span>
      <span className="mt-2 block font-mono text-xs text-ink-3">{row.intent.request.researchMode} · {new Date(row.createdAt).toLocaleString()} · {row.origin === "imported" ? "imported recovery" : row.submission === "prepared" ? "prepared locally" : "submission recorded"}</span>
    </button></li>)}</ul>
    {selection && <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={control} onClick={() => open(selection.id)}>Refresh this job</button>
        <button type="button" className={control} onClick={() => {
          void exportBrowserJournal(selection.id).then(text => downloadBuyerJson(text, "recovery"), () => setError("Recovery export failed. Keep this tab and try again."));
        }}>Export recovery file</button>
        <button type="button" className={control} onClick={() => setRemoval(selection.id)}>Remove local record</button>
        <button type="button" className={control} onClick={() => { select(null); setLookup(null); setActionError(null); setRemoval(null); }}>Close job</button>
      </div>
      {removal === selection.id && <div className="mt-4 border border-seal p-4">
        <p className="font-serif text-sm">Removal only deletes this browser record. It does not cancel work, revoke payment, create a refund or delete server data. Export the recovery file first if you need access later.</p>
        <button type="button" className={`${control} mt-3`} onClick={() => {
          void deleteBrowserJournal(selection.id).then(() => { select(null); setLookup(null); setRemoval(null); }, () => setError("Local removal failed. Try again."));
        }}>Confirm local removal</button>
      </div>}
      <p role="status" aria-live="polite" className="mt-4 font-mono text-xs">{loading ? "Looking up the original job…" : visible?.status.replaceAll("_", " ")}</p>
      {error && <p role="alert" className="mt-3 font-serif text-seal">{error}</p>}
      {visible && <>
        <p className="mt-3 font-serif text-sm">{visible.payment.state === "seller_reported_settled" ? "The seller acknowledged the payment; this is not independent settlement verification." : "No saved payment acknowledgement. This does not prove the payment failed."}</p>
        {visible.status === "not_found_uncertain" ? <p className="mt-3 font-serif text-seal">No order was found. A missing order does not prove no debit. Keep the recovery file for review; do not buy again to recover.</p> : <>
          {"verification" in visible && visible.verification && <p className="mt-3 font-serif text-sm">Receipt integrity and original-request binding verified locally. This does not certify research truth or independently verify settlement.</p>}
          <ResearchJobDetails job={visible} onDownloadReceipt={"receipt" in visible ? () => downloadBuyerJson(JSON.stringify(visible.receipt, null, 2) + "\n", "receipt") : undefined} />
        </>}
      </>}
    </div>}
  </section>;
}
