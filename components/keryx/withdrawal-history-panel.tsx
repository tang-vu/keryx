"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";
import { readWithdrawalBrowserHistory } from "@/lib/gateway/withdrawal-browser-history";
import type { WithdrawalHistoryEntry, WithdrawalHistoryPage } from "@/lib/gateway/withdrawal-history-types";
import { readWithdrawalHistoryStatus } from "@/lib/gateway/withdrawal-history-status";
import { WithdrawalHistoryProgress, type HistoryProgress } from "./withdrawal-history-progress";

const button = "rounded border border-current px-3 py-2 text-sm disabled:opacity-50";

/** Private, read-only server metadata. Remount on account changes, with no dependency
 * on retained local drafts and no controls that create another authorization. */
export function WithdrawalHistoryPanel({ address }: { address: string }) {
  const parsed = withdrawalOwnerSchema.safeParse(address);
  return parsed.success ? <OwnerHistory key={parsed.data} owner={parsed.data} /> : <p>Sign in to view withdrawal history.</p>;
}

function OwnerHistory({ owner }: { owner: string }) {
  const [page, setPage] = useState<WithdrawalHistoryPage | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [progress, setProgress] = useState<Record<string, HistoryProgress>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    return () => { controller.abort(); gate.current = false; };
  }, []);

  const load = async (more: boolean) => {
    const controller = active.current;
    if (!controller || controller.signal.aborted || gate.current || (more && !page?.nextCursor)) return;
    gate.current = true; setBusy(true); setMessage("");
    try {
      const result = await readWithdrawalBrowserHistory(owner, () => !controller.signal.aborted ? owner : null,
        controller.signal, more ? page!.nextCursor! : undefined);
      controller.signal.throwIfAborted();
      if (result.state === "authentication-required") {
        setPage(null); setProgress({}); setSignedOut(true); setMessage("Sign in again to view withdrawal history."); return;
      }
      const rows = more ? [...page!.requests, ...result.page.requests] : result.page.requests;
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error();
      setPage({ requests: rows, nextCursor: result.page.nextCursor }); setSignedOut(false);
    } catch {
      if (!controller.signal.aborted) setMessage("History could not be loaded. Try again; your saved requests have not been changed.");
    } finally {
      if (active.current === controller && !controller.signal.aborted) { gate.current = false; setBusy(false); }
    }
  };

  const check = async (row: WithdrawalHistoryEntry) => {
    const controller = active.current;
    if (!controller || controller.signal.aborted || gate.current) return;
    gate.current = true; setBusy(true); setChecking(row.id); setMessage("");
    try {
      const result = await readWithdrawalHistoryStatus(row, () => !controller.signal.aborted ? owner : null, controller.signal);
      controller.signal.throwIfAborted();
      if (result.state === "authentication-required") {
        setPage(null); setProgress({}); setSignedOut(true); setMessage("Sign in again to view withdrawal history.");
      } else setProgress(previous => ({ ...previous, [row.id]: result }));
    } catch {
      if (!controller.signal.aborted) setProgress(previous => ({ ...previous, [row.id]: { state: "read-failed" } }));
    } finally {
      if (active.current === controller && !controller.signal.aborted) { gate.current = false; setBusy(false); setChecking(null); }
    }
  };

  return <section aria-label="Server withdrawal history" className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">Withdrawal request history</h2>
    <p className="text-sm">Find requests saved to your account, including from another browser. These records do not confirm that funds reached your wallet.</p>
    <button type="button" className={button} disabled={busy} onClick={() => void load(false)}>
      {page ? "Refresh account history" : "Load account history"}
    </button>
    {signedOut && <a href="/connect" className="ml-3 underline">Sign in</a>}
    <p role="status" aria-live="polite">{busy ? checking ? "Checking request progress…" : "Loading account history…" : message}</p>
    {page?.requests.length === 0 && <p>No withdrawal requests have been saved to this account.</p>}
    {page && page.requests.length > 0 && <ul className="space-y-3">
      {page.requests.map(row => <li key={row.id} className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">Requested: {formatUnits(BigInt(row.amountMicros), 6)} USDC</p>
        <p>Maximum Circle fee: {formatUnits(BigInt(row.maxFeeMicros), 6)} USDC</p>
        <p className="break-all">Recipient: {row.recipient}</p>
        <p>Saved: <time dateTime={row.createdAt}>{new Date(row.createdAt).toISOString()}</time></p>
        <p className="break-all">Request ID: {row.id}</p>
        <WithdrawalHistoryProgress result={progress[row.id]} />
        <button type="button" className={button} disabled={busy} onClick={() => void check(row)}>Check progress</button>
      </li>)}
    </ul>}
    {page?.nextCursor && <button type="button" className={button} disabled={busy} onClick={() => void load(true)}>Load older requests</button>}
  </section>;
}
