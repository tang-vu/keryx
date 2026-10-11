"use client";

import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { WalletPicker } from "./wallet-picker";
import { ResearchFunding } from "./research-funding";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { buyMonthly, monthlyStatus, submitMonthly, monthlyIntentSchema, type MonthlyIntent } from "@/lib/monthly/client";
import type { MonthlyQuote } from "@/lib/monthly/protocol";
import { monthlyIdSchema, monthlyRecoveryRequestSchema, monthlyRecoveryFileSchema, monthlyRecoveryFile } from "@/lib/monthly/protocol";
import { ResearchJob } from "./research-job";
import { AskQuestionSchema, MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";

import { BUYER_PROFILE } from "@/lib/buyer/protocol";
import { monthlyStorageKeys } from "@/lib/monthly/local-recovery";
import { createFormatters } from "@/lib/i18n/format";

const uiFormat = createFormatters("en");

const copy = createMessages("en");

const button = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
function save(key: string, value: unknown) {
  const text = JSON.stringify(value); localStorage.setItem(key, text);
  if (localStorage.getItem(key) !== text) throw new Error(copy("monthlyResearch.storageUnavailable"));
}
function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "keryx-monthly-recovery.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResearchMonthly({ quote }: { quote: MonthlyQuote }) {
  const { address, chainId } = useAccount(); const { data: wallet } = useWalletClient();
  const storage = monthlyStorageKeys(BUYER_PROFILE, address);
  const storageScope = `${BUYER_PROFILE.networkId}:${address?.toLowerCase() ?? "disconnected"}`;
  const operation = useRef(false);
  const scope = useRef<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const reviewScope = `${address}:${chainId}:${quote.quoteId}`;
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null); const accepted = acceptedScope === reviewScope;
  const setAccepted = (value: boolean) => setAcceptedScope(value ? reviewScope : null);
  const [busy, setBusy] = useState(false);
  const [funding, setFunding] = useState(false); const [message, setMessage] = useState("");
  const [monthlyId, setMonthlyId] = useState(""); const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<MonthlyIntent | null>(null);
  const [purchaseUncertain, setPurchaseUncertain] = useState(false);
  const [record, setRecord] = useState<{ remaining: number; expired: boolean; purchase: { expiresAt: string; payer: string }; redemptions: { requestId: string; orderId: string }[] } | null>(null);
  const [request, setRequest] = useState<{ monthlyId: string; requestId: string; question: string; payer: string } | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  useEffect(() => {
    scope.current = storageScope;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMonthlyId(""); setIntent(null); setPurchaseUncertain(false); setRecord(null); setRequest(null); setSelectedJob(null);
      const keys = monthlyStorageKeys(BUYER_PROFILE, address);
      try {
        if (keys) {
          const last = JSON.parse(localStorage.getItem(keys.last) ?? "null");
          if (monthlyIdSchema.safeParse(last).success) {
            setMonthlyId(last);
            const saved = JSON.parse(localStorage.getItem(keys.intent(last)) ?? "null");
            const parsed = monthlyIntentSchema.safeParse(saved?.intent);
            if (parsed.success && (!address || parsed.data.authorization.from.toLowerCase() === address.toLowerCase())) {
              setIntent(parsed.data); setPurchaseUncertain(saved.state === "submitted");
            }
          }
          const restored = monthlyRecoveryRequestSchema.safeParse(JSON.parse(localStorage.getItem(keys.request) ?? "null"));
          if (restored.success && (!address || restored.data.payer.toLowerCase() === address.toLowerCase())) setRequest(restored.data);
        }
      } catch { /* Explicit recovery file and plan ID remain available. */ }
      setLoadedScope(storageScope);
    });
    return () => { active = false; scope.current = null; };
  }, [address, storageScope]);
  const assertScope = () => {
    if (scope.current !== storageScope || !storage || !address || chainId !== BUYER_PROFILE.chainId) throw new Error(copy("monthlyResearch.connectPayerNetwork", { network: BUYER_PROFILE.label }));
  };
  const sign = async (text: string) => {
    assertScope();
    if (!wallet || !address) throw new Error(copy("monthlyResearch.connectPayer"));
    const [current, currentChain] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
    assertScope();
    if (current[0]?.toLowerCase() !== address.toLowerCase() || currentChain !== BUYER_PROFILE.chainId) throw new Error(copy("monthlyResearch.walletChanged"));
    return wallet.signMessage({ account: address, message: text });
  };
  async function run(action: () => Promise<void>) {
    if (operation.current || loadedScope !== storageScope) return;
    operation.current = true; setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { if (scope.current === storageScope) setMessage(error instanceof Error ? error.message : copy("monthlyResearch.operationUncertain")); }
    finally { operation.current = false; setBusy(false); }
  }
  const format = (micros: number) => formatUnits(BigInt(micros), 6);
  return <section id="monthly" aria-labelledby="monthly-heading" className="space-y-4 border border-line bg-paper p-6">
    <p className="font-mono text-xs text-seal">{copy("monthlyResearch.renewal", { network: BUYER_PROFILE.label })}</p>
    <h2 id="monthly-heading" className="font-display text-3xl">{copy("monthlyResearch.title")}</h2>
    <p className="font-serif text-ink-2">{copy("monthlyResearch.introduction", { total: format(quote.totalMicros), separateTotal: format(quote.separateTotalMicros), cap: format(quote.creatorBudgetMicros) })}</p>
    <p className="font-serif text-sm text-ink-3">{quote.roundingMicros ? copy("monthlyResearch.roundedTerms", { rounding: quote.roundingMicros }) : copy("monthlyResearch.terms")}</p>
    <p className="break-all font-mono text-xs">{copy("monthlyResearch.payee", { payee: quote.payee })}</p>
    {!address ? <WalletPicker isBusy={busy} onConnected={() => {}} /> : <>
      {chainId !== BUYER_PROFILE.chainId ? <p>{copy("monthlyResearch.chooseNetwork", { network: BUYER_PROFILE.label })}</p> : <ResearchFunding payer={address} initialAmount={quote.totalMicros / 1e6} requiredMicros={String(quote.totalMicros)} creditRevision={0} disabled={busy} onBusy={setFunding} onChanged={() => {}} />}
      <label className="flex gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />{copy("monthlyResearch.consent")}</label>
      <button className={`${button} bg-ink text-paper`} disabled={!accepted || !wallet || chainId !== BUYER_PROFILE.chainId || busy || funding || purchaseUncertain || loadedScope !== storageScope} onClick={() => { void run(async () => {
        assertScope(); if (!wallet || !address || !storage) return;
        const result = await buyMonthly({ quote, payer: address, ...connectedBuyerWallet(wallet, address),
          prepare: async value => { assertScope(); save(storage.intent(value.monthlyId), { intent: value, state: "prepared" });
            save(storage.last, value.monthlyId); setMonthlyId(value.monthlyId); setIntent(value); download(value); },
          claim: async value => { assertScope(); const key = storage.intent(value.monthlyId);
            const saved = JSON.parse(localStorage.getItem(key) ?? "null"); if (saved?.state !== "prepared") throw new Error(copy("monthlyResearch.recoveryOnly"));
            save(key, { intent: value, state: "submitted" }); setPurchaseUncertain(true); }, });
        assertScope(); setAccepted(false); setRecord(null); setMessage(result.status === "seller_reported_settled" ? copy("monthlyResearch.acknowledged")
          : copy("monthlyResearch.purchaseUncertain"));
      }); }}>{copy("monthlyResearch.buy", { amount: format(quote.totalMicros) })}</button>
    </>}
    {intent && <button className={button} onClick={() => download(intent)}>{copy("monthlyResearch.downloadPurchase")}</button>}
    <label className="grid gap-2 font-mono text-xs">{copy("monthlyResearch.planId")}<input value={monthlyId} onChange={e => { setMonthlyId(e.target.value.trim()); setRecord(null); }} className="border border-line bg-paper-2 p-3" /></label>
    <label className="grid gap-2 font-mono text-xs">{copy("monthlyResearch.importRequest")}<input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      void run(async () => { if (file.size > 16384) throw new Error(copy("monthlyResearch.fileTooLarge"));
        const restored = monthlyRecoveryFileSchema.parse(JSON.parse(await file.text()));
        assertScope(); if (restored.payer.toLowerCase() !== address!.toLowerCase()) throw new Error(copy("monthlyResearch.connectRecoveryPayer"));
        save(storage!.request, restored); setRequest(restored); setMonthlyId(restored.monthlyId); setRecord(null);
        setMessage(copy("monthlyResearch.restored")); });
    }} /></label>
    <button className={button} disabled={busy || !wallet || !monthlyIdSchema.safeParse(monthlyId).success} onClick={() => { void run(async () => {
      assertScope(); const found = await monthlyStatus(monthlyId, address!, sign); assertScope(); setRecord(found);
      if (intent && found.purchase?.id === intent.monthlyId && found.purchase?.payer?.toLowerCase() === intent.authorization.from.toLowerCase()) {
        save(storage!.intent(intent.monthlyId), { intent, state: "confirmed" }); setPurchaseUncertain(false);
      }
      setMessage(copy("monthlyResearch.statusRefreshed"));
    }); }}>{copy("monthlyResearch.checkStatus")}</button>
    {!address && monthlyId && <p className="font-serif text-sm">{copy("monthlyResearch.savedPlanDisconnected")}</p>}
    {purchaseUncertain && <p className="font-serif text-sm text-seal">{copy("monthlyResearch.unresolvedPurchase")}</p>}
    {record && chainId === BUYER_PROFILE.chainId && record.purchase.payer.toLowerCase() === address?.toLowerCase() && <div className="space-y-3 border-t border-line pt-4">
      <p className="font-serif">{record.expired ? copy(record.remaining === 1 ? "monthlyResearch.expired.one" : "monthlyResearch.expired.other", { count: record.remaining }) : copy(record.remaining === 1 ? "monthlyResearch.expires.one" : "monthlyResearch.expires.other", { count: record.remaining, expiresAt: uiFormat.dateTime(record.purchase.expiresAt) })}</p>
      {record.redemptions.map(item => <p key={item.requestId} className="font-mono text-xs"><button className="underline" onClick={() => setSelectedJob(item.orderId)}>{copy("monthlyResearch.followJob", { jobId: item.orderId })}</button></p>)}
      <label className="grid gap-2 font-mono text-xs">{copy("monthlyResearch.question")}<textarea value={question} onChange={e => setQuestion(e.target.value)} rows={3} maxLength={MAX_ASK_QUESTION_CHARS} className="border border-line bg-paper-2 p-3 font-serif" /></label>
      <button className={button} disabled={busy || !wallet || !address || chainId !== BUYER_PROFILE.chainId || record.expired || record.remaining === 0 || !AskQuestionSchema.safeParse(question).success || !!request} onClick={() => {
        void run(async () => { assertScope(); if (!wallet || !address) throw new Error(copy("monthlyResearch.connectPayer"));
          const [addresses, network] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
          assertScope(); if (addresses[0]?.toLowerCase() !== record.purchase.payer.toLowerCase() || network !== BUYER_PROFILE.chainId) throw new Error(copy("monthlyResearch.connectOriginalPayer"));
          const value = { monthlyId, requestId: crypto.randomUUID(), question: AskQuestionSchema.parse(question), payer: address };
          save(storage!.request, value); setRequest(value); download(monthlyRecoveryFile(value));
          const result = await submitMonthly(value, sign); assertScope(); setSelectedJob(result.queryId); setMessage(copy("monthlyResearch.requestAdmitted"));
          localStorage.removeItem(storage!.request); setRequest(null); setRecord(null); });
      }}>{copy("monthlyResearch.useRequest")}</button>
    </div>}
    {request && <div className="space-y-3 border border-line p-4"><p className="font-serif text-sm">{copy("monthlyResearch.retainedRequest", { requestId: request.requestId })}</p>
      <button className={button} onClick={() => download(monthlyRecoveryFile(request))}>{copy("monthlyResearch.downloadRequest")}</button>
      <button className={button} disabled={busy || !wallet || address?.toLowerCase() !== request.payer.toLowerCase()} onClick={() => { void run(async () => {
        assertScope(); const result = await submitMonthly(request, sign); assertScope(); setSelectedJob(result.queryId); setMessage(copy("monthlyResearch.followingJob"));
        localStorage.removeItem(storage!.request); setRequest(null); setRecord(null);
      }); }}>{copy("monthlyResearch.recoverRequest")}</button></div>}
    <p role="status" aria-live="polite" className="font-serif text-sm">{message}</p>
    {selectedJob && <ResearchJob key={selectedJob} initialId={selectedJob} />}
  </section>;
}
