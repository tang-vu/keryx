"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { parseBuyerBudget } from "@/lib/a2a/buyer-workspace";
import { privateUsdc, type PrivateWorkspaceResult } from "@/lib/a2a/private-workspace";
import type { PrivateMerchantPolicy } from "@/lib/buyer/private-merchant-policy";
import { previewPrivateBrowserQuote } from "@/lib/buyer/private-browser-quote";
import { buyPrivateBrowserResearch } from "@/lib/buyer/private-browser-client";
import { recoverPrivateBrowserResearch } from "@/lib/buyer/private-browser-recovery";
import { listPrivateBrowserJournals, exportPrivateBrowserJournal, importPrivateBrowserJournal, type PrivateBrowserJournal } from "@/lib/buyer/private-browser-journal";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { downloadBuyerJson } from "@/lib/buyer/download";
import { ResearchPrivateResult } from "./research-private-result";
import { ResearchFunding } from "./research-funding";
import { WalletPicker } from "./wallet-picker";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
type Review = Awaited<ReturnType<typeof previewPrivateBrowserQuote>>;

export function ResearchPrivateCheckout({ merchants }: { merchants: PrivateMerchantPolicy }) {
  const { session } = useSiweAuth();
  return <section aria-labelledby="private-checkout-heading" className="border border-line bg-paper p-6">
    <h2 id="private-checkout-heading" className="font-display text-3xl">Buy private research</h2>
    <p className="mt-3 font-serif text-sm text-ink-2">Restricted Arc testnet pilot. Only the paying account can open the result. Keryx and the disclosed AI provider process your question; this is not end-to-end encryption.</p>
    {session === undefined ? <p className="mt-4" role="status">Checking sign-in…</p> : session
      ? <PrivateCheckout key={session.address.toLowerCase()} payer={session.address.toLowerCase()} merchants={merchants} />
      : <Link href="/connect" className="mt-4 inline-block underline">Sign in to buy private research</Link>}
  </section>;
}

function PrivateCheckout({ payer, merchants }: { payer: string; merchants: PrivateMerchantPolicy }) {
  const { address, chainId } = useAccount(), { data: wallet } = useWalletClient();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [question, setQuestion] = useState(""), [budgetText, setBudgetText] = useState("0.03"), [totalText, setTotalText] = useState("0.05");
  const [mode, setMode] = useState<"quick" | "deep">("quick"), [review, setReview] = useState<Review | null>(null);
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [fundingBusy, setFundingBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null), [result, setResult] = useState<PrivateWorkspaceResult | null>(null);
  const [message, setMessage] = useState(""), [rows, setRows] = useState<PrivateBrowserJournal[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null), mounted = useRef(true);
  const budget = parseBuyerBudget(budgetText, 1), total = parseBuyerBudget(totalText, 1);
  const limits = budget !== null && total !== null && total > budget ? {
    maxTotalMicros: String(Math.round(total * 1e6)), maxServiceFeeMicros: String(Math.round(total * 1e6) - Math.round(budget * 1e6)),
  } : null;
  const walletReady = !!wallet && address?.toLowerCase() === payer && chainId === 5042002;
  const locked = busy || fundingBusy;
  const refreshLocal = useCallback(async (after: string | null = null) => {
    const page = await listPrivateBrowserJournals(payer, merchants, after);
    if (mounted.current) { setRows(previous => after ? [...previous, ...page.jobs] : page.jobs); setCursor(page.nextCursor); }
  }, [payer, merchants]);
  useEffect(() => {
    mounted.current = true;
    void refreshLocal().catch(() => { if (mounted.current) setMessage("Local private recovery is unavailable. Check browser storage before buying."); });
    return () => { mounted.current = false; operation.current?.abort(); };
  }, [refreshLocal]);
  useEffect(() => () => { operation.current?.abort(); }, [address, chainId]);
  const fundingChanged = useCallback(() => { setMessage("Funding updated. Your Gateway balance will be checked again before signing."); }, []);
  function clearReview() { setReview(null); setAccepted(false); }
  async function work(action: (signal: AbortSignal) => Promise<void>, refresh = false) {
    if (operation.current || fundingBusy) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true);
    try { await action(abort.signal); }
    catch { if (mounted.current) setMessage("This action did not finish. Keep your local job and recover it before starting another purchase. Check sign-in, wallet, quote and browser storage."); }
    finally { if (operation.current === abort) operation.current = null; if (mounted.current) { setBusy(false); if (refresh) void refreshLocal().catch(() => undefined); } }
  }
  function preview() {
    if (!limits || budget === null || !question.trim() || activeId) return;
    clearReview(); setMessage("Loading private terms…");
    void work(async signal => {
      const value = await previewPrivateBrowserQuote({ question, budget, researchMode: mode, packageVersion: "1.0.0", responseMode: "async" }, payer, merchants, limits, undefined, signal);
      if (!signal.aborted && mounted.current) { setReview(value); setMessage(value.purchasingAvailable ? "Review the exact price and AI policy before buying." : "This account can preview terms, but private purchasing is currently unavailable."); }
    });
  }
  async function recover(id: string, signal: AbortSignal) {
    const recovered = await recoverPrivateBrowserResearch(id, payer, merchants, { signal });
    if (signal.aborted || !mounted.current) return;
    if (recovered.status === "recovered") { setResult(recovered.view); setMessage("Private job recovered. No new payment was sent."); }
    else setMessage(recovered.status === "unsigned-reservation"
      ? "No saved signature is available for this reservation. Keep it and check account history before starting another purchase."
      : "The server has no result available for this account yet. This does not prove that a payment failed. Recover the same job later.");
  }
  function purchase() {
    if (!walletReady || !wallet || !review?.purchasingAvailable || !accepted || !limits || activeId) return;
    setMessage("Checking the reviewed terms and wallet…");
    void work(async signal => {
      const signer = connectedBuyerWallet(wallet, payer, signal);
      const outcome = await buyPrivateBrowserResearch({ payer, merchants, limits, request: review.quote.request, acceptedQuote: review.quote,
        localStorageAccepted: accepted, ...signer, signal, onReserved: id => {
          if (mounted.current) { setActiveId(id); setAccepted(false); setMessage("Recovery saved. Check the exact payee and amount in your wallet before signing."); }
        } });
      if (signal.aborted || !mounted.current) return;
      setMessage(outcome.status === "response-received" ? "Purchase response received. Reading your private job…" : "Submission may be incomplete. Recovering the same job without another payment…");
      await recover(outcome.id, signal);
    }, true);
  }
  function open(id: string) {
    setActiveId(id); setResult(null); setReview(null); setAccepted(false); setMessage("Reading the original private job…");
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
      if (!signal.aborted && mounted.current) { setActiveId(imported.id); setResult(null); clearReview(); setMessage("Private recovery imported. Choose Recover to read the original job; importing never sends payment."); }
    }, true);
  }
  return <div className="mt-5 space-y-5">
    <p className="break-all font-mono text-xs">Paying account: {payer}</p>
    {!walletReady && <div className="flex flex-wrap items-center gap-3"><WalletPicker isBusy={locked} onConnected={() => setMessage("Wallet connected. Use the signed-in paying account on Arc testnet.")} />
      <p className="font-serif text-sm">Connect this paying account on Arc testnet to buy. Recovery only needs account sign-in.</p>
      {address?.toLowerCase() === payer && chainId !== 5042002 && <button className={control} disabled={locked || switching} onClick={() => void switchChainAsync({ chainId: 5042002 }).catch(() => setMessage("Switch to Arc testnet in your wallet."))}>Switch to Arc testnet</button>}
    </div>}
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="grid gap-2 text-sm sm:col-span-3">Private research question<textarea className="min-h-24 border border-line bg-paper-2 p-3" value={question} maxLength={2000} disabled={locked || !!activeId} onChange={event => { setQuestion(event.target.value); clearReview(); }} /></label>
      <label className="grid gap-2 text-sm">Private package<select className="border border-line bg-paper-2 p-3" value={mode} disabled={locked || !!activeId} onChange={event => { setMode(event.target.value as "quick" | "deep"); clearReview(); }}><option value="quick">Quick</option><option value="deep">Deep</option></select></label>
      <label className="grid gap-2 text-sm">Private creator cap (USDC)<input className="min-w-0 border border-line bg-paper-2 p-3" value={budgetText} inputMode="decimal" disabled={locked || !!activeId} onChange={event => { setBudgetText(event.target.value); clearReview(); }} /></label>
      <label className="grid gap-2 text-sm">Maximum total (USDC)<input className="min-w-0 border border-line bg-paper-2 p-3" value={totalText} inputMode="decimal" disabled={locked || !!activeId} onChange={event => { setTotalText(event.target.value); clearReview(); }} /></label>
    </div>
    <p className="font-serif text-sm text-ink-3">Maximum total must exceed the creator cap and be at most 1 USDC. The difference is your maximum service fee.</p>
    <button className={control} disabled={locked || !!activeId || !limits || !question.trim()} onClick={preview}>Review private price</button>
    {review && <div className="space-y-3 border border-line p-4">
      <p className="font-display text-2xl">Private total: {privateUsdc(review.quote.pricing.totalMicros)}</p>
      <p className="text-sm">Creator cap: {privateUsdc(review.quote.pricing.creatorBudgetMicros)} · Service fee: {privateUsdc(review.quote.pricing.serviceFeeMicros)}</p>
      <p className="break-all font-mono text-xs">Private payee: {merchants.privatePayee}</p>
      <p className="break-all text-sm">AI provider: {review.quote.request.reasoning.provider} · Model: {review.quote.request.reasoning.wireModel}<br />Endpoint: {review.quote.request.reasoning.endpoint}<br />Fallback: local heuristic. Redirects are prohibited.</p>
      <p className="text-sm">Fixed-price, best-effort research. Unused creator budget is retained, not refunded. A completed job may have insufficient evidence.</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={accepted} disabled={locked || !!activeId || !review.purchasingAvailable} onChange={event => setAccepted(event.target.checked)} />I accept these terms and storing this private question and payment signature in plaintext in this browser. Exported recovery files also contain them.</label>
      {review.purchasingAvailable && walletReady && <ResearchFunding payer={payer} initialAmount={Number(review.quote.pricing.totalMicros) / 1e6} disabled={busy || !!activeId} onBusy={setFundingBusy} onChanged={fundingChanged} />}
      <button className={control} disabled={locked || !!activeId || !walletReady || !accepted || !review.purchasingAvailable} onClick={purchase}>Buy private research</button>
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {activeId && <div className="flex flex-wrap gap-3">
      <button className={control} disabled={locked} onClick={() => open(activeId)}>Recover private purchase</button>
      <button className={control} disabled={locked} onClick={() => { setActiveId(null); setResult(null); clearReview(); setMessage("Review a new purchase explicitly. Your previous private job remains in local recovery and account history."); }}>Review a new purchase</button>
    </div>}
    {result && <ResearchPrivateResult job={result} />}
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="font-display text-xl">Local private recovery</h3>
      <p className="text-sm text-ink-3">These entries stay in this browser. Export only to private storage: recovery files contain the question and bearer payment signature. Import only a private Keryx recovery file for this paying account.</p>
      <label className="grid gap-2 text-sm">Import private recovery<input type="file" accept="application/json,.json" disabled={locked} onChange={event => { importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <button className={control} disabled={locked} onClick={() => void work(async () => refreshLocal())}>Refresh local private jobs</button>
      {rows.map(row => <div key={row.id} className="space-y-2 border border-line p-3">
        <p className="break-words text-sm">{row.draft.request.question}</p><p className="font-mono text-xs">{row.state === "reserved" ? "Signing incomplete" : row.state === "signed" ? "Signature saved; no submission recorded" : "Recovery only"}</p>
        <div className="flex flex-wrap gap-3"><button className={control} disabled={locked} onClick={() => open(row.id)}>Recover saved private job</button>
          {row.intent && <button className={control} disabled={locked} onClick={() => exportJob(row.id)}>Export private recovery</button>}</div>
      </div>)}
      {cursor && <button className={control} disabled={locked} onClick={() => void work(async () => refreshLocal(cursor))}>Load more local private jobs</button>}
    </div>
  </div>;
}
