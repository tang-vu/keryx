"use client";

/**
 * WithdrawEarningsPanel — lets a connected creator pull their accrued Circle Gateway balance
 * back on-chain into their own wallet, in one signature, gasless.
 *
 * Flow: read the Gateway available balance for the connected address → creator signs a burn
 * intent (no gas, no network switch) → POST /api/withdraw relays it to Circle and the Keryx
 * treasury submits the mint → the real EVM mint tx is shown (and appears in Creator cash-outs).
 *
 * Styled to match The Mint aesthetic (banknote frame, mono labels).
 */

import { useCallback, useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { Loader2, ArrowUpRight, Coins } from "lucide-react";
import { toast } from "sonner";
import { buildAndSignWithdrawIntent } from "@/lib/gateway/withdraw-intent";
import { config } from "@/lib/config";
import { fmtUsdc } from "./phase-style";

export function WithdrawEarningsPanel({ address }: { address: string }) {
  const { data: walletClient } = useWalletClient();
  const [availableAtomic, setAvailableAtomic] = useState<bigint | null>(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    try {
      const res = await fetch(`/api/session/credit?address=${encodeURIComponent(address)}`);
      const data = (await res.json().catch(() => ({}))) as { available?: string };
      setAvailableAtomic(BigInt(data.available ?? "0"));
    } catch {
      setAvailableAtomic(BigInt(0));
    }
  }, [address]);

  useEffect(() => {
    (async () => {
      await loadBalance();
    })();
  }, [loadBalance]);

  const available = availableAtomic === null ? null : Number(availableAtomic) / 1e6;
  const hasFunds = availableAtomic !== null && availableAtomic > BigInt(0);

  const withdraw = async () => {
    if (busy || !availableAtomic || availableAtomic <= BigInt(0)) return;
    if (!walletClient) {
      toast.error("Connect your wallet to withdraw.");
      return;
    }
    setBusy(true);
    setLastTx(null);
    try {
      toast.loading("Sign the withdrawal in your wallet…", { id: "withdraw" });
      const { burnIntent, signature } = await buildAndSignWithdrawIntent(
        walletClient,
        availableAtomic,
        address,
      );

      toast.loading("Settling on-chain…", { id: "withdraw" });
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnIntent, signature }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        mintTxHash?: string;
        amountUsdc?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.mintTxHash) {
        throw new Error(data.error ?? data.message ?? "withdraw failed");
      }

      setLastTx(data.mintTxHash);
      toast.success(`Withdrew $${fmtUsdc(data.amountUsdc ?? available ?? 0)} to your wallet`, {
        id: "withdraw",
        description: "Minted on-chain — view the tx on ArcScan.",
      });
      // Circle's off-chain balance lags the mint; re-read after a moment.
      setTimeout(loadBalance, 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(/reject|denied/i.test(message) ? "Signature rejected." : message, { id: "withdraw" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 border border-ink bg-paper p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-seal" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Withdrawable earnings
          </span>
        </div>
        <span className="font-display text-[26px] font-bold tabular-nums text-paid">
          {available === null ? "—" : `$${fmtUsdc(available)}`}
        </span>
      </div>

      <p className="mt-2 max-w-[46ch] font-serif text-[12.5px] leading-snug text-ink-2">
        Citation tolls accrue to your wallet&apos;s Circle Gateway balance. Pull them on-chain into
        your own wallet — one signature, no gas, no minimum.
      </p>

      <button
        type="button"
        onClick={withdraw}
        disabled={busy || !hasFunds}
        className="mt-4 flex w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
        {busy
          ? "Withdrawing…"
          : hasFunds
          ? `Withdraw $${fmtUsdc(available ?? 0)} to my wallet ▸`
          : "Nothing to withdraw yet"}
      </button>

      {lastTx && (
        <a
          href={`${config.explorerUrl}/tx/${lastTx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] text-seal hover:underline"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          View the on-chain mint on ArcScan
        </a>
      )}
    </div>
  );
}
