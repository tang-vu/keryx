/**
 * withdraw.mts — operator tool to withdraw accrued Gateway earnings for the
 * creator wallets held in the local keystore (data/wallets.json) back to their
 * own (or a given) address.
 *
 * Each citation/fetch toll settles into the creator address's Circle Gateway
 * balance. This moves that balance on-chain via GatewayClient.withdraw(), which
 * mints real USDC on Arc and returns an EVM `mintTxHash` that DOES resolve on
 * arcscan (unlike the per-payment Circle settlement UUIDs).
 *
 * DRY-RUN by default: prints each wallet's withdrawable balance and moves
 * nothing. Pass --live to actually withdraw. This touches team-held wallets in
 * the keystore only and does not mutate anything shown on the public dashboard.
 *
 * Usage:
 *   npm run withdraw                              # dry-run, every keystore wallet
 *   npm run withdraw -- --label <id>             # inspect one wallet
 *   npm run withdraw -- --random 3               # inspect 3 random wallets
 *   npm run withdraw -- --live --label <id>      # withdraw full balance of one
 *   npm run withdraw -- --live --label <id> --amount 0.05
 *   npm run withdraw -- --live --all --min 0.05  # withdraw all wallets >= $0.05
 *   npm run withdraw -- --live --label <id> --recipient 0xCashOut
 *
 * NOTE: earnings shown on keryx.cc accrued to the VPS keystore. Run this ON THE
 * VPS (its data/wallets.json) to withdraw those; the local keystore is separate.
 */

import fs from "node:fs";
import path from "node:path";
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config.ts";

// Instant withdraw mints USDC by having the creator EOA submit a gatewayMint() tx,
// which costs native-USDC gas. Fresh creator wallets only ever RECEIVED Gateway
// settlements, so they hold no gas — top them up from the treasury funder first.
const GAS_MIN = parseEther("0.005");
const GAS_TOPUP = parseEther("0.01");

type KeyStore = Record<string, { address: string; privateKey: string }>;

interface Opts {
  live: boolean;
  all: boolean;
  label?: string;
  random?: number;
  amount?: number; // explicit USDC amount; default = full withdrawable
  min: number; // skip wallets below this withdrawable (USDC)
  recipient?: `0x${string}`;
  maxFee?: string; // USDC ceiling for the Circle withdraw fee
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { live: false, all: false, min: 0.02 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--live") o.live = true;
    else if (a === "--all") o.all = true;
    else if (a === "--label") o.label = next();
    else if (a === "--random") o.random = Number(next());
    else if (a === "--amount") o.amount = Number(next());
    else if (a === "--min") o.min = Number(next());
    else if (a === "--recipient") o.recipient = next() as `0x${string}`;
    else if (a === "--max-fee") o.maxFee = next();
  }
  return o;
}

function loadKeystore(): KeyStore {
  const file = path.resolve(process.cwd(), "data", "wallets.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as KeyStore;
  } catch {
    console.error(`No keystore at ${file} — nothing to withdraw.`);
    process.exit(1);
  }
}

/** Pick which keystore entries to act on, per the selection flags. */
function selectEntries(store: KeyStore, o: Opts): [string, KeyStore[string]][] {
  let entries = Object.entries(store);
  if (o.label) entries = entries.filter(([label]) => label === o.label);
  if (o.random && o.random > 0) {
    entries = [...entries].sort(() => Math.random() - 0.5).slice(0, o.random);
  }
  return entries;
}

// Lazily-built treasury clients (only needed for --live gas top-ups).
function gasFunder() {
  if (!config.funderKey) return null;
  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });
  return { publicClient, wallet };
}

/** Ensure a creator EOA has enough native gas to submit the gatewayMint() tx. */
async function ensureGas(
  funder: ReturnType<typeof gasFunder>,
  address: `0x${string}`,
): Promise<boolean> {
  if (!funder) return false;
  const native = await funder.publicClient.getBalance({ address });
  if (native >= GAS_MIN) return true;
  const tx = await funder.wallet.sendTransaction({ to: address, value: GAS_TOPUP });
  await funder.publicClient.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
  return true;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const store = loadKeystore();
  const entries = selectEntries(store, o);
  const funder = o.live ? gasFunder() : null;
  if (o.live && !funder) {
    console.error("--live needs AGENT_FUNDER_PRIVATE_KEY (treasury) to fund withdraw gas.");
    process.exit(1);
  }

  if (entries.length === 0) {
    console.error("No matching keystore entries (check --label).");
    process.exit(1);
  }

  console.log(
    `${o.live ? "LIVE WITHDRAW" : "DRY-RUN"} · chain=${config.network} · ` +
      `${entries.length} wallet(s) · min=$${o.min}` +
      (o.amount ? ` · amount=$${o.amount}` : " · amount=full") +
      (o.recipient ? ` · recipient=${o.recipient}` : ""),
  );
  console.log("─".repeat(72));

  let withdrawnTotal = 0;
  let withdrawnCount = 0;

  for (const [label, w] of entries) {
    const gw = new GatewayClient({
      chain: config.network as SupportedChainName,
      privateKey: w.privateKey as `0x${string}`,
      rpcUrl: config.rpcUrl,
    });

    // Instant same-chain withdraw draws from the `available` Gateway balance.
    // (`withdrawable` is the trustless ~7-day path and is typically 0 here.)
    let available = 0;
    try {
      const bal = await gw.getBalances();
      available = parseFloat(bal.gateway.formattedAvailable);
      console.log(
        `${label}\n  ${w.address}  available=$${available.toFixed(6)} ` +
          `(withdrawable=$${bal.gateway.formattedWithdrawable})`,
      );
    } catch (err) {
      console.log(`${label}\n  ${w.address}  balance check FAILED: ${msg(err)}`);
      continue;
    }

    if (!o.live) continue;
    if (available < o.min) {
      console.log(`  ↳ skip (below --min $${o.min})`);
      continue;
    }

    const amount = Math.min(o.amount ?? available, available);
    try {
      await ensureGas(funder, w.address as `0x${string}`);
      const res = await gw.withdraw(amount.toFixed(6), {
        recipient: o.recipient ?? (privateKeyToAccount(w.privateKey as `0x${string}`).address),
        ...(o.maxFee ? { maxFee: o.maxFee } : {}),
      });
      withdrawnTotal += parseFloat(res.formattedAmount);
      withdrawnCount++;
      console.log(
        `  ↳ withdrew $${res.formattedAmount} → ${res.recipient}\n` +
          `     tx: ${config.explorerUrl}/tx/${res.mintTxHash}`,
      );
    } catch (err) {
      console.log(`  ↳ withdraw FAILED: ${msg(err)}`);
    }
  }

  console.log("─".repeat(72));
  if (o.live) {
    console.log(`Withdrew $${withdrawnTotal.toFixed(6)} across ${withdrawnCount} wallet(s).`);
  } else {
    console.log("Dry-run only — no funds moved. Re-run with --live to withdraw.");
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
