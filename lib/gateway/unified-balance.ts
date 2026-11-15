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
import { createReadonlyApplicationStorage, applicationStorageIdentity, assertApplicationStorageCurrentLocal, closeReadonlyApplicationStorage } from "../db/application-storage";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";
import { canonicalJson } from "../canonical-json";
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
  const baseUrl = config.baseUrl, origin = new URL(baseUrl), selection = readRuntimeStorageDeployment();
  if (selection.backend.kind !== "sqlite" && selection.backend.kind !== "postgres")
    throw new Error("Mainnet treasury observation backend refused");
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
    throw new Error("Mainnet treasury origin refused");
  const selectionWire = canonicalJson(selection);
  const db = await createReadonlyApplicationStorage();
  if (!db) throw new Error("Mainnet treasury observation unavailable");
  let publish: (() => MainnetTreasuryObservation) | undefined;
  try {
    const identity = await applicationStorageIdentity(db, "read"), identityWire = canonicalJson(identity);
    const configuredPolicy = () => {
      if (config.profile !== ARC_MAINNET_PROFILE || config.baseUrl !== baseUrl
        || canonicalJson(readRuntimeStorageDeployment()) !== selectionWire
        || canonicalJson(selection.identity) !== identityWire)
        throw new Error("Mainnet treasury observation changed");
      return configuredHostedTreasuryPolicy(identity, origin.origin, "public");
    };
    const readPolicy = () => { assertApplicationStorageCurrentLocal(db, "read"); return configuredPolicy(); };
    const policy = readPolicy(), digest = hostedTreasuryPolicyDigest(policy);
    const refresh = async () => {
      const current = await applicationStorageIdentity(db, "read");
      if (canonicalJson(current) !== identityWire || hostedTreasuryPolicyDigest(readPolicy()) !== digest)
        throw new Error("Mainnet treasury observation changed");
    };
    // This read detects historical cross-role custody conflicts; it is not policy admission or readiness.
    await db.hostedTreasuryAccounting(policy.signer, "public");
    await refresh();
    const amount = await getGatewayAvailableAtomic(policy.signer, ARC_MAINNET_PROFILE);
    await refresh();
    await db.hostedTreasuryAccounting(policy.signer, "public");
    // Revalidate once more after the final awaited role check (including expiry).
    await refresh();
    if (hostedTreasuryPolicyDigest(readPolicy()) !== digest)
      throw new Error("Mainnet treasury observation changed");
    const result: MainnetTreasuryObservation = { network: ARC_MAINNET_PROFILE.networkId, address: policy.signer, policyDigest: digest,
      storageIdentityDigest: policy.storageIdentityDigest, availableUsdc: amount === null ? null : formatUnits(amount, 6),
      fetchedAt: new Date().toISOString(), paymentReadiness: "not-probed" };
    publish = () => {
      // Disposal is the final await. Narrow protected configuration once more
      // before publishing; the intentionally closed facade cannot issue proof.
      if (hostedTreasuryPolicyDigest(configuredPolicy()) !== digest)
        throw new Error("Mainnet treasury observation changed");
      return result;
    };
  } finally {
    // Each uncached observation owns this read-only facade, including policy/vendor refusal paths.
    await closeReadonlyApplicationStorage(db);
  }
  if (!publish) throw new Error("Mainnet treasury observation unavailable");
  return publish();
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
