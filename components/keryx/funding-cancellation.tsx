"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { formatUnits, type PublicClient } from "viem";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { recoverFundingReplacement } from "@/lib/buyer/funding-client";
import { reviewFundingCancellation, submitFundingCancellation } from "@/lib/buyer/funding-cancellation";
import type { FundingCancellationQuote, FundingRecord } from "@/lib/buyer/funding-policy";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { fundingCancellationCopy } from "@/locales/en/funding-cancellation";

/** An explicit owner action, separate from the read-only original receipt inspector. */
export function FundingCancellation({ record, chain, refresh, onResolved }: { record: FundingRecord; chain?: PublicClient; refresh(): Promise<void>; onResolved(message: string): void }) {
  const copy = useUiCopy("funding-cancellation", fundingCancellationCopy);
  const { data: wallet } = useWalletClient({ chainId: browserPaymentProfile().chainId });
  const [quote, setQuote] = useState<FundingCancellationQuote | null>(null), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const working = useRef(false), live = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { setQuote(null); setConsent(false); }, [record.updatedAt, wallet]);
  useEffect(() => () => { controller.current?.abort(); }, [wallet]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (working.current || !chain) return;
    working.current = true; setBusy(true); setMessage(""); controller.current = new AbortController();
    try { await action(controller.current.signal); }
    catch { if (live.current) { setQuote(null); setConsent(false); setMessage(copy.pending); } }
    finally {
      if (live.current) { await refresh().catch(() => {}); setBusy(false); }
      working.current = false;
    }
  }

  return <section className="space-y-3 border-t border-line pt-3" aria-label={copy.title}>
    <h4 className="font-serif text-sm">{copy.title}</h4>
    <p className="text-xs">{copy.explanation}</p>
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
