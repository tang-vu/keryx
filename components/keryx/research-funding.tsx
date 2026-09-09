"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { formatUnits, type PublicClient } from "viem";
import { createFundingRecord, listFundingRecords, cancelFundingRecord } from "@/lib/buyer/funding-journal";
import { submitFundingStep, recoverFundingStep } from "@/lib/buyer/funding-client";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { type FundingRecord, type FundingStep } from "@/lib/buyer/funding-policy";
import { parseBuyerBudget } from "@/lib/a2a/buyer-workspace";
import { BUYER_GATEWAY } from "@/lib/buyer/protocol";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";

export function ResearchFunding({ payer, initialAmount, disabled, onBusy, onChanged }: {
  payer: string; initialAmount: number; disabled: boolean; onBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const { data: wallet } = useWalletClient();
  const chain = usePublicClient({ chainId: 5042002 }) as PublicClient | undefined;
  const [amount, setAmount] = useState(String(initialAmount));
  const [accepted, setAccepted] = useState(false);
  const [rows, setRows] = useState<FundingRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lookupHash, setLookupHash] = useState("");
  const operation = useRef<AbortController | null>(null);
  const live = useRef(true);
  const active = rows.find(row => row.activePayer === payer.toLowerCase());
  const refresh = useCallback(async () => {
    const values = await listFundingRecords(payer);
    if (live.current) setRows(values);
  }, [payer]);

  useEffect(() => {
    live.current = true;
    void refresh().catch(() => { if (live.current) setMessage("Funding records could not be read. Check browser storage before depositing."); });
    return () => { live.current = false; operation.current?.abort(); onBusy(false); };
  }, [refresh, onBusy]);

  const pendingStep = active?.deposit.status === "submitted" ? "deposit" : active?.approval.status === "submitted" ? "approval" : null;
  const pendingId = active?.id;
  useEffect(() => {
    if (!pendingId || !pendingStep || !chain) return;
    let cancelled = false; let attempts = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      attempts++;
      try {
        const result = await recoverFundingStep(pendingId!, pendingStep!, chain!);
        if (!cancelled) {
          await refresh();
          setMessage(result[pendingStep!].status === "confirmed"
            ? (pendingStep === "deposit" ? "Deposit confirmed on chain. Check Gateway balance before buying; Circle credit may still be updating." : "Approval confirmed. Review the deposit step separately.")
            : "The transaction reverted. Gas may have been charged.");
        }
      }
      catch { /* Missing/mismatched or unconfirmed evidence never permits another wallet request. */ }
      if (!cancelled && attempts < 30) timer = setTimeout(poll, 4000);
      else if (!cancelled) setMessage("Confirmation lookup paused. Refresh funding status to continue; do not send the transaction again.");
    }
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pendingId, pendingStep, chain, refresh]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (disabled || operation.current) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true); onBusy(true);
    try { await action(abort.signal); }
    catch { if (live.current) setMessage("Could not complete this step. Check your wallet, funds, gas and saved funding status. No transaction will be retried automatically."); }
    finally {
      if (live.current) { await refresh().catch(() => setMessage("Could not refresh funding records. Keep this tab and check your wallet activity.")); setBusy(false); onBusy(false); }
      operation.current = null;
    }
  }

  function send(step: FundingStep) {
    if (!wallet || !chain || !active) return;
    void run(async signal => {
      setMessage(`Check the exact ${step === "approval" ? "approval" : "deposit"} amount and gas in your wallet.`);
      const result = await submitFundingStep({ id: active.id, step, wallet, chain, signal });
      if (!live.current) return;
      if (result.hash) setLookupHash(result.hash);
      setMessage(result.state === "submitted" ? "Transaction submitted. Waiting for matching on-chain confirmation."
        : result.state === "rejected" ? "Your wallet rejected the request. You can review and try this step again."
        : "Wallet or storage response is uncertain. Check wallet activity and recover the original transaction hash; do not send it again.");
      onChanged();
    });
  }

  function recover(step: FundingStep) {
    if (!chain || !active) return;
    void run(async () => {
      const result = await recoverFundingStep(active.id, step, chain, active[step].hash ?? lookupHash.trim());
      if (live.current) {
        setMessage(result[step].status === "confirmed" ? (step === "deposit" ? "Deposit confirmed on chain. Check Gateway balance before buying; Circle credit may still be updating." : "Approval confirmed. Review the deposit step separately.") : "The transaction reverted. Gas may have been charged; this was not a successful deposit.");
        setLookupHash(""); onChanged();
      }
    });
  }

  return <details className="border border-line p-4">
    <summary className="cursor-pointer font-mono text-xs">Add USDC to Gateway</summary>
    <p className="mt-3 font-serif text-sm">Approve an exact amount, then deposit it into your own Gateway balance. Each transaction needs a wallet confirmation and costs gas. This does not buy research or pay Keryx.</p>
    <p className="mt-2 break-all font-mono text-xs">Arc testnet Gateway: {BUYER_GATEWAY}</p>
    {!active && <div className="mt-4 space-y-3">
      <label className="grid gap-2 font-mono text-xs">Deposit amount (testnet USDC)<input value={amount} disabled={busy || disabled} onChange={event => { setAmount(event.target.value); setAccepted(false); }} inputMode="decimal" className="w-full border border-line bg-paper p-3 sm:w-48" /></label>
      <label className="flex items-start gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy || disabled} onChange={event => setAccepted(event.target.checked)} className="mt-1" /><span>I want to add this amount to my own Gateway balance, plus transaction gas. I will keep my wallet transaction hashes for recovery.</span></label>
      <button type="button" disabled={busy || disabled || !accepted || !wallet || !parseBuyerBudget(amount, 1)} className={control} onClick={() => {
        if (!wallet) return;
        void run(async signal => {
          const value = parseBuyerBudget(amount, 1); if (!value) throw new Error("Invalid amount");
          await connectedBuyerWallet(wallet, payer, signal).readWallet();
          signal.throwIfAborted(); await createFundingRecord(payer, String(Math.round(value * 1e6)));
          if (live.current) { setAccepted(false); setLookupHash(""); setMessage("Funding plan saved. Review the approval step below; no transaction has been sent."); }
        });
      }}>Prepare deposit</button>
      <p className="font-serif text-xs text-ink-3">Up to 1 testnet USDC per deposit. Leave wallet USDC for gas. Browser storage can be lost; wallet activity remains the source for transaction hashes.</p>
    </div>}
    {active && <div className="mt-4 space-y-3">
      <p className="font-mono text-xs">Planned deposit: {formatUnits(BigInt(active.amount), 6)} USDC</p>
      {(["approval", "deposit"] as const).map(step => <div key={step} className="border border-line p-3">
        <p className="font-mono text-xs">{step === "approval" ? "1. Approve" : "2. Deposit"}: {active[step].status}</p>
        {["ready", "rejected"].includes(active[step].status) && <button type="button" className={`${control} mt-2`} disabled={busy || disabled || (step === "deposit" && active.approval.status !== "confirmed")} onClick={() => send(step)}>{step === "approval" ? "Approve" : "Deposit"} {formatUnits(BigInt(active.amount), 6)} USDC</button>}
        {["possible", "submitted"].includes(active[step].status) && <>
          {!active[step].hash && <label className="mt-3 grid gap-2 font-serif text-sm">Transaction hash from your wallet<input value={lookupHash} onChange={event => setLookupHash(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" className="min-w-0 border border-line bg-paper p-2 font-mono text-xs" /></label>}
          <button type="button" className={`${control} mt-2`} disabled={busy || disabled || (!active[step].hash && !/^0x[a-fA-F0-9]{64}$/.test(lookupHash.trim()))} onClick={() => recover(step)}>Check original transaction</button>
        </>}
        {active[step].hash && <a className="mt-2 block break-all font-mono text-xs underline" href={`https://testnet.arcscan.app/tx/${active[step].hash}`} target="_blank" rel="noreferrer">View transaction on ArcScan</a>}
      </div>)}
      {["ready", "rejected"].includes(active.deposit.status) && ["ready", "rejected", "confirmed"].includes(active.approval.status) && <button type="button" className={control} disabled={busy || disabled} onClick={() => {
        void run(async () => { if (!await cancelFundingRecord(active.id)) throw new Error("Funding state changed"); if (live.current) setMessage("Local funding plan cancelled. Any confirmed token approval remains on chain."); });
      }}>Cancel unsubmitted deposit plan</button>}
    </div>}
    <button type="button" className={`${control} mt-4`} disabled={busy || disabled} onClick={() => {
      if (pendingStep) recover(pendingStep); else void refresh().catch(() => setMessage("Funding records could not be read."));
    }}>Refresh funding status</button>
    {rows.some(row => row.deposit.status === "confirmed") && <p className="mt-3 font-serif text-sm">A saved deposit is confirmed on chain. Check the current Gateway balance before buying; previous deposits may already have been spent.</p>}
    <p role="status" className="mt-3 font-serif text-sm">{message}</p>
    <ul className="mt-3 space-y-2">{rows.filter(row => !row.activePayer).slice(0, 5).map(row => <li key={row.id} className="font-mono text-xs">{formatUnits(BigInt(row.amount), 6)} USDC · {row.cancelled ? "plan cancelled" : row.deposit.status === "confirmed" ? "deposit confirmed" : "transaction reverted"}{row.deposit.hash && <> · <a className="underline" href={`https://testnet.arcscan.app/tx/${row.deposit.hash}`} target="_blank" rel="noreferrer">Transaction</a></>}</li>)}</ul>
  </details>;
}
