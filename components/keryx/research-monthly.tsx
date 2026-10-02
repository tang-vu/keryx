"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { WalletPicker } from "./wallet-picker";
import { ResearchFunding } from "./research-funding";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { buyMonthly, monthlyStatus, submitMonthly, monthlyIntentSchema, type MonthlyIntent } from "@/lib/monthly/client";
import type { MonthlyQuote } from "@/lib/monthly/protocol";
import { monthlyIdSchema, monthlyRecoveryRequestSchema } from "@/lib/monthly/protocol";
import { ResearchJob } from "./research-job";
import { AskQuestionSchema, MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";

const button = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
function save(key: string, value: unknown) {
  const text = JSON.stringify(value); localStorage.setItem(key, text);
  if (localStorage.getItem(key) !== text) throw new Error("Recovery storage unavailable");
}
function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "keryx-monthly-recovery.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResearchMonthly({ quote }: { quote: MonthlyQuote }) {
  const { address, chainId } = useAccount(); const { data: wallet } = useWalletClient();
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
  useEffect(() => { queueMicrotask(() => { try {
    const savedLast = localStorage.getItem("keryx.monthly.last"); const last = savedLast ? JSON.parse(savedLast) : null;
    if (monthlyIdSchema.safeParse(last).success) {
      setMonthlyId(last);
      const saved = JSON.parse(localStorage.getItem(`keryx.monthly.intent.${last}`) ?? "null");
      const parsed = monthlyIntentSchema.safeParse(saved?.intent);
      if (parsed.success) { setIntent(parsed.data); setPurchaseUncertain(saved.state === "submitted"); }
    }
    const pending = localStorage.getItem("keryx.monthly.request"); if (pending) {
      const parsed = monthlyRecoveryRequestSchema.safeParse(JSON.parse(pending)); if (parsed.success) setRequest(parsed.data);
    }
  } catch { /* Explicit recovery file and plan ID remain available. */ } }); }, []);
  const sign = async (text: string) => {
    if (!wallet || !address || chainId !== 5042002) throw new Error("Connect the plan's payer on Arc testnet");
    const [current, currentChain] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
    if (current[0]?.toLowerCase() !== address.toLowerCase() || currentChain !== 5042002) throw new Error("Wallet changed");
    return wallet.signMessage({ account: address, message: text });
  };
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(""); try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation uncertain. Keep the original recovery identity."); } finally { setBusy(false); } }
  const format = (micros: number) => String(micros / 1e6);
  return <section id="monthly" aria-labelledby="monthly-heading" className="space-y-4 border border-line bg-paper p-6">
    <p className="font-mono text-xs text-seal">Arc testnet pilot · manual renewal</p>
    <h2 id="monthly-heading" className="font-display text-3xl">Research Monthly</h2>
    <p className="font-serif text-ink-2">Four Deep research requests over 30 days for {format(quote.totalMicros)} USDC, compared with {format(quote.separateTotalMicros)} USDC separately. Each request keeps a {format(quote.creatorBudgetMicros)} USDC creator cap. The discount comes from Keryx’s service allocation.</p>
    <p className="font-serif text-sm text-ink-3">10% off the four-request total, rounded up to equal micro-USDC allocations{quote.roundingMicros ? ` (${quote.roundingMicros} micro-USDC rounding)` : ""}. Fixed, non-refundable and best effort. Failed or pending jobs use a slot; unused requests expire. No scheduled research, unlimited use or automatic renewal. Your questions use the existing public research service.</p>
    <p className="break-all font-mono text-xs">Keryx payee: {quote.payee}</p>
    {!address ? <WalletPicker isBusy={busy} onConnected={() => {}} /> : <>
      {chainId !== 5042002 ? <p>Choose Arc testnet in your wallet.</p> : <ResearchFunding payer={address} initialAmount={quote.totalMicros / 1e6} requiredMicros={String(quote.totalMicros)} creditRevision={0} disabled={busy} onBusy={setFunding} onChanged={() => {}} />}
      <label className="flex gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />I accept these terms and this exact price. I will keep my recovery file and original request IDs.</label>
      <button className={`${button} bg-ink text-paper`} disabled={!accepted || !wallet || chainId !== 5042002 || busy || funding || purchaseUncertain} onClick={() => { void run(async () => {
        if (!wallet || !address) return;
        const result = await buyMonthly({ quote, payer: address, ...connectedBuyerWallet(wallet, address),
          prepare: async value => { save(`keryx.monthly.intent.${value.monthlyId}`, { intent: value, state: "prepared" });
            save("keryx.monthly.last", value.monthlyId); setMonthlyId(value.monthlyId); setIntent(value); download(value); },
          claim: async value => { const key = `keryx.monthly.intent.${value.monthlyId}`;
            const saved = JSON.parse(localStorage.getItem(key) ?? "null"); if (saved?.state !== "prepared") throw new Error("This purchase is recovery-only");
            save(key, { intent: value, state: "submitted" }); setPurchaseUncertain(true); }, });
        setAccepted(false); setRecord(null); setMessage(result.status === "seller_reported_settled" ? "Seller acknowledged the purchase. Check plan status to submit a request."
          : "Purchase is uncertain. Check this original plan ID later; do not buy another plan to recover it.");
      }); }}>Buy Monthly · {format(quote.totalMicros)} USDC</button>
    </>}
    {intent && <button className={button} onClick={() => download(intent)}>Download purchase recovery</button>}
    <label className="grid gap-2 font-mono text-xs">Saved plan ID<input value={monthlyId} onChange={e => { setMonthlyId(e.target.value.trim()); setRecord(null); }} className="border border-line bg-paper-2 p-3" /></label>
    <label className="grid gap-2 font-mono text-xs">Import request recovery<input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      void run(async () => { if (file.size > 16384) throw new Error("Recovery file is too large");
        const restored = monthlyRecoveryRequestSchema.parse(JSON.parse(await file.text()));
        save("keryx.monthly.request", restored); setRequest(restored); setMonthlyId(restored.monthlyId); setRecord(null);
        setMessage("Original request restored. Connect its payer and recover the same request; no new payment was sent."); });
    }} /></label>
    <button className={button} disabled={busy || !wallet || !monthlyIdSchema.safeParse(monthlyId).success} onClick={() => { void run(async () => {
      const found = await monthlyStatus(monthlyId, address!, sign); setRecord(found);
      if (intent && found.purchase?.id === intent.monthlyId && found.purchase?.payer?.toLowerCase() === intent.authorization.from.toLowerCase()) {
        save(`keryx.monthly.intent.${intent.monthlyId}`, { intent, state: "confirmed" }); setPurchaseUncertain(false);
      }
      setMessage("Status refreshed. Checking status never submits a payment.");
    }); }}>Check plan status</button>
    {!address && monthlyId && <p className="font-serif text-sm">Your saved plan ID remains here. Connect its payer to check status. Existing job IDs below remain recoverable.</p>}
    {purchaseUncertain && <p className="font-serif text-sm text-seal">A submitted purchase remains unresolved. Check the original saved plan ID; a new purchase is disabled until its confirmed plan is recovered.</p>}
    {record && chainId === 5042002 && record.purchase.payer.toLowerCase() === address?.toLowerCase() && <div className="space-y-3 border-t border-line pt-4">
      <p className="font-serif">{record.remaining} requests remaining · {record.expired ? "Expired" : `Expires ${new Date(record.purchase.expiresAt).toLocaleString()}`}</p>
      {record.redemptions.map(item => <p key={item.requestId} className="font-mono text-xs"><button className="underline" onClick={() => setSelectedJob(item.orderId)}>Follow job {item.orderId}</button></p>)}
      <label className="grid gap-2 font-mono text-xs">Research question<textarea value={question} onChange={e => setQuestion(e.target.value)} rows={3} maxLength={MAX_ASK_QUESTION_CHARS} className="border border-line bg-paper-2 p-3 font-serif" /></label>
      <button className={button} disabled={busy || !wallet || !address || chainId !== 5042002 || record.expired || record.remaining === 0 || !AskQuestionSchema.safeParse(question).success || !!request} onClick={() => {
        void run(async () => { if (!wallet || !address) throw new Error("Connect the plan payer");
          const [addresses, network] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
          if (addresses[0]?.toLowerCase() !== record.purchase.payer.toLowerCase() || network !== 5042002) throw new Error("Connect the original plan payer");
          const value = { monthlyId, requestId: crypto.randomUUID(), question: AskQuestionSchema.parse(question), payer: address };
          save("keryx.monthly.request", value); setRequest(value); download(value);
          const result = await submitMonthly(value, sign); setSelectedJob(result.queryId); setMessage("Request admitted. Follow the original job below.");
          localStorage.removeItem("keryx.monthly.request"); setRequest(null); setRecord(null); });
      }}>Use one request</button>
    </div>}
    {request && <div className="space-y-3 border border-line p-4"><p className="font-serif text-sm">Retained request {request.requestId}. Recover this exact question and request ID after a disconnect; it cannot consume another slot.</p>
      <button className={button} onClick={() => download(request)}>Download request recovery</button>
      <button className={button} disabled={busy || !wallet || address?.toLowerCase() !== request.payer.toLowerCase()} onClick={() => { void run(async () => {
        const result = await submitMonthly(request, sign); setSelectedJob(result.queryId); setMessage("Following the original job below.");
        localStorage.removeItem("keryx.monthly.request"); setRequest(null); setRecord(null);
      }); }}>Recover original request</button></div>}
    <p role="status" aria-live="polite" className="font-serif text-sm">{message}</p>
    {selectedJob && <ResearchJob key={selectedJob} initialId={selectedJob} />}
  </section>;
}
