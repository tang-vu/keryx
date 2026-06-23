/**
 * keryx-buyer — the x402 buyer behind the Keryx MCP server.
 *
 * Holds a persistent Arc-testnet wallet (the CALLER's own — never Keryx's treasury), keeps a small
 * Circle Gateway balance, and pays the toll to Keryx's /api/agent/ask so any agent can ask Keryx and
 * have it pay the creators it cites downstream. The user funds this wallet from the Circle faucet, so
 * every call is a genuinely external on-chain USDC payment, visible live on the keryx.cc dashboard.
 *
 * Self-contained: reads only its own KERYX_* env (no dependency on Keryx's server-side treasury keys),
 * so it runs unchanged on any judge's / agent's machine.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const USDC = (process.env.KERYX_USDC_ADDRESS ??
  "0x3600000000000000000000000000000000000000") as `0x${string}`;
const RPC = process.env.KERYX_RPC_URL ?? "https://rpc.testnet.arc.network";
const CHAIN = (process.env.KERYX_NETWORK ?? "arcTestnet") as SupportedChainName;
const BASE_URL = (process.env.KERYX_BASE_URL ?? "https://keryx.cc").replace(/\/$/, "");
const FEE_USDC = Number(process.env.KERYX_A2A_FEE ?? "0.02");
const DEPOSIT_USDC = process.env.KERYX_GATEWAY_DEPOSIT ?? "0.5";
const FAUCET = "https://faucet.circle.com";
const EXPLORER = "https://testnet.arcscan.app";
const WALLET_FILE =
  process.env.KERYX_WALLET_FILE ?? path.join(os.homedir(), ".keryx", "buyer-wallet.json");

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
  feeUsdc: FEE_USDC,
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

const fee = parseUnits(String(FEE_USDC), 6);
const deposit = parseUnits(DEPOSIT_USDC, 6);

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
  const ready = available >= fee;
  let instructions: string;
  if (ready) {
    const calls = Math.floor(Number(formatUnits(available, 6)) / FEE_USDC);
    instructions = `Ready — ${formatUnits(available, 6)} USDC in Gateway, ~${calls} Keryx calls.`;
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
      `Fund this address with Arc-testnet USDC, then call again:\n` +
      `  1. Open ${FAUCET} → select Arc Testnet → paste ${account.address}\n` +
      `  2. The faucet sends test USDC (also covers gas).\n` +
      `Each Keryx call costs ${FEE_USDC} USDC, paid from YOUR wallet — visible live on ${BASE_URL}/dashboard.`;
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
async function ensureFunded(): Promise<void> {
  const first = await gateway.getBalances();
  if ((first.gateway.available as bigint) >= fee) return;

  const erc20 = (await pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (erc20 < deposit) {
    throw new Error(
      `Insufficient testnet USDC. Fund ${account.address} at ${FAUCET} (Arc Testnet), then retry. ` +
        `Need ≥ ${DEPOSIT_USDC} USDC (have ${formatUnits(erc20, 6)}).`,
    );
  }

  await gateway.deposit(DEPOSIT_USDC);
  for (let i = 0; i < 30; i++) {
    const b = await gateway.getBalances();
    if ((b.gateway.available as bigint) >= fee) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Gateway deposit didn't confirm in time — check balance and retry.");
}

export type KeryxCitation = { source: string; reward: number; weight?: number };
export type KeryxAnswer = {
  answer: string;
  citations: KeryxCitation[];
  creatorsPaid: number;
  totalToCreators: number;
  feePaid: number;
  txHash?: string;
  amountPaid?: string;
};

/** Pay the x402 toll from the user's wallet and return Keryx's cited answer + downstream payouts. */
export async function askKeryx(question: string, budget?: number): Promise<KeryxAnswer> {
  await ensureFunded();
  const r = await gateway.pay<{
    answer: string;
    creatorsPaid: number;
    totalToCreators: number;
    citations: KeryxCitation[];
    feePaid: number;
  }>(`${BASE_URL}/api/agent/ask`, {
    method: "POST",
    body: { question, ...(budget ? { budget } : {}) },
  });
  return { ...r.data, txHash: String(r.transaction), amountPaid: r.formattedAmount };
}
