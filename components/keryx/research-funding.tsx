"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { formatUnits, parseUnits, type PublicClient } from "viem";
import { createFundingRecord, listFundingRecords, cancelFundingRecord } from "@/lib/buyer/funding-journal";
import { submitFundingStep, recoverFundingStep, recoverFundingReplacement } from "@/lib/buyer/funding-client";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { fundingAmountSchema, type FundingRecord, type FundingStep } from "@/lib/buyer/funding-policy";
import { BUYER_GATEWAY } from "@/lib/buyer/protocol";
import { fundingReadiness, hasUncertainFunding } from "@/lib/buyer/funding-readiness";
import { ResearchFundingActivity } from "./research-funding-activity";
import { ArcCardOnrampPanel } from "./arc-card-onramp-panel";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "@/lib/arc-network-profile";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
function fundingExplorer(record: FundingRecord) {
  if (record.network === ARC_MAINNET_PROFILE.networkId) return ARC_MAINNET_PROFILE.explorerUrl;
  if (record.network === ARC_TESTNET_PROFILE.networkId) return ARC_TESTNET_PROFILE.explorerUrl;
  throw new Error("Original funding network unavailable");
}
function reviewedDeposit(value: string) {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const parsed = fundingAmountSchema.safeParse(parseUnits(value, 6).toString());
  return parsed.success ? parsed.data : null;
}

function outcomeMessage(record: FundingRecord, step: FundingStep) {
  const leg = record[step];
  if (leg.status === "replaced") return "The original transaction was replaced by a different call. This does not confirm the planned deposit. Check wallet activity and Gateway balance before preparing another deposit.";
  if (leg.status === "reverted") return "The matching transaction reverted. Gas may have been charged; this was not a successful deposit.";
  if (leg.status !== "confirmed") return "The transaction remains unconfirmed. Check wallet activity; do not send it again.";
  if (leg.resolution) return step === "deposit"
    ? "The matching deposit is finalized according to the configured RPC. Check Gateway balance before buying; credit may still be updating."
    : "The matching approval is finalized according to the configured RPC. Review the deposit separately.";
  return step === "deposit"
    ? "Deposit confirmed on chain. Check Gateway balance before buying; Circle credit may still be updating."
    : "Approval confirmed. Review the deposit step separately.";
}

export function ResearchFunding({ payer, initialAmount, requiredMicros, creditRevision = 0, disabled, onBusy, onChanged }: {
  payer: string; initialAmount: number; requiredMicros: string; creditRevision?: number; disabled: boolean; onBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const profile = browserPaymentProfile();
  const { data: wallet } = useWalletClient();
  const chain = usePublicClient({ chainId: browserPaymentProfile().chainId }) as PublicClient | undefined;
  const [amount, setAmount] = useState(String(initialAmount));
  const [accepted, setAccepted] = useState(false);
  const [rows, setRows] = useState<FundingRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [credit, setCredit] = useState<{ micros: string; revision: number } | null>(null);
  const [creditChecking, setCreditChecking] = useState(false);
  const [creditChecked, setCreditChecked] = useState<number | null>(null);
  const [recordsAvailable, setRecordsAvailable] = useState(false);
  const [lookupHash, setLookupHash] = useState("");
  const operation = useRef<AbortController | null>(null);
  const creditEpoch = useRef(0);
  const fundingDetails = useRef<HTMLDetailsElement | null>(null);
  const live = useRef(true);
  const active = rows.find(row => row.activePayer === payer.toLowerCase());
  const refresh = useCallback(async () => {
    const values = await listFundingRecords(payer);
    if (live.current) { setRows(values); setRecordsAvailable(true); }
  }, [payer]);

  const checkCredit = useCallback(async () => {
    if (!wallet || !live.current) return;
    const epoch = ++creditEpoch.current;
    setCreditChecking(true); setCredit(null);
    try {
      const value = await connectedBuyerWallet(wallet, payer).readWallet();
      if (live.current && epoch === creditEpoch.current) setCredit({ micros: value.gatewayBalanceMicros, revision: creditRevision });
    } catch {
      if (live.current && epoch === creditEpoch.current) setMessage("Gateway balance is unavailable. Refresh the balance; do not deposit based on an unknown balance.");
    } finally { if (live.current && epoch === creditEpoch.current) { setCreditChecked(creditRevision); setCreditChecking(false); } }
  }, [wallet, payer, creditRevision]);

  useEffect(() => {
    live.current = true;
    void refresh().catch(() => { if (live.current) { setRecordsAvailable(false); setMessage("Funding records could not be read. Check browser storage before depositing."); } });
    return () => { live.current = false; operation.current?.abort(); onBusy(false); };
  }, [refresh, onBusy]);

  const currentCredit = credit?.revision === creditRevision ? credit.micros : null;
  const readiness = fundingReadiness(currentCredit, requiredMicros, rows,
    (creditChecked === creditRevision && currentCredit === null) || (creditRevision > 0 && creditChecked !== creditRevision));
  const uncertain = hasUncertainFunding(rows);

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
          if (result.deposit.status === "confirmed") { creditEpoch.current++; setCredit(null); setCreditChecked(null); setCreditChecking(false); }
          setMessage(outcomeMessage(result, pendingStep!));
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
      creditEpoch.current++; setCredit(null); setCreditChecked(null); setCreditChecking(false); onChanged();
    });
  }

  function recover(step: FundingStep) {
    if (!chain || !active) return;
    void run(async () => {
      const result = await recoverFundingStep(active.id, step, chain, active[step].hash ?? lookupHash.trim());
      if (live.current) {
        setMessage(outcomeMessage(result, step));
        setLookupHash(""); creditEpoch.current++; setCredit(null); setCreditChecked(null); setCreditChecking(false); onChanged();
      }
    });
  }

  function recoverReplacement(step: FundingStep) {
    if (!chain || !active) return;
    void run(async signal => {
      const result = await recoverFundingReplacement(active.id, step, chain, lookupHash.trim(), signal);
      if (!live.current) return;
      setMessage(outcomeMessage(result, step));
      setLookupHash(""); creditEpoch.current++; setCredit(null); setCreditChecked(null); setCreditChecking(false); onChanged();
    });
  }

  return <div className="space-y-3">
    <section className="border border-line bg-paper p-4" aria-label="Gateway funding readiness">
      <h4 className="font-display text-xl">Funding readiness</h4>
      <p className="mt-2 font-mono text-xs">Price: {formatUnits(BigInt(requiredMicros), 6)} USDC · Gateway available: {currentCredit === null ? "unavailable or not checked" : `${formatUnits(BigInt(currentCredit), 6)} USDC`}</p>
      <p role="status" className="mt-2 font-serif text-sm">{creditChecking && creditChecked !== creditRevision ? "Checking Gateway balance…" : !recordsAvailable ? "Funding history unavailable. Inspect your wallet activity before adding funds." : creditChecked !== creditRevision && readiness !== "deposit-unverified" ? "Check Gateway balance to see whether this price is covered. This read sends no transaction." : readiness === "ready"
        ? "At the last check, enough Gateway USDC was available for this price. Review the purchase terms, then buy. The purchase checks funds again before signing."
        : readiness === "deposit-unverified" ? "The latest deposit is confirmed on chain; Gateway credit for this price is not yet verified. Funds may still be updating or may already have been spent. Refresh Gateway balance before buying or adding funds."
        : readiness === "insufficient" ? `Gateway funds are below this price.${rows[0]?.deposit.status === "confirmed" ? " The latest deposit is confirmed on chain, but current Gateway credit is still below the price; it may already have been spent or credit may not yet be visible." : ""} Check any existing transaction before preparing another deposit. Wallet USDC and gas are separate from Gateway credit.`
        : "Gateway balance unavailable. Refresh it before buying or adding funds."}</p>
      {uncertain && <p className="mt-2 font-serif text-sm text-seal">A funding transaction may already have been sent. Inspect the existing transaction below; do not submit it again.</p>}
      <button type="button" className={`${control} mt-3`} disabled={disabled || busy || creditChecking || !wallet} onClick={() => { void checkCredit(); void refresh().catch(() => { setRecordsAvailable(false); setMessage("Funding records could not be read."); }); }}>Refresh Gateway balance and funding status</button>
      {recordsAvailable && readiness === "insufficient" && !uncertain && <button type="button" className={`${control} mt-3 ml-2`} onClick={() => { if (fundingDetails.current) fundingDetails.current.open = true; }}>Review deposit options</button>}
      {recordsAvailable && (readiness === "deposit-unverified" || uncertain) && <button type="button" className={`${control} mt-3 ml-2`} onClick={() => { if (fundingDetails.current) fundingDetails.current.open = true; }}>Inspect existing transaction</button>}
    </section>
    <details ref={fundingDetails} className="border border-line p-4">
    <summary className="cursor-pointer font-mono text-xs">Add USDC to Gateway</summary>
    <p className="mt-3 font-serif text-sm">Approve an exact amount, then deposit it into your own Gateway balance. Each transaction needs a wallet confirmation and costs gas. This does not buy research or pay Keryx.</p>
    <p className="mt-2 break-all font-mono text-xs">{browserPaymentProfile().label} Gateway: {BUYER_GATEWAY}</p>
    {!profile.testnet && <div className="mt-3"><ArcCardOnrampPanel /></div>}
    {!active && <div className="mt-4 space-y-3">
      <label className="grid gap-2 font-mono text-xs">Deposit amount ({profile.label} USDC)<input value={amount} disabled={busy || disabled} onChange={event => { setAmount(event.target.value); setAccepted(false); }} inputMode="decimal" className="w-full border border-line bg-paper p-3 sm:w-48" /></label>
      <label className="flex items-start gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy || disabled} onChange={event => setAccepted(event.target.checked)} className="mt-1" /><span>I want to add this amount to my own Gateway balance, plus transaction gas. I will keep my wallet transaction hashes for recovery.</span></label>
      <button type="button" disabled={busy || disabled || !accepted || !wallet || !reviewedDeposit(amount)} className={control} onClick={() => {
        if (!wallet) return;
        void run(async signal => {
          const value = reviewedDeposit(amount); if (!value) throw new Error("Invalid amount");
          await connectedBuyerWallet(wallet, payer, signal).readWallet();
          signal.throwIfAborted(); await createFundingRecord(payer, value);
          if (live.current) { setAccepted(false); setLookupHash(""); setMessage("Funding plan saved. Review the approval step below; no transaction has been sent."); }
        });
      }}>Prepare deposit</button>
      <p className="font-serif text-xs text-ink-3">{profile.testnet ? "Up to 1 testnet USDC per deposit. " : "Review your chosen mainnet amount before funding. "}Leave wallet USDC for gas. Browser storage can be lost; wallet activity remains the source for transaction hashes.</p>
    </div>}
    {active && <div className="mt-4 space-y-3">
      <p className="font-mono text-xs">Planned deposit: {formatUnits(BigInt(active.amount), 6)} USDC</p>
      {(["approval", "deposit"] as const).map(step => <div key={step} className="border border-line p-3">
        <p className="font-mono text-xs">{step === "approval" ? "1. Approve" : "2. Deposit"}: {active[step].status}</p>
        {["ready", "rejected"].includes(active[step].status) && <button type="button" className={`${control} mt-2`} disabled={busy || disabled || (step === "deposit" && active.approval.status !== "confirmed")} onClick={() => send(step)}>{step === "approval" ? "Approve" : "Deposit"} {formatUnits(BigInt(active.amount), 6)} USDC</button>}
        {["possible", "submitted"].includes(active[step].status) && <>
          <label className="mt-3 grid gap-2 font-serif text-sm">Transaction hash from your wallet<input value={lookupHash} onChange={event => setLookupHash(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" className="min-w-0 border border-line bg-paper p-2 font-mono text-xs" /></label>
          <button type="button" className={`${control} mt-2`} disabled={busy || disabled || (!active[step].hash && !/^0x[a-fA-F0-9]{64}$/.test(lookupHash.trim()))} onClick={() => recover(step)}>Check original transaction</button>
          <p className="mt-2 font-serif text-xs">If your wallet sped up or cancelled this transaction, enter the replacement hash. This check sends no transaction and requires finalized evidence from the configured RPC.</p>
          <button type="button" className={`${control} mt-2`} disabled={busy || disabled || !/^0x[a-fA-F0-9]{64}$/.test(lookupHash.trim())} onClick={() => recoverReplacement(step)}>Check replacement transaction</button>
        </>}
        {active[step].hash && <a className="mt-2 block break-all font-mono text-xs underline" href={`${fundingExplorer(active)}/tx/${active[step].hash}`} target="_blank" rel="noreferrer">View original network transaction</a>}
        {active[step].originalHash && <a className="mt-2 block break-all font-mono text-xs underline" href={`${fundingExplorer(active)}/tx/${active[step].originalHash}`} target="_blank" rel="noreferrer">Original transaction</a>}
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
    <ul className="mt-3 space-y-2">{rows.filter(row => !row.activePayer).slice(0, 5).map(row => <li key={row.id} className="font-mono text-xs">{formatUnits(BigInt(row.amount), 6)} USDC · {row.cancelled ? "plan cancelled" : row.deposit.status === "confirmed" ? "deposit confirmed" : row.deposit.status === "replaced" || row.approval.status === "replaced" ? "original replaced by a different call; deposit not confirmed" : "transaction reverted"}{(row.deposit.hash ?? row.approval.hash) && <> · <a className="underline" href={`${fundingExplorer(row)}/tx/${row.deposit.hash ?? row.approval.hash}`} target="_blank" rel="noreferrer">Transaction</a></>}{(row.deposit.originalHash ?? row.approval.originalHash) && <> · <a className="underline" href={`${fundingExplorer(row)}/tx/${row.deposit.originalHash ?? row.approval.originalHash}`} target="_blank" rel="noreferrer">Original transaction</a></>}</li>)}</ul>
    <ResearchFundingActivity key={payer.toLowerCase()} payer={payer} chain={chain} />
  </details></div>;
}
