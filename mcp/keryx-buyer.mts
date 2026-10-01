/**
 * keryx-buyer — the x402 buyer behind the Keryx MCP server.
 *
 * Holds a persistent Arc-testnet wallet (the CALLER's own — never Keryx's treasury), keeps a small
 * Circle Gateway balance, and pays the toll to Keryx's /api/agent/ask so any agent can ask Keryx and
 * have it pay the creators it cites downstream. The wallet auto-funds once from the Keryx onramp (or
 * the Circle faucet), so every call is a genuinely external on-chain USDC payment, visible live on
 * the keryx.cc dashboard.
 *
 * Self-contained: uses the pinned testnet payment profile and its own buyer key (never Keryx's
 * server-side treasury key), so it runs unchanged on any judge's / agent's machine.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { payForResearch, readPending, recoverResearch } from "./local-payment.mts";
import { config } from "../lib/config.ts";

const USDC = config.usdcAddress;
const RPC = config.rpcUrl;
// The published buyer is intentionally testnet-only. A mainnet release needs a separate,
// reviewed package and deployment; changing an environment variable must never enable spending.
const CHAIN = config.network;
const BASE_URL = (process.env.KERYX_BASE_URL ?? "https://keryx.cc").replace(/\/$/, "");
const DEEP_FEE_USDC = Number(process.env.KERYX_A2A_DEEP_FEE ?? "0.05");
const DEFAULT_BUDGET_USDC = Number(process.env.KERYX_DEFAULT_BUDGET ?? "0.05");
const MAX_BUDGET_USDC = Number(process.env.KERYX_A2A_MAX_BUDGET ?? "0.5");
const MAX_TOTAL_USDC = Number(process.env.KERYX_MAX_TOTAL_USDC ?? "1");
const DEPOSIT_USDC = process.env.KERYX_GATEWAY_DEPOSIT ?? "0.5";
const FAUCET = "https://faucet.circle.com";
const EXPLORER = "https://testnet.arcscan.app";
const WALLET_FILE =
  process.env.KERYX_WALLET_FILE ?? path.join(os.homedir(), ".keryx", "buyer-wallet.json");
const JOURNAL_FILE = process.env.KERYX_PAYMENT_JOURNAL ?? path.join(path.dirname(WALLET_FILE), "buyer-payment.json");

/** Load a buyer key from env, else from the persisted wallet file, else generate + persist one. */
function loadOrCreateKey(): `0x${string}` {
  const envKey = process.env.KERYX_BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (envKey && envKey.startsWith("0x")) return envKey;
  try {
    return JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")).privateKey as `0x${string}`;
  } catch {
    const key = generatePrivateKey();
    fs.mkdirSync(path.dirname(WALLET_FILE), { recursive: true });
    fs.writeFileSync(
      WALLET_FILE,
      JSON.stringify({ privateKey: key, address: privateKeyToAccount(key).address }, null, 2),
    );
    return key;
  }
}

const key = loadOrCreateKey();
export const account = privateKeyToAccount(key);
const gateway = new GatewayClient({ chain: CHAIN, privateKey: key, rpcUrl: RPC });
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

/** Static facts the MCP tools surface to the calling agent. */
export const meta = {
  address: account.address,
  baseUrl: BASE_URL,
  feeUsdc: DEEP_FEE_USDC,
  defaultBudgetUsdc: DEFAULT_BUDGET_USDC,
  faucet: FAUCET,
  explorer: EXPLORER,
  walletFile: WALLET_FILE,
} as const;

export type WalletStatus = {
  address: string;
  gasBalance: string;
  usdcBalance: string;
  gatewayAvailable: string;
  ready: boolean;
  instructions: string;
};

const defaultTotal = parseUnits(String(DEEP_FEE_USDC + DEFAULT_BUDGET_USDC), 6);
const deposit = parseUnits(DEPOSIT_USDC, 6);
const ONRAMP_URL = `${BASE_URL}/api/faucet/onramp`;

/** Best-effort one-time auto-funding from Keryx's testnet onramp so a brand-new caller skips the
 *  Circle faucet captcha. Never throws — on failure (already funded, daily cap, network) the caller
 *  falls back to the manual faucet guidance. The wallet stays the caller's own; only the toll spend
 *  is what makes a call count as external traction. */
async function tryOnramp(): Promise<void> {
  try {
    await fetch(ONRAMP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account.address }),
    });
  } catch {
    /* network error — fall through to manual faucet guidance */
  }
}

/** Poll the wallet's USDC balance until it reaches `min` (the drip lands async), up to ~30s. */
async function waitForErc20(min: bigint): Promise<bigint> {
  let bal = 0n;
  for (let i = 0; i < 10; i++) {
    bal = (await pub.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    if (bal >= min) return bal;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return bal;
}

async function readBalances() {
  const [gas, erc20, bal] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }) as Promise<bigint>,
    gateway.getBalances(),
  ]);
  return { gas, erc20, available: bal.gateway.available as bigint };
}

/** Diagnose the wallet and return precise next-step funding guidance. */
export async function getStatus(): Promise<WalletStatus> {
  const { gas, erc20, available } = await readBalances();
  const pending = readPending(JOURNAL_FILE);
  const ready = available >= defaultTotal && !pending;
  let instructions: string;
  if (pending) {
    instructions = `Payment ${pending.status}: query ${pending.queryId}, amount ${pending.amountUsdc} USDC, settlement ${pending.settlementId ?? "unconfirmed"}. Use keryx_recover before another paid call.`;
  } else if (ready) {
    instructions = `Ready for default deep-mode call: ${DEEP_FEE_USDC} USDC fee + ${DEFAULT_BUDGET_USDC} USDC creator budget. Actual quote depends on the POST body.`;
  } else if (erc20 >= deposit && gas > 0n) {
    instructions =
      `You hold ${formatUnits(erc20, 6)} USDC but it isn't in the Gateway yet. ` +
      `ask_keryx will auto-deposit ${DEPOSIT_USDC} USDC on the next call.`;
  } else if (erc20 >= deposit) {
    instructions =
      `You hold ${formatUnits(erc20, 6)} USDC but no gas to deposit it. ` +
      `Fund ${account.address} with a little Arc-testnet gas at ${FAUCET} (Arc Testnet), then retry.`;
  } else {
    instructions =
      `No testnet USDC yet — just call ask_keryx: it AUTO-FUNDS this wallet once from the Keryx onramp ` +
      `(no Circle faucet needed), then pays the toll from YOUR wallet. If the onramp is tapped out ` +
      `(daily cap), fund ${account.address} at ${FAUCET} (Arc Testnet). ` +
      `Default deep-mode call prepays ${DEEP_FEE_USDC + DEFAULT_BUDGET_USDC} USDC (${DEEP_FEE_USDC} fee + ${DEFAULT_BUDGET_USDC} creator budget), paid from YOUR wallet.`;
  }
  return {
    address: account.address,
    gasBalance: formatUnits(gas, 18),
    usdcBalance: formatUnits(erc20, 6),
    gatewayAvailable: formatUnits(available, 6),
    ready,
    instructions,
  };
}

/** Ensure the Gateway balance can cover at least one toll, depositing from the EOA if needed. */
async function ensureFunded(required: bigint): Promise<void> {
  const first = await gateway.getBalances();
  if ((first.gateway.available as bigint) >= required) return;

  const topUp = required > deposit ? required : deposit;
  let erc20 = (await pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (erc20 < topUp) {
    // Auto-onramp once from Keryx's testnet faucet, then wait for the drip to land.
    await tryOnramp();
    erc20 = await waitForErc20(topUp);
    if (erc20 < topUp) {
      throw new Error(
        `Insufficient testnet USDC and the Keryx onramp didn't land (already used or daily cap). ` +
          `Fund ${account.address} at ${FAUCET} (Arc Testnet), then retry. ` +
          `Need ≥ ${formatUnits(topUp, 6)} USDC (have ${formatUnits(erc20, 6)}).`,
      );
    }
  }

  await gateway.deposit(formatUnits(topUp, 6));
  for (let i = 0; i < 30; i++) {
    const b = await gateway.getBalances();
    if ((b.gateway.available as bigint) >= required) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Gateway deposit didn't confirm in time — check balance and retry.");
}

export type KeryxCitation = { source: string; reward: number; weight?: number };
export type KeryxAnswer = {
  answer: string;
  citations: KeryxCitation[];
  creatorsPaid: number | null;
  totalToCreators: number;
  feePaid: number;
  researchExports?: { bibtex: { content: string; count: number; omitted: number }; ris: { content: string; count: number; omitted: number }; evidenceCsv: string };
  // Circle Gateway settlement id (a batched-settlement UUID, NOT an EVM tx hash — it does not
  // resolve at an explorer /tx/ route). The on-chain proof is the batched settlement on the
  // treasury wallet, surfaced on the dashboard; per-tx EVM hashes come only from creator cash-outs.
  settlementId?: string;
  amountPaid?: string;
};

/** Pay the x402 toll from the user's wallet and return Keryx's cited answer + downstream payouts. */
export async function askKeryx(question: string, budget?: number): Promise<KeryxAnswer> {
  if (readPending(JOURNAL_FILE)) throw new Error(`Previous payment requires recovery. Use keryx_recover; journal ${JOURNAL_FILE}`);
  const creatorBudget = Math.min(MAX_BUDGET_USDC, budget ?? DEFAULT_BUDGET_USDC);
  const estimatedTotal = DEEP_FEE_USDC + creatorBudget;
  if (estimatedTotal > MAX_TOTAL_USDC) throw new Error(`Estimated total ${estimatedTotal} USDC exceeds KERYX_MAX_TOTAL_USDC`);
  await ensureFunded(parseUnits(String(estimatedTotal), 6));
  const r = await payForResearch<{
    answer: string;
    creatorsPaid: number | null;
    totalToCreators: number;
    citations: KeryxCitation[];
    feePaid: number;
  }>({
    url: `${BASE_URL}/api/agent/ask`, account, journalFile: JOURNAL_FILE,
    maxAmountUsdc: MAX_TOTAL_USDC,
    body: { question, ...(budget !== undefined ? { budget } : {}) },
  });
  return { ...r.data, settlementId: r.settlementId, amountPaid: r.amountPaid };
}

export async function recoverKeryx() {
  return recoverResearch(BASE_URL, JOURNAL_FILE);
}
