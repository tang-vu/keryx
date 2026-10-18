"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits, type PublicClient } from "viem";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { recoverFundingReplacement } from "@/lib/buyer/funding-client";
import { reviewFundingCancellation, submitFundingCancellation } from "@/lib/buyer/funding-cancellation";
import type { FundingCancellationQuote, FundingRecord } from "@/lib/buyer/funding-policy";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { fundingCancellationCopy } from "@/locales/en/funding-cancellation";
import { CIRCLE_GOOGLE_CONNECTOR_ID } from "@/lib/circle-wallet-config";
import { listCircleWalletRecoveryTransactions } from "@/lib/circle-wallet-browser";
import { CIRCLE_RECOVERY_WINDOW_MS, type CircleRecoveryPage, type CircleRecoveryQuery } from "@/lib/circle-wallet-recovery";

/** An explicit owner action, separate from the read-only original receipt inspector. */
export function FundingCancellation({ record, chain, refresh, onResolved }: { record: FundingRecord; chain?: PublicClient; refresh(): Promise<void>; onResolved(message: string): void }) {
  const copy = useUiCopy("funding-cancellation", fundingCancellationCopy);
  const { data: wallet } = useWalletClient({ chainId: browserPaymentProfile().chainId });
  const { connector } = useAccount();
  const circle = connector?.id === CIRCLE_GOOGLE_CONNECTOR_ID;
  const [quote, setQuote] = useState<FundingCancellationQuote | null>(null), [consent, setConsent] = useState(false);
  const [history, setHistory] = useState<CircleRecoveryPage | null>(null), [pages, setPages] = useState(0);
  const seenCursors = useRef(new Set<string>());
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const working = useRef(false), live = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { setQuote(null); setConsent(false); setHistory(null); setPages(0); seenCursors.current.clear(); }, [record.updatedAt, wallet, circle]);
  useEffect(() => () => { controller.current?.abort(); }, [wallet, circle]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (working.current || !chain) return;
    working.current = true; setBusy(true); setMessage(""); controller.current = new AbortController();
    try { await action(controller.current.signal); }
    catch { if (live.current) { setQuote(null); setConsent(false); setMessage(circle ? copy.historyHeld : copy.pending); } }
    finally {
      if (live.current) { await refresh().catch(() => {}); setBusy(false); }
      working.current = false;
    }
  }

  async function inspectCircle(next = false) {
    await run(async signal => {
      try {
        const from = new Date(Date.parse(record.createdAt) - 5 * 60_000).toISOString();
        const query: CircleRecoveryQuery = next && history?.nextPageAfter
          ? { from: history.from, to: history.to, pageAfter: history.nextPageAfter }
          : { from, to: new Date(Math.min(Date.now(), Date.parse(from) + CIRCLE_RECOVERY_WINDOW_MS)).toISOString() };
        const page = await listCircleWalletRecoveryTransactions(record.payer, query, signal);
        if (next && page.nextPageAfter && (seenCursors.current.has(page.nextPageAfter) || page.nextPageAfter === query.pageAfter)) throw new Error("Repeated history cursor");
        if (live.current) {
          if (!next) seenCursors.current.clear();
          if (query.pageAfter) seenCursors.current.add(query.pageAfter);
          setHistory(page); setPages(count => next ? count + 1 : 1); setMessage(copy.historyHeld);
        }
      } catch { if (live.current) setMessage(copy.historyUnavailable); }
    });
  }

  return <section className="space-y-3 border-t border-line pt-3" aria-label={copy.title}>
    <h4 className="font-serif text-sm">{copy.title}</h4>
    <p className="text-xs">{circle ? copy.circleUnsupported : copy.explanation}</p>
    {circle ? <div className="space-y-2 text-xs">
      <button type="button" disabled={busy || !chain || !wallet} className="min-h-11 border border-ink px-3 disabled:opacity-40" onClick={() => { void inspectCircle(); }}>{copy.historySearch}</button>
      {history && <>
        <p>{copy.historyWindow}: {history.from} — {history.to}</p>
        {!history.transactions.some(tx => tx.hash) && <p>{copy.historyEmpty}</p>}
        {history.transactions.map(tx => <div key={tx.id} className="space-y-2 border-t border-line pt-2">
          <p className="break-all font-mono">{copy.circleTransaction}: {tx.id}</p>
          <p>{copy.historyStatus}: {tx.status}</p>
          {tx.hash && <>
            <a className="block break-all font-mono underline" href={`${browserPaymentProfile().explorerUrl}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash}</a>
            <button type="button" disabled={busy || !chain} className="min-h-11 border border-ink px-3 disabled:opacity-40" onClick={() => {
              void run(async signal => {
                const result = await recoverFundingReplacement(record.id, "approval", chain!, tx.hash!, signal);
                if (live.current) onResolved(result.approval.status === "replaced" ? copy.replaced : copy.original);
              });
            }}>{copy.historyVerify}</button>
          </>}
        </div>)}
        {history.nextPageAfter && pages < 5 && <button type="button" disabled={busy} className="min-h-11 border border-ink px-3 disabled:opacity-40" onClick={() => { void inspectCircle(true); }}>{copy.historyNext}</button>}
        {history.nextPageAfter && pages >= 5 && <p>{copy.historyLimit}</p>}
      </>}
    </div> : <>
    <button type="button" disabled={busy || !chain || !wallet} className="min-h-11 border border-ink px-3 text-xs disabled:opacity-40" onClick={() => {
      void run(async signal => {
        const reviewed = await reviewFundingCancellation(record.id, wallet!, chain!, signal);
        if (live.current) { setQuote(reviewed); setConsent(false); }
      });
    }}>{copy.review}</button>
    {quote && <div className="space-y-2 text-xs">
      <p className="break-all">{copy.owner}: <span className="font-mono">{quote.payer}</span></p>
      <p>{copy.network}: {browserPaymentProfile().label} ({quote.chainId})</p>
      <p>{copy.nonce}: {quote.nonce}</p><p>{copy.amount}</p>
      <p>{copy.gas}: {quote.gas}</p><p>{copy.feeRate}: {quote.maxFeePerGas}</p><p>{copy.priority}: {quote.maxPriorityFeePerGas}</p>
      <p className="break-all font-mono">{copy.maxFee}: {formatUnits(BigInt(quote.gas) * BigInt(quote.maxFeePerGas), 18)}</p>
      <p>{copy.expires}: {new Date(quote.expiresAt).toISOString()}</p>
      <p>{copy.limitations}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />{copy.consent}</label>
      <button type="button" disabled={busy || !consent || !wallet || !chain} className="min-h-11 border border-ink px-3 text-xs disabled:opacity-40" onClick={() => {
        void run(async signal => {
          await submitFundingCancellation(quote, wallet!, chain!, signal);
          if (live.current) { setQuote(null); setConsent(false); setMessage(copy.submitted); }
        });
      }}>{copy.sign}</button>
    </div>}
    </>}
    {(record.approval.cancellations ?? []).filter(attempt => attempt.hash).map(attempt => <div key={attempt.quote.attemptId} className="space-y-2 text-xs">
      <a className="block break-all font-mono underline" href={`${browserPaymentProfile().explorerUrl}/tx/${attempt.hash}`} target="_blank" rel="noreferrer">{copy.hash}: {attempt.hash}</a>
      <button type="button" disabled={busy || !chain} className="min-h-11 border border-ink px-3 disabled:opacity-40" onClick={() => {
        void run(async signal => {
          const result = await recoverFundingReplacement(record.id, "approval", chain!, attempt.hash!, signal);
          if (live.current) onResolved(result.approval.status === "replaced" ? copy.replaced : copy.original);
        });
      }}>{copy.check}</button>
    </div>)}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
