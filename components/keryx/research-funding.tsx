"use client";
import { SigningAmount } from "./signing-amount";
import { formatAmount } from "@/lib/i18n/format";

import { createMessages } from "@/lib/i18n/messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { parseUnits, type PublicClient } from "viem";
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

const copy = createMessages("en");

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
  if (leg.status === "replaced") return copy("gatewayFunding.replaced");
  if (leg.status === "reverted") return copy("gatewayFunding.reverted");
  if (leg.status !== "confirmed") return copy("gatewayFunding.unconfirmed");
  if (leg.resolution) return step === "deposit"
    ? copy("gatewayFunding.finalizedDeposit")
    : copy("gatewayFunding.finalizedApproval");
  return step === "deposit"
    ? copy("gatewayFunding.confirmedDeposit")
    : copy("gatewayFunding.confirmedApproval");
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
      if (live.current && epoch === creditEpoch.current) setMessage(copy("gatewayFunding.creditUnknown"));
    } finally { if (live.current && epoch === creditEpoch.current) { setCreditChecked(creditRevision); setCreditChecking(false); } }
  }, [wallet, payer, creditRevision, setMessage]);

  useEffect(() => {
    live.current = true;
    void refresh().catch(() => { if (live.current) { setRecordsAvailable(false); setMessage(copy("gatewayFunding.recordsUnavailable")); } });
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
      else if (!cancelled) setMessage(copy("gatewayFunding.lookupPaused"));
    }
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pendingId, pendingStep, chain, refresh]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (disabled || operation.current) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true); onBusy(true);
    try { await action(abort.signal); }
    catch { if (live.current) setMessage(copy("gatewayFunding.stepIncomplete")); }
    finally {
      if (live.current) { await refresh().catch(() => setMessage(copy("gatewayFunding.recordsNotRefreshed"))); setBusy(false); onBusy(false); }
      operation.current = null;
    }
  }

  function send(step: FundingStep) {
    if (!wallet || !chain || !active) return;
    void run(async signal => {
      setMessage(copy(step === "approval" ? "gatewayFunding.checkApproval" : "gatewayFunding.checkDeposit"));
      const result = await submitFundingStep({ id: active.id, step, wallet, chain, signal });
      if (!live.current) return;
      if (result.hash) setLookupHash(result.hash);
      setMessage(result.state === "submitted" ? copy("gatewayFunding.submitted")
        : result.state === "rejected" ? copy("gatewayFunding.rejected")
        : copy("gatewayFunding.walletUncertain"));
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
    <section className="border border-line bg-paper p-4" aria-label={copy("gatewayFunding.readinessLabel")}>
      <h4 className="font-display text-xl">{copy("gatewayFunding.readinessTitle")}</h4>
      <p className="mt-2 font-mono text-xs">{currentCredit === null ? copy("gatewayFunding.priceUnknownBalance", { price: formatAmount(BigInt(requiredMicros), { minimumFractionDigits: 6, useGrouping: false }) }) : copy("gatewayFunding.priceBalance", { price: formatAmount(BigInt(requiredMicros), { minimumFractionDigits: 6, useGrouping: false }), balance: formatAmount(BigInt(currentCredit), { minimumFractionDigits: 6, useGrouping: false }) })}</p>
      <p role="status" className="mt-2 font-serif text-sm">{creditChecking && creditChecked !== creditRevision ? copy("gatewayFunding.checkingBalance") : !recordsAvailable ? copy("gatewayFunding.historyUnknown") : creditChecked !== creditRevision && readiness !== "deposit-unverified" ? copy("gatewayFunding.checkPriceCoverage") : readiness === "ready"
        ? copy("gatewayFunding.ready")
        : readiness === "deposit-unverified" ? copy("gatewayFunding.unverifiedCredit")
        : readiness === "insufficient" ? copy(rows[0]?.deposit.status === "confirmed" ? "gatewayFunding.insufficientAfterDeposit" : "gatewayFunding.insufficient")
        : copy("gatewayFunding.unavailableBalance")}</p>
      {uncertain && <p className="mt-2 font-serif text-sm text-seal">{copy("gatewayFunding.existingTransaction")}</p>}
      <button type="button" className={`${control} mt-3`} disabled={disabled || busy || creditChecking || !wallet} onClick={() => { void checkCredit(); void refresh().catch(() => { setRecordsAvailable(false); setMessage(copy("gatewayFunding.recordsNotRead")); }); }}>{copy("gatewayFunding.refreshBalance")}</button>
      {recordsAvailable && readiness === "insufficient" && !uncertain && <button type="button" className={`${control} mt-3 ml-2`} onClick={() => { if (fundingDetails.current) fundingDetails.current.open = true; }}>{copy("gatewayFunding.reviewDeposit")}</button>}
      {recordsAvailable && (readiness === "deposit-unverified" || uncertain) && <button type="button" className={`${control} mt-3 ml-2`} onClick={() => { if (fundingDetails.current) fundingDetails.current.open = true; }}>{copy("gatewayFunding.inspectTransaction")}</button>}
    </section>
    <details ref={fundingDetails} className="border border-line p-4">
    <summary className="cursor-pointer font-mono text-xs">{copy("gatewayFunding.addToGateway")}</summary>
    <p className="mt-3 font-serif text-sm">{copy("gatewayFunding.depositNotice")}</p>
    <p className="mt-2 break-all font-mono text-xs">{copy("gatewayFunding.gateway", { network: browserPaymentProfile().label, gateway: BUYER_GATEWAY })}</p>
    {!profile.testnet && <div className="mt-3"><ArcCardOnrampPanel /></div>}
    {!active && <div className="mt-4 space-y-3">
      <label className="grid gap-2 font-mono text-xs">{copy("gatewayFunding.amount", { network: profile.label })}<input value={amount} disabled={busy || disabled} onChange={event => { setAmount(event.target.value); setAccepted(false); }} inputMode="decimal" className="w-full border border-line bg-paper p-3 sm:w-48" /></label>
      <label className="flex items-start gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy || disabled} onChange={event => setAccepted(event.target.checked)} className="mt-1" /><span>{copy("gatewayFunding.depositConsent")}</span></label>
      <button type="button" disabled={busy || disabled || !accepted || !wallet || !reviewedDeposit(amount)} className={control} onClick={() => {
        if (!wallet) return;
        void run(async signal => {
          const value = reviewedDeposit(amount); if (!value) throw new Error("Invalid amount");
          await connectedBuyerWallet(wallet, payer, signal).readWallet();
          signal.throwIfAborted(); await createFundingRecord(payer, value);
          if (live.current) { setAccepted(false); setLookupHash(""); setMessage(copy("gatewayFunding.planSaved")); }
        });
      }}>{copy("gatewayFunding.prepareDeposit")}</button>
      <p className="font-serif text-xs text-ink-3">{copy(profile.testnet ? "gatewayFunding.testnetGasNotice" : "gatewayFunding.mainnetGasNotice")}</p>
    </div>}
    {active && <div className="mt-4 space-y-3">
      <p className="text-xs"><SigningAmount micros={active.amount} /></p>
      <p className="font-mono text-xs">{copy("gatewayFunding.plannedDeposit", { amount: formatAmount(BigInt(active.amount), { minimumFractionDigits: 6, useGrouping: false }) })}</p>
      {(["approval", "deposit"] as const).map(step => <div key={step} className="border border-line p-3">
        <p className="font-mono text-xs">{copy(step === "approval" ? "gatewayFunding.approvalStatus" : "gatewayFunding.depositStatus", { status: active[step].status })}</p>
        {["ready", "rejected"].includes(active[step].status) && <button type="button" className={`${control} mt-2`} disabled={busy || disabled || (step === "deposit" && active.approval.status !== "confirmed")} onClick={() => send(step)}>{copy(step === "approval" ? "gatewayFunding.approveAmount" : "gatewayFunding.depositAmount", { amount: formatAmount(BigInt(active.amount), { minimumFractionDigits: 6, useGrouping: false }) })}</button>}
        {["possible", "submitted"].includes(active[step].status) && <>
          <label className="mt-3 grid gap-2 font-serif text-sm">{copy("gatewayFunding.transactionHash")}<input value={lookupHash} onChange={event => setLookupHash(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" className="min-w-0 border border-line bg-paper p-2 font-mono text-xs" /></label>
          <button type="button" className={`${control} mt-2`} disabled={busy || disabled || (!active[step].hash && !/^0x[a-fA-F0-9]{64}$/.test(lookupHash.trim()))} onClick={() => recover(step)}>{copy("gatewayFunding.checkOriginal")}</button>
          <p className="mt-2 font-serif text-xs">{copy("gatewayFunding.replacementNotice")}</p>
          <button type="button" className={`${control} mt-2`} disabled={busy || disabled || !/^0x[a-fA-F0-9]{64}$/.test(lookupHash.trim())} onClick={() => recoverReplacement(step)}>{copy("gatewayFunding.checkReplacement")}</button>
        </>}
        {active[step].hash && <a className="mt-2 block break-all font-mono text-xs underline" href={`${fundingExplorer(active)}/tx/${active[step].hash}`} target="_blank" rel="noreferrer">{copy("gatewayFunding.viewNetworkTransaction")}</a>}
        {active[step].originalHash && <a className="mt-2 block break-all font-mono text-xs underline" href={`${fundingExplorer(active)}/tx/${active[step].originalHash}`} target="_blank" rel="noreferrer">{copy("gatewayFunding.originalTransaction")}</a>}
      </div>)}
      {["ready", "rejected"].includes(active.deposit.status) && ["ready", "rejected", "confirmed"].includes(active.approval.status) && <button type="button" className={control} disabled={busy || disabled} onClick={() => {
        void run(async () => { if (!await cancelFundingRecord(active.id)) throw new Error("Funding state changed"); if (live.current) setMessage(copy("gatewayFunding.planCancelled")); });
      }}>{copy("gatewayFunding.cancelPlan")}</button>}
    </div>}
    <button type="button" className={`${control} mt-4`} disabled={busy || disabled} onClick={() => {
      if (pendingStep) recover(pendingStep); else void refresh().catch(() => setMessage(copy("gatewayFunding.recordsNotRead")));
    }}>{copy("gatewayFunding.refreshStatus")}</button>
    {rows.some(row => row.deposit.status === "confirmed") && <p className="mt-3 font-serif text-sm">{copy("gatewayFunding.savedDepositNotice")}</p>}
    <p role="status" className="mt-3 font-serif text-sm">{message}</p>
    <ul className="mt-3 space-y-2">{rows.filter(row => !row.activePayer).slice(0, 5).map(row => <li key={row.id} className="font-mono text-xs">{copy(row.cancelled ? "gatewayFunding.history.cancelled" : row.deposit.status === "confirmed" ? "gatewayFunding.history.confirmed" : row.deposit.status === "replaced" || row.approval.status === "replaced" ? "gatewayFunding.history.replaced" : "gatewayFunding.history.reverted", { amount: formatAmount(BigInt(row.amount), { minimumFractionDigits: 6, useGrouping: false }) })}{(row.deposit.hash ?? row.approval.hash) && <> · <a className="underline" href={`${fundingExplorer(row)}/tx/${row.deposit.hash ?? row.approval.hash}`} target="_blank" rel="noreferrer">{copy("gatewayFunding.transaction")}</a></>}{(row.deposit.originalHash ?? row.approval.originalHash) && <> · <a className="underline" href={`${fundingExplorer(row)}/tx/${row.deposit.originalHash ?? row.approval.originalHash}`} target="_blank" rel="noreferrer">{copy("gatewayFunding.originalTransaction")}</a></>}</li>)}</ul>
    <ResearchFundingActivity key={payer.toLowerCase()} payer={payer} chain={chain} />
  </details></div>;
}
