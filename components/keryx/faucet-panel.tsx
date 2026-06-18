"use client";

/**
 * FaucetPanel — "Get testnet USDC" affordance shown near the grant-spend panel.
 *
 * Calls POST /api/faucet (SIWE-gated) to drip native + ERC-20 USDC once per
 * address. Shows the tx hash with ArcScan link on success, and always exposes
 * a static link to the Circle faucet as a fallback.
 *
 * Also displays the wallet's current Arc ERC-20 USDC balance so the user knows
 * whether they need to claim before activating a session grant.
 */

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { Loader2, Droplets, ExternalLink } from "lucide-react";
import { config as kConfig } from "@/lib/config";
import { arcTestnet } from "@/lib/chains";

const CIRCLE_FAUCET = "https://faucet.circle.com/";
const EXPLORER = "https://testnet.arcscan.app";

interface FaucetResult {
  ok?: boolean;
  error?: string;
  tx?: string;
  amount?: string;
  claimedAt?: string;
  faucet?: string;
}

export function FaucetPanel() {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<FaucetResult | null>(null);

  // Read the wallet's ERC-20 USDC balance on Arc (6 decimals).
  const { data: rawBalance, refetch: refetchBalance } = useReadContract({
    address: kConfig.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: isConnected && !!address },
  });

  // Refresh balance after a successful drip.
  useEffect(() => {
    if (status === "done") {
      const t = setTimeout(() => { refetchBalance(); }, 4000);
      return () => clearTimeout(t);
    }
  }, [status, refetchBalance]);

  const handleClaim = useCallback(async () => {
    setStatus("loading");
    setResult(null);
    try {
      const res = await fetch("/api/faucet", { method: "POST" });
      const data = (await res.json()) as FaucetResult;
      setResult(data);
      setStatus(res.ok ? "done" : "error");
    } catch {
      setResult({ error: "Network error — try the Circle faucet instead." });
      setStatus("error");
    }
  }, []);

  if (!isConnected) return null;

  const usdcBalance = rawBalance !== undefined
    ? (Number(rawBalance) / 1e6).toFixed(4)
    : null;

  return (
    <div className="border border-line bg-paper-2 px-4 py-3 text-sm">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <Droplets className="h-3.5 w-3.5 text-seal" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            Testnet USDC faucet
          </span>
        </div>
        {usdcBalance !== null && (
          <span className="font-mono text-[10px] text-ink-3">
            Balance: <span className="text-ink">{usdcBalance} USDC</span>
          </span>
        )}
      </div>

      {/* Success state */}
      {status === "done" && result?.ok && (
        <div className="mb-2 space-y-1">
          <p className="font-mono text-[11px] text-paid">
            Dripped {result.amount} USDC
          </p>
          {result.tx && (
            <a
              href={`${EXPLORER}/tx/${result.tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] text-seal underline underline-offset-2 hover:text-ink"
            >
              View on ArcScan <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}

      {/* Already claimed / error state */}
      {(status === "error") && result && (
        <div className="mb-2">
          <p className="font-mono text-[11px] text-destructive">
            {result.error}
            {result.claimedAt && (
              <span className="ml-1 text-ink-3">
                (claimed {new Date(result.claimedAt).toLocaleTimeString()})
              </span>
            )}
          </p>
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-3">
        {status !== "done" && (
          <button
            type="button"
            onClick={handleClaim}
            disabled={status === "loading"}
            className="flex items-center gap-1.5 border border-ink/40 bg-paper px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink transition-all hover:-translate-y-0.5 hover:border-seal hover:text-seal hover:shadow-[0_3px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-wait disabled:opacity-60"
          >
            {status === "loading" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Droplets className="h-3 w-3" />
            )}
            {status === "loading" ? "Claiming…" : "Claim testnet USDC"}
          </button>
        )}

        {/* Always show the Circle faucet link as a fallback */}
        <a
          href={CIRCLE_FAUCET}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3 underline underline-offset-2 hover:text-seal"
        >
          Circle faucet <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>

      <p className="mt-1.5 font-mono text-[9px] leading-relaxed tracking-wide text-faint">
        One claim per address · Arc Testnet only · covers gas + a session grant
      </p>
    </div>
  );
}
