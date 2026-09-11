"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";
import { listWithdrawalBrowserJournals } from "@/lib/gateway/withdrawal-browser-journal";
import { recoverWithdrawalBrowserStatus } from "@/lib/gateway/withdrawal-browser-flow";
import { exportWithdrawalRecoveryFile, importWithdrawalRecoveryFile } from "@/lib/gateway/withdrawal-recovery-file";

type Row = Awaited<ReturnType<typeof listWithdrawalBrowserJournals>>["requests"][number];
type Status = Awaited<ReturnType<typeof recoverWithdrawalBrowserStatus>>;
const button = "rounded border border-current px-3 py-2 text-sm disabled:opacity-50";

/** Mounted by the completed withdrawal workspace. A wallet change remounts all
 * local state and cancels pending reads; this panel never signs or submits payments. */
export function WithdrawalRecoveryPanel({ address }: { address: string }) {
  const parsed = withdrawalOwnerSchema.safeParse(address);
  return parsed.success ? <OwnerRecovery key={parsed.data} owner={parsed.data} /> : <p>Connect your wallet to recover withdrawals.</p>;
}
function OwnerRecovery({ owner }: { owner: string }) {
  const [rows, setRows] = useState<Row[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [unavailableCount, setUnavailableCount] = useState(0);
  const active = useRef<AbortController | null>(null), gate = useRef(false);
  const run = useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
    const controller = active.current;
    if (!controller || controller.signal.aborted || gate.current) return;
    gate.current = true; setBusy(true); setMessage("");
    try { await work(controller.signal); }
    catch { if (!controller.signal.aborted) setMessage("Recovery is unavailable. Keep your original request or recovery file and try checking again."); }
    finally { if (active.current === controller) { gate.current = false; if (!controller.signal.aborted) setBusy(false); } }
  }, []);
  const load = useCallback(async (signal: AbortSignal, afterId?: string) => {
    const page = await listWithdrawalBrowserJournals(owner, afterId); signal.throwIfAborted();
    setRows(previous => afterId ? [...previous, ...page.requests] : page.requests);
    setUnavailableCount(previous => afterId ? previous + page.unavailableCount : page.unavailableCount);
    setCursor(page.nextCursor); setLoaded(true);
  }, [owner]);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    void run(signal => load(signal));
    return () => { controller.abort(); gate.current = false; };
  }, [load, run]);
  const current = () => active.current?.signal.aborted === false ? owner : null;
  const check = (id: string) => run(async signal => {
    const result = await recoverWithdrawalBrowserStatus(id, owner, current, signal); signal.throwIfAborted();
    setStatuses(previous => ({ ...previous, [id]: result }));
  });
  const download = (id: string) => run(async signal => {
    const text = await exportWithdrawalRecoveryFile(id, owner, current, signal); signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "keryx-withdrawal-recovery.json";
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  const importFile = (file: File) => run(async signal => {
    if (file.size > 16384) throw new Error();
    const text = await file.text(); signal.throwIfAborted();
    await importWithdrawalRecoveryFile(text, owner, current, signal);
    await load(signal); signal.throwIfAborted();
    setMessage("Recovery file imported. It can check the original withdrawal, but cannot send it again.");
  });
  return <section aria-label="Withdrawal recovery" className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">Recover a withdrawal</h2>
    <p className="text-sm">Check a saved request or import its recovery file. Keep recovery files private: they contain a signed authorization.</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy} onClick={() => void run(signal => load(signal))}>Refresh saved requests</button>
      <label className="text-sm">Import recovery file <input aria-label="Import withdrawal recovery file" type="file" accept=".json,application/json"
        disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></label>
    </div>
    <p role="status" aria-live="polite" className="text-sm">{message || (busy ? "Checking saved withdrawal…" : "")}</p>
    {unavailableCount > 0 && <p role="alert">{unavailableCount} saved request(s) could not be read. Other requests remain available. Keep your recovery files; unreadable records have not been deleted.</p>}
    {loaded && rows.length === 0 && unavailableCount === 0 && <p>No withdrawal requests saved for this wallet in this browser. Import a recovery file if you have one.</p>}
    <ul className="space-y-3">{rows.map(row => <li key={row.id} className="space-y-2 rounded border p-3">
      <p className="font-medium">{formatUnits(BigInt(row.draft.burnIntent.spec.value), 6)} USDC</p>
      <p className="break-all text-xs">Request {row.id}</p>
      <p className="text-sm">{row.state === "reserved" ? "Unsigned draft" : row.origin === "imported" ? "Imported for recovery only" : "Signed original saved"}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void check(row.id)}>Check status</button>
        <button type="button" className={button} disabled={busy || !row.request} onClick={() => void download(row.id)}>Download private recovery file</button>
      </div>
      {statuses[row.id] && <RecoveryStatus result={statuses[row.id]} />}
    </li>)}</ul>
    {cursor && <button type="button" className={button} disabled={busy} onClick={() => void run(signal => load(signal, cursor))}>Load more saved requests</button>}
  </section>;
}
function RecoveryStatus({ result }: { result: Status }) {
  if (result.state === "authentication-required") return <p>Sign in with this wallet to check the withdrawal.</p>;
  if (result.state === "unavailable") return <p>No server record is available. Keep the original request; this does not mean it was never submitted.</p>;
  const progress = result.progress;
  if (progress.chainFinalityVerified) return <p>Mint observed as finalized on Arc Testnet. <a className="underline" target="_blank" rel="noopener noreferrer"
    href={`https://testnet.arcscan.app/tx/${progress.transactionHash}`}>View transaction</a></p>;
  const mint = { "not-checked": "Mint has not been checked.", "not-queued": "No mint is queued yet.",
    queued: "Mint is queued.", prepared: "Mint transaction is prepared; confirmation is not available yet." }[progress.mintStatus];
  return <p>{progress.status === "attestation-stored" ? "Transfer evidence is saved." : progress.status === "awaiting-transfer-evidence"
    ? "Waiting for transfer evidence." : "Request is saved."} {mint}</p>;
}
