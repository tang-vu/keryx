"use client";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { withdrawalRecoveryStatusCopy } from "@/lib/i18n/withdrawal-recovery-status";
import { formatUnits } from "viem";
import { withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";
import { listWithdrawalBrowserJournals } from "@/lib/gateway/withdrawal-browser-journal";
import { recoverWithdrawalBrowserStatus } from "@/lib/gateway/withdrawal-browser-flow";
import { exportWithdrawalRecoveryFile, importWithdrawalRecoveryFile } from "@/lib/gateway/withdrawal-recovery-file";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

type Row = Awaited<ReturnType<typeof listWithdrawalBrowserJournals>>["requests"][number];
type Status = Awaited<ReturnType<typeof recoverWithdrawalBrowserStatus>>;
const button = "rounded border border-current px-3 py-2 text-sm disabled:opacity-50";

/** Mounted by the completed withdrawal workspace. A wallet change remounts all
 * local state and cancels pending reads; this panel never signs or submits payments. */
export function WithdrawalRecoveryPanel({ address, onReview }: { address: string; onReview?: (id: string) => void }) {
  const parsed = withdrawalOwnerSchema.safeParse(address);
  return parsed.success ? <OwnerRecovery key={parsed.data} owner={parsed.data} onReview={onReview} /> : <p>{uiCopy("withdrawalRecovery.connect")}</p>;
}
function OwnerRecovery({ owner, onReview }: { owner: string; onReview?: (id: string) => void }) {
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
    catch { if (!controller.signal.aborted) setMessage(uiCopy("withdrawalRecovery.unavailable")); }
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
    setMessage(uiCopy("withdrawalRecovery.imported"));
  });
  return <section aria-label={uiCopy("withdrawalRecovery.aria")} className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">{uiCopy("withdrawalRecovery.title")}</h2>
    <p className="text-sm">{uiCopy("withdrawalRecovery.privacy")}</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy} onClick={() => void run(signal => load(signal))}>{uiCopy("withdrawalRecovery.refresh")}</button>
      <label className="text-sm">{uiCopy("withdrawalRecovery.import")} <input aria-label={uiCopy("withdrawalRecovery.importAria")} type="file" accept=".json,application/json"
        disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></label>
    </div>
    <p role="status" aria-live="polite" className="text-sm">{message || (busy ? uiCopy("withdrawalRecovery.checking") : "")}</p>
    {unavailableCount > 0 && <p role="alert">{uiCopy(unavailableCount === 1 ? "withdrawalRecovery.unreadable.one" : "withdrawalRecovery.unreadable.other", { count: unavailableCount })}</p>}
    {loaded && rows.length === 0 && unavailableCount === 0 && <p>{uiCopy("withdrawalRecovery.empty")}</p>}
    <ul className="space-y-3">{rows.map(row => <li key={row.id} className="space-y-2 rounded border p-3">
      <p className="font-medium">{formatUnits(BigInt(row.draft.burnIntent.spec.value), 6)} USDC</p>
      <p className="break-all text-xs">{uiCopy("withdrawalRecovery.request", { id: row.id })}</p>
      <p className="text-sm">{row.state === "reserved" ? uiCopy("withdrawalRecovery.draft") : row.origin === "imported" ? uiCopy("withdrawalRecovery.recoveryOnly") : uiCopy("withdrawalRecovery.signed")}</p>
      <div className="flex flex-wrap gap-2">
        {onReview && <button type="button" className={button} disabled={busy} onClick={() => onReview(row.id)}>{uiCopy("withdrawalRecovery.review")}</button>}
        <button type="button" className={button} disabled={busy} onClick={() => void check(row.id)}>{uiCopy("withdrawalRecovery.check")}</button>
        <button type="button" className={button} disabled={busy || !row.request} onClick={() => void download(row.id)}>{uiCopy("withdrawalRecovery.download")}</button>
      </div>
      {statuses[row.id] && <RecoveryStatus result={statuses[row.id]} />}
    </li>)}</ul>
    {cursor && <button type="button" className={button} disabled={busy} onClick={() => void run(signal => load(signal, cursor))}>{uiCopy("withdrawalRecovery.more")}</button>}
  </section>;
}
function RecoveryStatus({ result }: { result: Status }) {
  if (result.state === "authentication-required") return <p>{uiCopy("withdrawalRecovery.signIn")}</p>;
  if (result.state === "unavailable") return <p>{uiCopy("withdrawalRecovery.serverUnavailable")}</p>;
  const progress = result.progress;
  if (progress.chainFinalityVerified) return <p>{uiRichCopy("withdrawalRecovery.finalized", { transactionLink: <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://testnet.arcscan.app/tx/${progress.transactionHash}`}>{uiCopy("withdrawalRecovery.transaction")}</a> })}</p>;
  return <p>{withdrawalRecoveryStatusCopy(progress)}</p>;
}
