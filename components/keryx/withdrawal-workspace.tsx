"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatUnits, parseUnits } from "viem";
import { withdrawPolicySchema, type WithdrawPolicy } from "@/lib/gateway/withdraw-protocol";
import { withdrawalOwnerSchema } from "@/lib/gateway/withdrawal-request";
import { prepareWithdrawalBrowserDraft } from "@/lib/gateway/withdrawal-browser-prepare";
import { WithdrawalReviewPanel } from "./withdrawal-review-panel";
import { WithdrawalRecoveryPanel } from "./withdrawal-recovery-panel";
import type { signWithdrawalBrowserDraft } from "@/lib/gateway/withdrawal-browser-flow";

type Wallet = Parameters<typeof signWithdrawalBrowserDraft>[2];
type Limits = Omit<WithdrawPolicy, "owner" | "recipient">;
const button = "rounded border border-current px-4 py-2 text-sm disabled:opacity-50";

/** Limits are an explicit public allowlist from the reviewed server configuration,
 * never the preparation response. Mount only with the complete HTTP/relay service. */
export function WithdrawalWorkspace({ address, wallet, limits }: {
  address: string | null; wallet: Wallet | null; limits: Limits | null;
}) {
  const parsed = withdrawalOwnerSchema.safeParse(address);
  if (!parsed.success || !wallet || wallet.account?.address.toLowerCase() !== parsed.data)
    return <p>Connect your wallet to manage withdrawals.</p>;
  const selected = withdrawPolicySchema.omit({ owner: true, recipient: true }).safeParse(limits);
  if (!selected.success || selected.data.domain !== 26 || BigInt(selected.data.maxValueMicros) === BigInt(0))
    return <div className="space-y-6"><p>New withdrawals are unavailable. You can still recover saved requests.</p>
      <WithdrawalRecoveryPanel address={parsed.data} /></div>;
  return <OwnerWorkspace key={`${parsed.data}:${JSON.stringify(selected.data)}`} owner={parsed.data} wallet={wallet} limits={selected.data} />;
}

function OwnerWorkspace({ owner, wallet, limits }: { owner: string; wallet: Wallet; limits: Limits }) {
  const [amount, setAmount] = useState(""), [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null), gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    return () => { controller.abort(); gate.current = false; };
  }, []);
  const prepare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const controller = active.current;
    if (!controller || controller.signal.aborted || gate.current || id) return;
    let micros: string;
    try {
      // Reject extra precision instead of allowing parseUnits to round money.
      if (!/^(0|[1-9][0-9]{0,77})(\.[0-9]{1,6})?$/.test(amount)) throw new Error();
      micros = parseUnits(amount, 6).toString();
      if (BigInt(micros) <= BigInt(0) || BigInt(micros) > BigInt(limits.maxValueMicros)) throw new Error();
    } catch { setMessage("Enter a positive USDC amount within the limit, with at most 6 decimal places."); return; }
    gate.current = true; setBusy(true); setMessage("");
    try {
      const row = await prepareWithdrawalBrowserDraft({ ...limits, owner: owner as WithdrawPolicy["owner"],
        recipient: owner as WithdrawPolicy["recipient"], maxValueMicros: micros },
      () => !controller.signal.aborted ? owner : null, controller.signal);
      controller.signal.throwIfAborted(); setId(row.id);
      setMessage("Unsigned draft saved. Review it before signing.");
    } catch { if (!controller.signal.aborted) setMessage("Preparation did not finish. Refresh saved requests before preparing again; a draft may already be saved."); }
    finally { if (active.current === controller) { gate.current = false; if (!controller.signal.aborted) setBusy(false); } }
  };
  return <div className="space-y-6">
    <section aria-label="Prepare withdrawal" className="space-y-4 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Withdraw USDC</h2>
      <p>Arc Testnet · Funds go to your connected wallet.</p>
      <p className="break-all text-sm">Recipient: {owner}</p>
      <p className="text-sm">Amount limit: {formatUnits(BigInt(limits.maxValueMicros), 6)} USDC.
        Maximum Circle fee: {formatUnits(BigInt(limits.maxFeeMicros), 6)} USDC, charged in addition to the amount.</p>
      {!id ? <form onSubmit={event => void prepare(event)} className="space-y-3">
        <label className="block">Amount to receive (USDC)
          <input className="mt-1 block w-full rounded border bg-transparent p-2" aria-label="Amount to receive (USDC)"
            inputMode="decimal" autoComplete="off" maxLength={85} value={amount} disabled={busy}
            onChange={event => setAmount(event.target.value)} /></label>
        <button type="submit" className={button} disabled={busy}>Prepare withdrawal</button>
        <p className="text-sm">Preparation saves an unsigned draft. Review, signing and sending are separate steps.</p>
      </form> : <div className="space-y-2">
        <p className="text-sm">Preparing another withdrawal creates a separate request. Use saved requests to resume this one.</p>
        <button type="button" className={button} onClick={() => { setId(null); setAmount(""); setMessage(""); }}>Prepare another withdrawal</button>
      </div>}
      <p role="status" aria-live="polite">{busy ? "Preparing and saving unsigned terms…" : message}</p>
    </section>
    {id && <WithdrawalReviewPanel id={id} address={owner} wallet={wallet} />}
    <WithdrawalRecoveryPanel address={owner} onReview={selected => { if (!gate.current) { setId(selected); setMessage(""); } }} />
  </div>;
}
