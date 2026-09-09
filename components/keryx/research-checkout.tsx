"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { WalletPicker } from "./wallet-picker";
import { ResearchFunding } from "./research-funding";
import { useResearchWorkspace } from "./research-workspace";
import { buyerRequestSchema, type BuyerRequest } from "@/lib/buyer/protocol";
import { connectedBuyerWallet } from "@/lib/buyer/connected-wallet";
import { buyBrowserResearch } from "@/lib/buyer/browser-client";
import { downloadBuyerJson } from "@/lib/buyer/download";

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
  const [message, setMessage] = useState("");
  const [credit, setCredit] = useState<{ address: string; micros: string } | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const parsed = buyerRequestSchema.safeParse({ question, budget, researchMode: mode, packageVersion: version, responseMode: "async" });
  const amount = String(Math.round(total * 1e6));
  const reviewCurrent = !!review && parsed.success && JSON.stringify(review.request) === JSON.stringify(parsed.data)
    && review.payer === address && review.payee === payee && review.amount === amount && chainId === 5042002;
  const currentCredit = credit && credit.address === address ? credit.micros : null;

  useEffect(() => () => { operation.current?.abort(); }, []);

  async function checkBalance() {
    if (!wallet || !address || operation.current || fundingBusy) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true); setMessage("Checking your Gateway balance…");
    try {
      const value = await connectedBuyerWallet(wallet, address, abort.signal).readWallet();
      if (!abort.signal.aborted) { setCredit({ address, micros: value.gatewayBalanceMicros }); setMessage("Gateway balance checked. No payment was made."); }
    } catch {
      if (!abort.signal.aborted) { setCredit(null); setMessage("Could not check this wallet on Arc testnet. Retry before adding funds."); }
    } finally { if (operation.current === abort) operation.current = null; if (!abort.signal.aborted) setBusy(false); }
  }

  async function purchase() {
    if (!wallet || !review || !reviewCurrent || !accepted || operation.current || fundingBusy) return;
    const abort = new AbortController(); operation.current = abort;
    setBusy(true); setRecovery(null); setMessage("Checking the current price and wallet…");
    let preparedId: string | null = null;
    try {
      const signer = connectedBuyerWallet(wallet, review.payer, abort.signal);
      const result = await buyBrowserResearch({ request: review.request, payee: review.payee, payer: review.payer,
        acceptedTotalMicros: review.amount, ...signer, signal: abort.signal,
        onPrepared: intent => {
          abort.signal.throwIfAborted(); preparedId = intent.queryId;
          const text = JSON.stringify(intent, null, 2) + "\n";
          setRecovery(text); workspace.refresh();
          setMessage("Recovery file is ready. Check the exact amount and payee in your wallet before signing.");
          downloadBuyerJson(text, "recovery");
        },
      });
      if (!abort.signal.aborted) {
        workspace.select(result.queryId); setReview(null); setAccepted(false); setCredit(null);
        setMessage(result.status === "submitted" ? "Purchase acknowledged. Following the original job below. Keep your recovery file."
          : "The submission is uncertain. Keep the recovery file and open this job below; do not pay again to recover it.");
        if (result.evidence && !result.acknowledgementPersisted) setMessage("The seller returned a payment acknowledgement, but it could not be saved locally. Keep this tab and recovery file; use the same job for lookup.");
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        if (preparedId) workspace.select(preparedId);
        const detail = error instanceof Error ? error.message : "";
        setMessage(/reject|denied|cancel/i.test(detail) ? "Wallet request cancelled. No signed purchase request was sent by this attempt."
          : /price|challenge|SKIP/i.test(detail) ? "The current quote did not match this review. Review the price again before buying."
          : /Insufficient Gateway/i.test(detail) ? "This wallet has insufficient Gateway funds. No signed purchase request was sent."
          : "Purchase stopped before submitting a signed request. Check your wallet, balance and browser storage, then review again. Any saved job remains available below.");
        setReview(null); setAccepted(false);
      }
    } finally { if (operation.current === abort) operation.current = null; if (!abort.signal.aborted) setBusy(false); }
  }

  return <div className="mt-5 space-y-4 border border-line bg-paper-2 p-4">
    <h3 className="font-display text-2xl">Buy with your wallet</h3>
    <p className="font-serif text-sm text-ink-2">One signature authorizes this fixed-price research job from your wallet’s Gateway balance. Arc testnet only. Externally owned accounts (EOAs) are supported.</p>
    {!address ? <WalletPicker isBusy={busy} onConnected={() => {}} /> : <>
      <p className="break-all font-mono text-xs">Buyer wallet: {address}</p>
      {chainId !== 5042002 ? <button type="button" disabled={busy || switching} className={control} onClick={() => {
        void switchChainAsync({ chainId: 5042002 }).catch(() => setMessage("Network switch was not completed. Choose Arc testnet in your wallet."));
      }}>{switching ? "Switching…" : "Switch to Arc testnet"}</button> : <>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || fundingBusy || !wallet} className={control} onClick={() => { void checkBalance(); }}>Check Gateway balance</button>
          <span className="font-mono text-xs">Available: {currentCredit === null ? "not checked" : `${formatUnits(BigInt(currentCredit), 6)} USDC`}</span>
        </div>
        {currentCredit !== null && BigInt(currentCredit) < BigInt(amount) && <p className="font-serif text-sm text-seal">Gateway funds are below the package price. Wallet gas balance and Gateway funds are separate. Use the deposit controls below, then check Gateway balance again.</p>}
        <ResearchFunding key={address} payer={address} initialAmount={total} disabled={busy} onBusy={setFundingBusy} onChanged={() => setCredit(null)} />
        <button type="button" className={control} disabled={busy || !parsed.success || !wallet || BigInt(amount) > BigInt(1_000_000)} onClick={() => {
          if (!parsed.success || !address) return;
          setReview({ request: parsed.data, payer: address, payee, amount }); setAccepted(false); setMessage("");
        }}>Review {total} USDC purchase</button>
      </>}
    </>}
    {review && <div className="space-y-3 border-t border-line pt-4">
      <p className="whitespace-pre-wrap break-words font-serif">{review.request.question}</p>
      <p className="font-mono text-xs">{review.request.researchMode === "quick" ? "Quick" : "Deep"} · {formatUnits(BigInt(review.amount), 6)} USDC total · {review.request.budget} USDC creator cap</p>
      <p className="break-all font-mono text-xs">Payee: {review.payee}</p>
      <label className="flex items-start gap-3 font-serif text-sm"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} className="mt-1" />
        <span>I accept the fixed, non-refundable price and best-effort research. Unused creator reserve is retained, not refunded. My question and recovery journal will be stored on this device; I will keep a private recovery file in case browser data is lost.</span>
      </label>
      {!reviewCurrent && <p role="status" className="text-seal">The question, price or wallet changed. Review the purchase again.</p>}
      <button type="button" disabled={!accepted || !reviewCurrent || busy || fundingBusy} className={`${control} bg-ink text-paper`} onClick={() => { void purchase(); }}>{busy ? "Purchase in progress…" : `Buy research — ${formatUnits(BigInt(review.amount), 6)} USDC`}</button>
    </div>}
    {recovery && <button type="button" className={control} onClick={() => downloadBuyerJson(recovery, "recovery")}>Download recovery file</button>}
    <p role="status" aria-live="polite" className="font-serif text-sm">{message}</p>
  </div>;
}
