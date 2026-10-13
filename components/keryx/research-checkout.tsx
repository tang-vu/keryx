"use client";
import { SigningAmount } from "./signing-amount";
import { formatAmount } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { WalletPicker } from "./wallet-picker";
import { ResearchFunding } from "./research-funding";
import { useResearchWorkspace } from "./research-workspace";
import { buyerRequestSchema, type BuyerRequest } from "@/lib/buyer/protocol";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { buyBrowserResearch } from "@/lib/buyer/browser-client";
import { downloadBuyerJson } from "@/lib/buyer/download";
import { ResearchJobTarget } from "./research-job-target";

const copy = createMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40";
type Review = { request: BuyerRequest; payer: string; payee: string; amount: string };

export function ResearchCheckout({ question, mode, budget, version, total, payee }: {
  question: string; mode: "quick" | "deep"; budget: number; version: string; total: number; payee: string;
}) {
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const workspace = useResearchWorkspace();
  const [review, setReview] = useState<Review | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [creditRevision, setCreditRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const parsed = buyerRequestSchema.safeParse({ question, budget, researchMode: mode, packageVersion: version, responseMode: "async" });
  const amount = String(Math.round(total * 1e6));
  const reviewCurrent = !!review && parsed.success && JSON.stringify(review.request) === JSON.stringify(parsed.data)
    && review.payer === address && review.payee === payee && review.amount === amount && chainId === browserPaymentProfile().chainId;

  useEffect(() => () => { operation.current?.abort(); }, []);

  async function purchase() {
    if (!wallet || !review || !reviewCurrent || !accepted || operation.current || fundingBusy) return;
    const abort = new AbortController(); operation.current = abort;
    setCreditRevision(value => value + 1);
    setBusy(true); setRecovery(null); setMessage(copy("researchCheckout.checking"));
    let preparedId: string | null = null;
    try {
      const signer = connectedBuyerWallet(wallet, review.payer, abort.signal);
      const result = await buyBrowserResearch({ request: review.request, payee: review.payee, payer: review.payer,
        acceptedTotalMicros: review.amount, ...signer, signal: abort.signal,
        onPrepared: intent => {
          abort.signal.throwIfAborted(); preparedId = intent.queryId;
          const text = JSON.stringify(intent, null, 2) + "\n";
          setRecovery(text); workspace.refresh();
          setMessage(copy("researchCheckout.recoveryReady"));
          downloadBuyerJson(text, "recovery");
        },
      });
      if (!abort.signal.aborted) {
        workspace.select(result.queryId); setReview(null); setAccepted(false);
        setMessage(result.status === "submitted" ? copy("researchCheckout.acknowledged")
          : copy("researchCheckout.uncertain"));
        if (result.evidence && !result.acknowledgementPersisted) setMessage(copy("researchCheckout.acknowledgementNotSaved"));
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (preparedId) workspace.select(preparedId);
        const detail = error instanceof Error ? error.message : "";
        setMessage(/reject|denied|cancel/i.test(detail) ? copy("researchCheckout.walletCancelled")
          : /price|challenge|SKIP/i.test(detail) ? copy("researchCheckout.quoteChanged")
          : /Insufficient Gateway/i.test(detail) ? copy("researchCheckout.insufficient")
          : copy("researchCheckout.stopped"));
        setReview(null); setAccepted(false);
      }
    } finally { if (operation.current === abort) operation.current = null; if (!abort.signal.aborted) setBusy(false); }
  }

  return <div className="mt-5 space-y-4 border border-line bg-paper-2 p-4">
    <h3 className="font-display text-2xl">{copy("researchCheckout.title")}</h3>
    <ResearchJobTarget mode={mode} version={version} />
    <p className="font-serif text-sm text-ink-2">{copy("researchCheckout.authorization", { network: browserPaymentProfile().label })}</p>
    {!address ? <WalletPicker isBusy={busy} onConnected={() => {}} /> : <>
      <p className="break-all font-mono text-xs">{copy("researchCheckout.wallet", { wallet: address })}</p>
      {chainId !== browserPaymentProfile().chainId ? <button type="button" disabled={busy || switching} className={control} onClick={() => {
        void switchChainAsync({ chainId: browserPaymentProfile().chainId }).catch(() => setMessage(copy("researchCheckout.switchFailed", { network: browserPaymentProfile().label })));
      }}>{switching ? copy("researchCheckout.switching") : copy("researchCheckout.switchNetwork", { network: browserPaymentProfile().label })}</button> : <>
        <ResearchFunding key={address} payer={address} initialAmount={total} requiredMicros={amount} creditRevision={creditRevision} disabled={busy} onBusy={setFundingBusy} onChanged={() => {}} />
        <button type="button" className={control} disabled={busy || !parsed.success || !wallet || BigInt(amount) > BigInt(1_000_000)} onClick={() => {
          if (!parsed.success || !address) return;
          setReview({ request: parsed.data, payer: address, payee, amount }); setAccepted(false); setMessage("");
        }}>{copy("researchCheckout.reviewPrice", { amount: total })}</button>
      </>}
    </>}
    {review && <div className="space-y-3 border-t border-line pt-4">
      <ResearchJobTarget mode={review.request.researchMode} version={review.request.packageVersion ?? version} />
      <p className="whitespace-pre-wrap break-words font-serif">{review.request.question}</p>
      <p className="text-xs"><SigningAmount micros={review.amount} /></p>
      <p className="font-mono text-xs">{copy(review.request.researchMode === "quick" ? "researchCheckout.quickSummary" : "researchCheckout.deepSummary", { amount: formatAmount(BigInt(review.amount), { minimumFractionDigits: 6, useGrouping: false }), cap: review.request.budget })}</p>
      <p className="break-all font-mono text-xs">{copy("researchCheckout.payee", { payee: review.payee })}</p>
      <label className="flex items-start gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} className="mt-1" />
        <span>{copy("researchCheckout.consent")}</span>
      </label>
      {!reviewCurrent && <p role="status" className="text-seal">{copy("researchCheckout.reviewChanged")}</p>}
      <button type="button" disabled={!accepted || !reviewCurrent || busy || fundingBusy} className={`${control} bg-ink text-paper`} onClick={() => { void purchase(); }}>{busy ? copy("researchCheckout.purchasing") : copy("researchCheckout.buy", { amount: formatAmount(BigInt(review.amount), { minimumFractionDigits: 6, useGrouping: false }) })}</button>
    </div>}
    {recovery && <button type="button" className={control} onClick={() => downloadBuyerJson(recovery, "recovery")}>{copy("researchCheckout.downloadRecovery")}</button>}
    <p role="status" aria-live="polite" className="font-serif text-sm">{message}</p>
  </div>;
}
