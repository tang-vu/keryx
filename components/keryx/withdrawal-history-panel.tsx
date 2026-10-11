"use client";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";
import { readWithdrawalBrowserHistory } from "@/lib/gateway/withdrawal-browser-history";
import type { WithdrawalHistoryEntry, WithdrawalHistoryPage } from "@/lib/gateway/withdrawal-history-types";
import { readWithdrawalHistoryStatus } from "@/lib/gateway/withdrawal-history-status";
import { WithdrawalHistoryProgress, type HistoryProgress } from "./withdrawal-history-progress";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

const button = "rounded border border-current px-3 py-2 text-sm disabled:opacity-50";

/** Private, read-only server metadata. Remount on account changes, with no dependency
 * on retained local drafts and no controls that create another authorization. */
export function WithdrawalHistoryPanel({ address }: { address: string }) {
  const parsed = withdrawalOwnerSchema.safeParse(address);
  return parsed.success ? <OwnerHistory key={parsed.data} owner={parsed.data} /> : <p>{uiCopy("withdrawalHistory.signIn")}</p>;
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
        setPage(null); setProgress({}); setSignedOut(true); setMessage(uiCopy("withdrawalHistory.signInAgain")); return;
      }
      const rows = more ? [...page!.requests, ...result.page.requests] : result.page.requests;
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error();
      setPage({ requests: rows, nextCursor: result.page.nextCursor }); setSignedOut(false);
    } catch {
      if (!controller.signal.aborted) setMessage(uiCopy("withdrawalHistory.loadFailed"));
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
        setPage(null); setProgress({}); setSignedOut(true); setMessage(uiCopy("withdrawalHistory.signInAgain"));
      } else setProgress(previous => ({ ...previous, [row.id]: result }));
    } catch {
      if (!controller.signal.aborted) setProgress(previous => ({ ...previous, [row.id]: { state: "read-failed" } }));
    } finally {
      if (active.current === controller && !controller.signal.aborted) { gate.current = false; setBusy(false); setChecking(null); }
    }
  };

  return <section aria-label={uiCopy("withdrawalHistory.aria")} className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">{uiCopy("withdrawalHistory.title")}</h2>
    <p className="text-sm">{uiCopy("withdrawalHistory.boundary")}</p>
    <button type="button" className={button} disabled={busy} onClick={() => void load(false)}>
      {page ? uiCopy("withdrawalHistory.refresh") : uiCopy("withdrawalHistory.load")}
    </button>
    {signedOut && <a href="/connect" className="ml-3 underline">{uiCopy("withdrawalHistory.connect")}</a>}
    <p role="status" aria-live="polite">{busy ? checking ? uiCopy("withdrawalHistory.checking") : uiCopy("withdrawalHistory.loading") : message}</p>
    {page?.requests.length === 0 && <p>{uiCopy("withdrawalHistory.empty")}</p>}
    {page && page.requests.length > 0 && <ul className="space-y-3">
      {page.requests.map(row => <li key={row.id} className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">{uiCopy("withdrawalHistory.amount", { amount: formatUnits(BigInt(row.amountMicros), 6) })}</p>
        <p>{uiCopy("withdrawalHistory.fee", { fee: formatUnits(BigInt(row.maxFeeMicros), 6) })}</p>
        <p className="break-all">{uiCopy("withdrawalHistory.recipient", { recipient: row.recipient })}</p>
        <p>{uiRichCopy("withdrawalHistory.saved", { time: <time dateTime={row.createdAt}>{new Date(row.createdAt).toISOString()}</time> })}</p>
        <p className="break-all">{uiCopy("withdrawalHistory.request", { id: row.id })}</p>
        <WithdrawalHistoryProgress result={progress[row.id]} />
        <button type="button" className={button} disabled={busy} onClick={() => void check(row)}>{uiCopy("withdrawalHistory.check")}</button>
      </li>)}
    </ul>}
    {page?.nextCursor && <button type="button" className={button} disabled={busy} onClick={() => void load(true)}>{uiCopy("withdrawalHistory.older")}</button>}
  </section>;
}
