/**
 * Read-only public treasury observation on the selected Arc runtime.
 *
 * The settlement (spend) wallet keeps a reusable Gateway balance that every
 * citation payment draws from. This module reads that balance the chain-abstracted
 * way — one call returns the confirmed + pending USDC across every Gateway chain —
 * using the official @circle-fin/unified-balance-kit by address on testnet.
 * Mainnet observes only its reviewed public policy's address through the selected
 * Circle Gateway balance API without loading custody; neither path constructs a signer.
 */

import fs from "node:fs";
import path from "node:path";
import { formatUnits } from "viem";
import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { createReadonlyApplicationStorage, applicationSqliteIdentity } from "../db/application-storage";
import { configuredHostedTreasuryPolicy, hostedTreasuryPolicyDigest } from "../payments/hosted-treasury-policy";
import { getGatewayAvailableAtomic } from "./gateway-balance";
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

export interface MainnetTreasuryObservation {
  network: "eip155:5042";
  address: string;
  policyDigest: string;
  storageIdentityDigest: string;
  availableUsdc: string | null;
  fetchedAt: string;
  /** A balance read grants no spending authority and does not probe custody or payment readiness. */
  paymentReadiness: "not-probed";
}

/** Address-only observation of the reviewed public role. Never loads a key or admits a policy. */
export async function getMainnetTreasuryObservation(): Promise<MainnetTreasuryObservation> {
  if (config.profile !== ARC_MAINNET_PROFILE) throw new Error("Mainnet treasury observation refused");
  const db = await createReadonlyApplicationStorage();
  if (!db) throw new Error("Mainnet treasury observation unavailable");
  try {
    const baseUrl = config.baseUrl, origin = new URL(baseUrl);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
      throw new Error("Mainnet treasury origin refused");
    const readPolicy = () => configuredHostedTreasuryPolicy(applicationSqliteIdentity(db, "read"), origin.origin, "public");
    const policy = readPolicy(), digest = hostedTreasuryPolicyDigest(policy);
    // This read detects historical cross-role custody conflicts; it is not policy admission or readiness.
    await db.hostedTreasuryAccounting(policy.signer, "public");
    const amount = await getGatewayAvailableAtomic(policy.signer, ARC_MAINNET_PROFILE);
    if (config.profile !== ARC_MAINNET_PROFILE || config.baseUrl !== baseUrl ||
        hostedTreasuryPolicyDigest(readPolicy()) !== digest)
      throw new Error("Mainnet treasury observation changed");
    await db.hostedTreasuryAccounting(policy.signer, "public");
    // Revalidate once more after the final awaited role check (including expiry).
    if (config.profile !== ARC_MAINNET_PROFILE || config.baseUrl !== baseUrl || hostedTreasuryPolicyDigest(readPolicy()) !== digest)
      throw new Error("Mainnet treasury observation changed");
    return { network: ARC_MAINNET_PROFILE.networkId, address: policy.signer, policyDigest: digest,
      storageIdentityDigest: policy.storageIdentityDigest, availableUsdc: amount === null ? null : formatUnits(amount, 6),
      fetchedAt: new Date().toISOString(), paymentReadiness: "not-probed" };
  } finally {
    // Each uncached observation owns this read-only facade, including policy/vendor refusal paths.
    (db as { close?: () => void }).close?.();
  }
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
  // The installed kit has no Arc mainnet definition. Never reuse its testnet wallet/chains on mainnet.
  if (config.profile !== ARC_TESTNET_PROFILE) throw new Error("Legacy treasury observation refused");
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
