"use client";
import { SigningAmount } from "./signing-amount";
import { formatAmount } from "@/lib/i18n/format";


import { useEffect, useRef, useState } from "react";
import { maxUint256 } from "viem";
import { readWithdrawalBrowserJournal } from "@/lib/gateway/withdrawal-browser-journal";
import { signWithdrawalBrowserDraft, submitWithdrawalBrowserHttpOnce } from "@/lib/gateway/withdrawal-browser-flow";
import { withdrawalIdSchema, withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";
import { useUiMessages } from "@/lib/i18n/ui-copy";





type Wallet = Parameters<typeof signWithdrawalBrowserDraft>[2];
type Row = Awaited<ReturnType<typeof readWithdrawalBrowserJournal>>;
const button = "rounded border border-current px-4 py-2 text-sm disabled:opacity-50";

/** Review only an already-reserved original. This component never generates salts,
 * replaces drafts or grants imported files permission to submit a payment. */
export function WithdrawalReviewPanel({ id, address, wallet }: { id: string; address: string; wallet: Wallet }) {
  const uiCopy = useUiMessages();
  const owner = withdrawalOwnerSchema.safeParse(address), selected = withdrawalIdSchema.safeParse(id);
  if (!owner.success || !selected.success || wallet.account?.address.toLowerCase() !== owner.data)
    return <p>{uiCopy("withdrawalReview.connect")}</p>;
  return <ReviewOriginal key={`${owner.data}:${selected.data}`} id={selected.data} owner={owner.data} wallet={wallet} />;
}
function ReviewOriginal({ id, owner, wallet }: { id: string; owner: string; wallet: Wallet }) {
  const uiCopy = useUiMessages();
  const [row, setRow] = useState<Row | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null), gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    void readWithdrawalBrowserJournal(id, owner).then(saved => {
      if (!controller.signal.aborted) setRow(saved);
    }).catch(() => { if (!controller.signal.aborted) setMessage(uiCopy("withdrawalReview.unavailable")); });
    return () => { controller.abort(); gate.current = false; };
  }, [id, owner]);
  const current = () => active.current?.signal.aborted === false ? owner : null;
  const perform = async (kind: "sign" | "submit") => {
    const controller = active.current;
    if (!row || !controller || controller.signal.aborted || gate.current) return;
    const signal = controller.signal; gate.current = true; setBusy(true); setMessage("");
    try {
      if (kind === "sign") await signWithdrawalBrowserDraft(id, owner, wallet, current, signal);
      else await submitWithdrawalBrowserHttpOnce(id, owner, current, signal);
      signal.throwIfAborted();
      setMessage(kind === "sign" ? uiCopy("withdrawalReview.signed") : uiCopy("withdrawalReview.submitted"));
    } catch { if (!signal.aborted) setMessage(uiCopy("withdrawalReview.uncertain")); }
    finally {
      if (!signal.aborted) {
        try { const saved = await readWithdrawalBrowserJournal(id, owner); signal.throwIfAborted(); setRow(saved); }
        catch { if (!signal.aborted) setRow(null); }
      }
      if (active.current === controller) { gate.current = false; if (!signal.aborted) setBusy(false); }
    }
  };
  const intent = row?.draft.burnIntent, finite = intent && BigInt(intent.maxBlockHeight) < maxUint256;
  return <section aria-label={uiCopy("withdrawalReview.aria")} className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">{uiCopy("withdrawalReview.title")}</h2>
    <p>Arc Testnet · USDC</p>
    {intent && <dl className="space-y-2 text-sm">
      <div><dt>{uiCopy("withdrawalReview.amount")}</dt><dd><SigningAmount micros={intent.spec.value} /></dd></div>
      <div><dt>{uiCopy("withdrawalReview.fee")}</dt><dd><SigningAmount micros={intent.maxFee} /></dd></div>
      <div><dt>{uiCopy("withdrawalReview.debit")}</dt><dd><SigningAmount micros={BigInt(intent.spec.value) + BigInt(intent.maxFee)} /></dd></div>
      <div><dt>{uiCopy("withdrawalReview.recipient")}</dt><dd className="break-all">{row!.draft.policy.recipient}</dd></div>
      <div><dt>{uiCopy("withdrawalReview.expiry")}</dt><dd>{finite ? intent.maxBlockHeight : uiCopy("withdrawalReview.noExpiry")}</dd></div>
    </dl>}
    <p className="text-sm">{uiCopy("withdrawalReview.signingBoundary")}</p>
    <div className="flex flex-wrap gap-3">
      {row?.origin === "created" && row.state === "reserved" && finite &&
        <button type="button" className={button} disabled={busy} onClick={() => void perform("sign")}>{uiCopy("withdrawalReview.sign")}</button>}
      {row?.origin === "created" && row.state === "signed" && finite &&
        <button type="button" className={button} disabled={busy} onClick={() => void perform("submit")}>{uiCopy("withdrawalReview.send")}</button>}
    </div>
    {row?.state === "submission-possible" && <p>{uiCopy("withdrawalReview.recoveryOnly")}</p>}
    <p role="status" aria-live="polite">{message || (busy ? uiCopy("withdrawalReview.waiting") : !row ? uiCopy("withdrawalReview.loading") : "")}</p>
  </section>;
}
