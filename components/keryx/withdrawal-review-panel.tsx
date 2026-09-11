"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, maxUint256 } from "viem";
import { readWithdrawalBrowserJournal } from "@/lib/gateway/withdrawal-browser-journal";
import { signWithdrawalBrowserDraft, submitWithdrawalBrowserHttpOnce } from "@/lib/gateway/withdrawal-browser-flow";
import { withdrawalIdSchema, withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";

type Wallet = Parameters<typeof signWithdrawalBrowserDraft>[2];
type Row = Awaited<ReturnType<typeof readWithdrawalBrowserJournal>>;
const button = "rounded border border-current px-4 py-2 text-sm disabled:opacity-50";

/** Review only an already-reserved original. This component never generates salts,
 * replaces drafts or grants imported files permission to submit a payment. */
export function WithdrawalReviewPanel({ id, address, wallet }: { id: string; address: string; wallet: Wallet }) {
  const owner = withdrawalOwnerSchema.safeParse(address), selected = withdrawalIdSchema.safeParse(id);
  if (!owner.success || !selected.success || wallet.account?.address.toLowerCase() !== owner.data)
    return <p>Connect the original wallet to review this withdrawal.</p>;
  return <ReviewOriginal key={`${owner.data}:${selected.data}`} id={selected.data} owner={owner.data} wallet={wallet} />;
}
function ReviewOriginal({ id, owner, wallet }: { id: string; owner: string; wallet: Wallet }) {
  const [row, setRow] = useState<Row | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null), gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    void readWithdrawalBrowserJournal(id, owner).then(saved => {
      if (!controller.signal.aborted) setRow(saved);
    }).catch(() => { if (!controller.signal.aborted) setMessage("The saved original is unavailable. Keep your recovery file; do not create another request as a retry."); });
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
      setMessage(kind === "sign" ? "Signature saved. Review the details again before sending." : "Submission attempt saved. Check recovery status for the original request.");
    } catch { if (!signal.aborted) setMessage("The operation did not finish. Your saved original is retained; use recovery to check its state."); }
    finally {
      if (!signal.aborted) {
        try { const saved = await readWithdrawalBrowserJournal(id, owner); signal.throwIfAborted(); setRow(saved); }
        catch { if (!signal.aborted) setRow(null); }
      }
      if (active.current === controller) { gate.current = false; if (!signal.aborted) setBusy(false); }
    }
  };
  const intent = row?.draft.burnIntent, finite = intent && BigInt(intent.maxBlockHeight) < maxUint256;
  return <section aria-label="Review withdrawal" className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">Review your withdrawal</h2>
    <p>Arc Testnet · USDC</p>
    {intent && <dl className="space-y-2 text-sm">
      <div><dt>Amount received</dt><dd>{formatUnits(BigInt(intent.spec.value), 6)} USDC</dd></div>
      <div><dt>Maximum Circle fee</dt><dd>{formatUnits(BigInt(intent.maxFee), 6)} USDC</dd></div>
      <div><dt>Maximum Gateway debit</dt><dd>{formatUnits(BigInt(intent.spec.value) + BigInt(intent.maxFee), 6)} USDC</dd></div>
      <div><dt>Recipient</dt><dd className="break-all">{row!.draft.policy.recipient}</dd></div>
      <div><dt>Authorization expires at source block</dt><dd>{finite ? intent.maxBlockHeight : "No finite expiry — recovery only"}</dd></div>
    </dl>}
    <p className="text-sm">Signing saves this authorization locally. Sending is a separate step. The server checks its expiry again before transfer.</p>
    <div className="flex flex-wrap gap-3">
      {row?.origin === "created" && row.state === "reserved" && finite &&
        <button type="button" className={button} disabled={busy} onClick={() => void perform("sign")}>Sign reviewed withdrawal</button>}
      {row?.origin === "created" && row.state === "signed" && finite &&
        <button type="button" className={button} disabled={busy} onClick={() => void perform("submit")}>Send signed withdrawal</button>}
    </div>
    {row?.state === "submission-possible" && <p>This request is recovery-only. Check its status in withdrawal recovery.</p>}
    <p role="status" aria-live="polite">{message || (busy ? "Waiting for this operation…" : !row ? "Loading saved original…" : "")}</p>
  </section>;
}
