"use client";
import { formatAmount } from "@/lib/i18n/format";


import { useEffect, useRef, useState } from "react";
import { type PublicClient } from "viem";
import { inspectPastGatewayDeposit, type PastGatewayDeposit } from "@/lib/buyer/funding-activity";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { useUiMessages } from "@/lib/i18n/ui-copy";





/** Parent keys this panel by payer so an account switch discards old observations. */
export function ResearchFundingActivity({ payer, chain }: { payer: string; chain?: PublicClient }) {
  const copy = useUiMessages();
  const [hash, setHash] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [observed, setObserved] = useState<PastGatewayDeposit | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort(); }, []);
  async function inspect() {
    if (!chain || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(false); setObserved(null);
    try {
      const result = await inspectPastGatewayDeposit(payer, hash.trim(), chain, controller.signal);
      if (!controller.signal.aborted) setObserved(result);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); operation.current = null; }
  }
  return <section className="mt-4 space-y-3 border-t border-line pt-4" aria-label={copy("fundingActivity.label")}>
    <h3 className="font-mono text-xs">{copy("fundingActivity.title")}</h3>
    <p className="font-serif text-sm">{copy("fundingActivity.recoveryNotice")}</p>
    <label className="grid gap-2 font-serif text-sm">{copy("fundingActivity.hash")}<input value={hash} disabled={busy} onChange={event => { setHash(event.target.value); setObserved(null); setError(false); }} autoComplete="off" spellCheck={false} className="min-w-0 border border-line bg-paper p-2 font-mono text-xs" /></label>
    <button type="button" disabled={busy || !chain || !/^0x[a-fA-F0-9]{64}$/.test(hash.trim())} onClick={() => { void inspect(); }} className="border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{busy ? copy("fundingActivity.checking") : copy("fundingActivity.check")}</button>
    {error && <p role="status" className="font-serif text-sm">{copy("fundingActivity.unknown")}</p>}
    {observed && <div role="status" className="space-y-2 font-serif text-sm">
      <p>{copy(observed.status === "success" ? "fundingActivity.successfulCall" : "fundingActivity.revertedCall", { amount: formatAmount(BigInt(observed.amountMicros), { minimumFractionDigits: 6, useGrouping: false }) })}</p>
      <p>{observed.status === "success" ? copy("fundingActivity.pastDeposit") : copy("fundingActivity.reverted")}</p>
      <a className="break-all font-mono text-xs underline" href={`${browserPaymentProfile().explorerUrl}/tx/${observed.hash}`} target="_blank" rel="noreferrer">{copy("fundingActivity.viewTransaction")}</a>
    </div>}
    <p className="font-serif text-xs text-ink-3">{copy("fundingActivity.missingNotice")}</p>
  </section>;
}
