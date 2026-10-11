"use client";
import { SigningAmount } from "./signing-amount";
import { formatSigningUsdc } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { parseBuyerBudget } from "@/lib/a2a/buyer-workspace";
import { type PrivateWorkspaceResult } from "@/lib/a2a/private-workspace";
import type { PrivateMerchantPolicy } from "@/lib/buyer/private-merchant-policy";
import { previewPrivateBrowserQuote } from "@/lib/buyer/private-browser-quote";
import { buyPrivateBrowserResearch } from "@/lib/buyer/private-browser-client";
import { recoverPrivateBrowserResearch } from "@/lib/buyer/private-browser-recovery";
import { listPrivateBrowserJournals, exportPrivateBrowserJournal, importPrivateBrowserJournal, deletePrivateBrowserJournal, type PrivateBrowserJournal } from "@/lib/buyer/private-browser-journal";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { downloadBuyerJson } from "@/lib/buyer/download";
import { ResearchPrivateResult } from "./research-private-result";
import { ResearchFunding } from "./research-funding";
import { WalletPicker } from "./wallet-picker";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
type Review = Awaited<ReturnType<typeof previewPrivateBrowserQuote>>;

export function ResearchPrivateCheckout({ merchants }: { merchants: PrivateMerchantPolicy }) {
  const { session } = useSiweAuth();
  return <section aria-labelledby="private-checkout-heading" className="border border-line bg-paper p-6">
    <h2 id="private-checkout-heading" className="font-display text-3xl">{copy("privateCheckout.title")}</h2>
    <p className="mt-3 font-serif text-sm text-ink-2">{copy("privateCheckout.privacy", { network: browserPaymentProfile().label })}</p>
    {session === undefined ? <p className="mt-4" role="status">{copy("privateCheckout.checkingSignIn")}</p> : session
      ? <PrivateCheckout key={session.address.toLowerCase()} payer={session.address.toLowerCase()} merchants={merchants} />
      : <Link href="/connect" className="mt-4 inline-block underline">{copy("privateCheckout.signIn")}</Link>}
  </section>;
}

function PrivateCheckout({ payer, merchants }: { payer: string; merchants: PrivateMerchantPolicy }) {
  const { address, chainId } = useAccount(), { data: wallet } = useWalletClient();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [question, setQuestion] = useState(""), [budgetText, setBudgetText] = useState("0.03"), [totalText, setTotalText] = useState("0.05");
  const [mode, setMode] = useState<"quick" | "deep">("quick"), [review, setReview] = useState<Review | null>(null);
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [fundingBusy, setFundingBusy] = useState(false);
  const [creditRevision, setCreditRevision] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null), [result, setResult] = useState<PrivateWorkspaceResult | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [rows, setRows] = useState<PrivateBrowserJournal[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null), mounted = useRef(true);
  const budget = parseBuyerBudget(budgetText, 1), total = parseBuyerBudget(totalText, 1);
  const limits = budget !== null && total !== null && total > budget ? {
    maxTotalMicros: String(Math.round(total * 1e6)), maxServiceFeeMicros: String(Math.round(total * 1e6) - Math.round(budget * 1e6)),
  } : null;
  const walletReady = !!wallet && address?.toLowerCase() === payer && chainId === browserPaymentProfile().chainId;
  const locked = busy || fundingBusy;
  const refreshLocal = useCallback(async (after: string | null = null) => {
    const page = await listPrivateBrowserJournals(payer, merchants, after);
    if (mounted.current) { setRows(previous => after ? [...previous, ...page.jobs] : page.jobs); setCursor(page.nextCursor); }
  }, [payer, merchants]);
  useEffect(() => {
    mounted.current = true;
    void refreshLocal().catch(() => { if (mounted.current) setMessage(copy("privateCheckout.localRecoveryUnavailable")); });
    return () => { mounted.current = false; operation.current?.abort(); };
  }, [refreshLocal]);
  useEffect(() => () => { operation.current?.abort(); }, [address, chainId]);
  const fundingChanged = useCallback(() => { setMessage(copy("privateCheckout.fundingUpdated")); }, []);
  function clearReview() { setReview(null); setAccepted(false); }
  async function work(action: (signal: AbortSignal) => Promise<void>, refresh = false) {
    if (operation.current || fundingBusy) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true);
    try { await action(abort.signal); }
    catch { if (mounted.current) setMessage(copy("privateCheckout.incomplete")); }
    finally { if (operation.current === abort) operation.current = null; if (mounted.current) { setBusy(false); if (refresh) void refreshLocal().catch(() => undefined); } }
  }
  function preview() {
    if (!limits || budget === null || !question.trim() || activeId) return;
    clearReview(); setMessage(copy("privateCheckout.loadingTerms"));
    void work(async signal => {
      const value = await previewPrivateBrowserQuote({ question, budget, researchMode: mode, packageVersion: "1.0.0", responseMode: "async" }, payer, merchants, limits, undefined, signal);
      if (!signal.aborted && mounted.current) { setReview(value); setMessage(value.purchasingAvailable ? copy("privateCheckout.reviewTerms") : copy("privateCheckout.previewOnly")); }
    });
  }
  async function recover(id: string, signal: AbortSignal) {
    const recovered = await recoverPrivateBrowserResearch(id, payer, merchants, { signal });
    if (signal.aborted || !mounted.current) return;
    if (recovered.status === "recovered") { setResult(recovered.view); setMessage(copy("privateCheckout.recovered")); }
    else setMessage(recovered.status === "unsigned-reservation"
      ? copy("privateCheckout.unsignedReservation")
      : copy("privateCheckout.noResult"));
  }
  function purchase() {
    if (!walletReady || !wallet || !review?.purchasingAvailable || !accepted || !limits || activeId) return;
    setCreditRevision(value => value + 1);
    setMessage(copy("privateCheckout.checkingTerms"));
    void work(async signal => {
      const signer = connectedBuyerWallet(wallet, payer, signal);
      const outcome = await buyPrivateBrowserResearch({ payer, merchants, limits, request: review.quote.request, acceptedQuote: review.quote,
        localStorageAccepted: accepted, ...signer, signal, onReserved: id => {
          if (mounted.current) { setActiveId(id); setAccepted(false); setMessage(copy("privateCheckout.recoverySaved")); }
        } });
      if (signal.aborted || !mounted.current) return;
      setMessage(outcome.status === "response-received" ? copy("privateCheckout.responseReceived") : copy("privateCheckout.submissionIncomplete"));
      await recover(outcome.id, signal);
    }, true);
  }
  function open(id: string) {
    setActiveId(id); setResult(null); setReview(null); setAccepted(false); setMessage(copy("privateCheckout.readingJob"));
    void work(signal => recover(id, signal));
  }
  function exportJob(id: string) {
    void work(async signal => { const text = await exportPrivateBrowserJournal(id, payer, merchants); if (!signal.aborted && mounted.current) downloadBuyerJson(text, "recovery"); });
  }
  function importFile(file: File | undefined) {
    if (!file) return;
    void work(async signal => {
      if (file.size > 65536) throw new Error("Recovery file too large");
      const imported = await importPrivateBrowserJournal(JSON.parse(await file.text()), payer, merchants);
      if (!signal.aborted && mounted.current) { setActiveId(imported.id); setResult(null); clearReview(); setMessage(copy("privateCheckout.imported")); }
    }, true);
  }
  function deleteLocal(id: string) {
    void work(async () => {
      await deletePrivateBrowserJournal(id, payer, merchants);
      if (mounted.current) {
        setRows(previous => previous.filter(row => row.id !== id)); setDeletingId(null);
        setActiveId(null); setResult(null); setQuestion(""); clearReview();
        setMessage(copy("privateCheckout.deleted"));
      }
    }, true);
  }
  return <div className="mt-5 space-y-5">
    <p className="break-all font-mono text-xs">{copy("privateCheckout.payer", { payer })}</p>
    {!walletReady && <div className="flex flex-wrap items-center gap-3"><WalletPicker isBusy={locked} onConnected={() => setMessage(copy("privateCheckout.walletConnected", { network: browserPaymentProfile().label }))} />
      <p className="font-serif text-sm">{copy("privateCheckout.connectPayer", { network: browserPaymentProfile().label })}</p>
      {address?.toLowerCase() === payer && chainId !== browserPaymentProfile().chainId && <button className={control} disabled={locked || switching} onClick={() => void switchChainAsync({ chainId: browserPaymentProfile().chainId }).catch(() => setMessage(copy("privateCheckout.switchInstruction", { network: browserPaymentProfile().label })))}>{copy("privateCheckout.switchNetwork", { network: browserPaymentProfile().label })}</button>}
    </div>}
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="grid gap-2 text-sm sm:col-span-3">{copy("privateCheckout.question")}<textarea className="min-h-24 border border-line bg-paper-2 p-3" value={question} maxLength={2000} disabled={locked || !!activeId} onChange={event => { setQuestion(event.target.value); clearReview(); }} /></label>
      <label className="grid gap-2 text-sm">{copy("privateCheckout.package")}<select className="border border-line bg-paper-2 p-3" value={mode} disabled={locked || !!activeId} onChange={event => { setMode(event.target.value as "quick" | "deep"); clearReview(); }}><option value="quick">{copy("privateCheckout.quick")}</option><option value="deep">{copy("privateCheckout.deep")}</option></select></label>
      <label className="grid gap-2 text-sm">{copy("privateCheckout.creatorCap")}<input className="min-w-0 border border-line bg-paper-2 p-3" value={budgetText} inputMode="decimal" disabled={locked || !!activeId} onChange={event => { setBudgetText(event.target.value); clearReview(); }} /></label>
      <label className="grid gap-2 text-sm">{copy("privateCheckout.maximumTotal")}<input className="min-w-0 border border-line bg-paper-2 p-3" value={totalText} inputMode="decimal" disabled={locked || !!activeId} onChange={event => { setTotalText(event.target.value); clearReview(); }} /></label>
    </div>
    <p className="font-serif text-sm text-ink-3">{copy("privateCheckout.priceLimits")}</p>
    <button className={control} disabled={locked || !!activeId || !limits || !question.trim()} onClick={preview}>{copy("privateCheckout.reviewPrice")}</button>
    {review && <div className="space-y-3 border border-line p-4">
      <p className="text-xs"><SigningAmount micros={review.quote.pricing.totalMicros} /></p>
      <p className="font-display text-2xl">{copy("privateCheckout.total", { amount: formatSigningUsdc(review.quote.pricing.totalMicros) })}</p>
      <p className="text-sm">{copy("privateCheckout.pricing", { cap: formatSigningUsdc(review.quote.pricing.creatorBudgetMicros), fee: formatSigningUsdc(review.quote.pricing.serviceFeeMicros) })}</p>
      <p className="break-all font-mono text-xs">{copy("privateCheckout.payee", { payee: merchants.privatePayee })}</p>
      <p className="break-all text-sm">{richCopy("privateCheckout.aiPolicy", { provider: review.quote.request.reasoning.provider, model: review.quote.request.reasoning.wireModel, endpoint: review.quote.request.reasoning.endpoint, lineBreak: <br /> })}</p>
      <p className="text-sm">{copy("privateCheckout.fixedPriceNotice")}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={accepted} disabled={locked || !!activeId || !review.purchasingAvailable} onChange={event => setAccepted(event.target.checked)} />{copy("privateCheckout.consent")}</label>
      {review.purchasingAvailable && walletReady && <ResearchFunding payer={payer} initialAmount={Number(review.quote.pricing.totalMicros) / 1e6} requiredMicros={review.quote.pricing.totalMicros} creditRevision={creditRevision} disabled={busy || !!activeId} onBusy={setFundingBusy} onChanged={fundingChanged} />}
      <button className={control} disabled={locked || !!activeId || !walletReady || !accepted || !review.purchasingAvailable} onClick={purchase}>{copy("privateCheckout.title")}</button>
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {activeId && <div className="flex flex-wrap gap-3">
      <button className={control} disabled={locked} onClick={() => open(activeId)}>{copy("privateCheckout.recoverPurchase")}</button>
      <button className={control} disabled={locked} onClick={() => { setActiveId(null); setResult(null); clearReview(); setMessage(copy("privateCheckout.newPurchaseNotice")); }}>{copy("privateCheckout.newPurchase")}</button>
    </div>}
    {result && <ResearchPrivateResult job={result} />}
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="font-display text-xl">{copy("privateCheckout.recoveryTitle")}</h3>
      <p className="text-sm text-ink-3">{copy("privateCheckout.recoveryNotice")}</p>
      <label className="grid gap-2 text-sm">{copy("privateCheckout.import")}<input type="file" accept="application/json,.json" disabled={locked} onChange={event => { importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <button className={control} disabled={locked} onClick={() => void work(async () => refreshLocal())}>{copy("privateCheckout.refresh")}</button>
      {rows.map(row => <div key={row.id} className="space-y-2 border border-line p-3">
        <p className="break-words text-sm">{row.draft.request.question}</p><p className="font-mono text-xs">{row.state === "reserved" ? copy("privateCheckout.signingIncomplete") : row.state === "signed" ? copy("privateCheckout.signatureSaved") : copy("privateCheckout.recoveryOnly")}</p>
        <div className="flex flex-wrap gap-3"><button className={control} disabled={locked} onClick={() => open(row.id)}>{copy("privateCheckout.recoverSaved")}</button>
          {row.intent && <button className={control} disabled={locked} onClick={() => exportJob(row.id)}>{copy("privateCheckout.export")}</button>}
          <button className={control} disabled={locked} onClick={() => setDeletingId(row.id)}>{copy("privateCheckout.delete")}</button></div>
        {deletingId === row.id && <div role="group" aria-label={copy("privateCheckout.deleteLabel")} className="space-y-3 border border-line p-3">
          <p className="text-sm">{copy("privateCheckout.deleteQuestion")}</p>
          <p className="text-sm">{copy("privateCheckout.deleteBoundary")}</p>
          <div className="flex flex-wrap gap-3"><button className={control} disabled={locked} onClick={() => deleteLocal(row.id)}>{copy("privateCheckout.confirmDelete")}</button>
            <button className={control} disabled={locked} onClick={() => setDeletingId(null)}>{copy("privateCheckout.keep")}</button></div>
        </div>}
      </div>)}
      {cursor && <button className={control} disabled={locked} onClick={() => void work(async () => refreshLocal(cursor))}>{copy("privateCheckout.loadMore")}</button>}
    </div>
  </div>;
}
