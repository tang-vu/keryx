/**
 * Agent treasury view through Circle App Kit (Unified Balance Kit).
 *
 * The settlement (spend) wallet keeps a reusable Gateway balance that every
 * citation payment draws from. This module reads that balance the chain-abstracted
 * way — one call returns the confirmed + pending USDC across every Gateway chain —
 * using the official @circle-fin/unified-balance-kit by address (read-only: the
 * web process never touches the private key).
 */

import fs from "node:fs";
import path from "node:path";
import {
  createUnifiedBalanceKitContext,
  getBalances,
} from "@circle-fin/unified-balance-kit";

/** Gateway testnet chains we surface. Arc is where settlement actually happens. */
const CHAINS = ["Arc_Testnet", "Base_Sepolia", "Ethereum_Sepolia", "Avalanche_Fuji"] as const;

export interface UnifiedBalanceSummary {
  /** Settlement wallet whose Gateway balance backs citation payouts. */
  address: string;
  totalConfirmedUsdc: string;
  totalPendingUsdc: string;
  perChain: { chain: string; confirmed: string; pending: string }[];
  fetchedAt: string;
}

/** The persistent spend wallet is created by RealGateway; only its address is read here. */
function spendWalletAddress(): string | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "data", "spend-wallet.json"), "utf8"),
    ) as { address?: string };
    return typeof raw.address === "string" && raw.address.startsWith("0x") ? raw.address : null;
  } catch {
    return null; // no settlement wallet yet (fresh checkout / user-only mode)
  }
}

/** Chain-abstracted Gateway balance of the settlement wallet, or null when none exists. */
export async function getAgentUnifiedBalance(): Promise<UnifiedBalanceSummary | null> {
  const address = spendWalletAddress();
  if (!address) return null;

  const context = createUnifiedBalanceKitContext();
  const balances = await getBalances(context, {
    sources: { address, chains: [...CHAINS] },
    includePending: true,
  });

  const perChain = (balances.breakdown[0]?.breakdown ?? []).map((c) => ({
    chain: String(c.chain),
    confirmed: c.confirmedBalance,
    // pendingBalance is only present when includePending is set; normalise for the API shape.
    pending: c.pendingBalance ?? "0.000000",
  }));

  return {
    address,
    totalConfirmedUsdc: balances.totalConfirmedBalance,
    totalPendingUsdc: balances.totalPendingBalance ?? "0.000000",
    perChain,
    fetchedAt: new Date().toISOString(),
  };
}
