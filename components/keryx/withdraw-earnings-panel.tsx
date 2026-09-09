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

import { useCallback, useEffect, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { Loader2, ArrowUpRight, Coins } from "lucide-react";
import { toast } from "sonner";
import { buildAndSignWithdrawIntent } from "@/lib/gateway/withdraw-intent";
import { config } from "@/lib/config";
import { fmtUsdc } from "./phase-style";
import { readGatewayCredit } from "@/lib/gateway/read-credit";

export function WithdrawEarningsPanel({ address }: { address: string }) {
  const { data: walletClient } = useWalletClient();
  const [balance, setBalance] = useState<{ address: string; available: bigint | null; error: boolean } | null>(null);
  const balanceRead = useRef({ value: 0 });
  const availableAtomic = balance?.address === address ? balance.available : null;
  const balanceError = balance?.address === address && balance.error;
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    const read = ++balanceRead.current.value;
    setBalance({ address, available: null, error: false });
    try {
      const available = await readGatewayCredit(address);
      if (read === balanceRead.current.value) setBalance({ address, available, error: false });
    } catch {
      if (read === balanceRead.current.value) setBalance({ address, available: null, error: true });
    }
  }, [address]);

  useEffect(() => {
    const sequence = balanceRead.current;
    (async () => {
      await loadBalance();
    })();
    return () => { sequence.value++; };
  }, [loadBalance]);

  const available = availableAtomic === null ? null : Number(availableAtomic) / 1e6;
  // Circle charges a fee on top of the burn value (requires available >= value + fee), so reserve
  // it before signing — a full-balance withdraw always fails by exactly the fee.
  const reserveAtomic = BigInt(Math.round(config.withdrawFeeReserveUsdc * 1e6));
  const netAtomic =
    availableAtomic !== null && availableAtomic > reserveAtomic
      ? availableAtomic - reserveAtomic
      : BigInt(0);
  const net = Number(netAtomic) / 1e6;
  const hasFunds = netAtomic > BigInt(0);
  // available > 0 but below the fee floor → distinct, non-zero "too small" state.
  const belowFeeFloor = available !== null && available > 0 && netAtomic <= BigInt(0);

  const withdraw = async () => {
    if (busy || netAtomic <= BigInt(0)) return;
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
        netAtomic,
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
      toast.success(`Withdrew $${fmtUsdc(data.amountUsdc ?? net)} to your wallet`, {
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
        your own wallet — one signature, no gas. A small network fee is reserved from the balance.
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
          : balanceError
          ? "Balance unavailable"
          : available === null
          ? "Checking balance…"
          : hasFunds
          ? `Withdraw $${fmtUsdc(net)} to my wallet ▸`
          : belowFeeFloor
          ? "Balance below the withdraw fee"
          : "Nothing to withdraw yet"}
      </button>

      {balanceError && <p role="status" className="mt-3 font-serif text-sm text-ink-2">
        Gateway balance could not be read. This does not mean your earnings are zero.{" "}
        <button type="button" onClick={() => { void loadBalance(); }} className="underline">Retry balance check</button>
      </p>}

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
