"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, type PublicClient } from "viem";
import { inspectPastGatewayDeposit, type PastGatewayDeposit } from "@/lib/buyer/funding-activity";

/** Parent keys this panel by payer so an account switch discards old observations. */
export function ResearchFundingActivity({ payer, chain }: { payer: string; chain?: PublicClient }) {
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
  return <section className="mt-4 space-y-3 border-t border-line pt-4" aria-label="Previous Gateway deposit">
    <h3 className="font-mono text-xs">Find a previous deposit</h3>
    <p className="font-serif text-sm">Lost this browser&apos;s funding records? Copy a deposit transaction hash from your wallet activity to check it here. This lookup sends no transaction and does not restore a signing plan.</p>
    <label className="grid gap-2 font-serif text-sm">Previous deposit transaction hash<input value={hash} disabled={busy} onChange={event => { setHash(event.target.value); setObserved(null); setError(false); }} autoComplete="off" spellCheck={false} className="min-w-0 border border-line bg-paper p-2 font-mono text-xs" /></label>
    <button type="button" disabled={busy || !chain || !/^0x[a-fA-F0-9]{64}$/.test(hash.trim())} onClick={() => { void inspect(); }} className="border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{busy ? "Checking previous deposit…" : "Check previous deposit"}</button>
    {error && <p role="status" className="font-serif text-sm">Could not verify a finalized USDC deposit call for this wallet. This does not mean it failed. Check wallet activity and current Gateway balance before adding funds.</p>}
    {observed && <div role="status" className="space-y-2 font-serif text-sm">
      <p>{observed.status === "success" ? "Successful" : "Reverted"} deposit call for {formatUnits(BigInt(observed.amountMicros), 6)} USDC, finalized according to the configured RPC.</p>
      <p>{observed.status === "success" ? "This is a past deposit, not your current available balance. Funds may already have been spent or withdrawn; Circle credit may also still be updating." : "This call did not complete the deposit. Gas may have been charged."}</p>
      <a className="break-all font-mono text-xs underline" href={`https://testnet.arcscan.app/tx/${observed.hash}`} target="_blank" rel="noreferrer">View deposit transaction on ArcScan</a>
    </div>}
    <p className="font-serif text-xs text-ink-3">A missing record here does not rule out another pending transaction. This check cannot recover a transaction hash lost from both the browser and wallet activity.</p>
  </section>;
}
