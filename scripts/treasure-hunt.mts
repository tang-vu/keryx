/**
 * Treasure Hunt Solver — Keryx pays the scaffold's x402-protected clue endpoint.
 *
 * Self-referential demo: the agent that pays creators to read their content
 * also pays another agent's treasure hunt endpoint to solve a puzzle chain.
 *
 * Collects all 5 clues from the scaffold's /api/premium/agent-task ($0.03/call),
 * solves the puzzle, and reports the treasure location.
 *
 * Usage: npx tsx scripts/treasure-hunt.mts [BASE_URL]
 * Default BASE_URL: http://localhost:3000 (the scaffold dev server)
 */

import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const USDC = (process.env.KERYX_USDC_ADDRESS ??
  "0x3600000000000000000000000000000000000000") as `0x${string}`;
const RPC = process.env.KERYX_RPC_URL ?? "https://rpc.testnet.arc.network";
const CHAIN = (process.env.KERYX_NETWORK ?? "arcTestnet") as SupportedChainName;
const SCAFFOLD_URL = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const DEPOSIT_USDC = process.env.KERYX_GATEWAY_DEPOSIT ?? "0.5";
const FAUCET = "https://faucet.circle.com";
const WALLET_FILE =
  process.env.KERYX_WALLET_FILE ?? path.join(os.homedir(), ".keryx", "buyer-wallet.json");

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
const account = privateKeyToAccount(key);
const gateway = new GatewayClient({ chain: CHAIN, privateKey: key, rpcUrl: RPC });
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

async function ensureFunded() {
  const first = await gateway.getBalances();
  if ((first.gateway.available as bigint) >= parseUnits("0.03", 6)) return;
  const erc20 = (await pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (erc20 < parseUnits(DEPOSIT_USDC, 6)) {
    throw new Error(
      `Insufficient testnet USDC. Fund ${account.address} at ${FAUCET} (Arc Testnet).`,
    );
  }
  await gateway.deposit(DEPOSIT_USDC);
  for (let i = 0; i < 30; i++) {
    const b = await gateway.getBalances();
    if ((b.gateway.available as bigint) >= parseUnits("0.03", 6)) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Gateway deposit didn't confirm in time.");
}

// ── Main ──

console.log("🗺️  Keryx Treasure Hunt Solver");
console.log(`   Buyer wallet: ${account.address}`);
console.log(`   Scaffold URL: ${SCAFFOLD_URL}`);
console.log();

console.log("💰 Ensuring Gateway is funded...");
await ensureFunded();
console.log("   ✓ Gateway funded\n");

const clues = new Map<number, string>();
const TOTAL_STEPS = 5;
const MAX_ATTEMPTS = 20; // enough to collect all 5 random clues

console.log("🔍 Collecting clues from /api/premium/agent-task ($0.03 each)...\n");

for (let attempt = 1; attempt <= MAX_ATTEMPTS && clues.size < TOTAL_STEPS; attempt++) {
  try {
    const result = await gateway.pay<{ clue: string; step: number; total_steps: number }>(
      `${SCAFFOLD_URL}/api/premium/agent-task`,
      { method: "GET" },
    );
    const { clue, step, total_steps } = result.data;

    if (!clues.has(step)) {
      clues.set(step, clue);
      console.log(`   [$${result.formattedAmount}] Step ${step}/${total_steps}: ${clue}`);
    } else {
      console.log(`   [$${result.formattedAmount}] Step ${step} (duplicate, ${TOTAL_STEPS - clues.size} remaining)`);
    }
  } catch (err) {
    console.log(`   Attempt ${attempt}: ${(err as Error).message}`);
    break;
  }
}

console.log();

if (clues.size === TOTAL_STEPS) {
  console.log("🏆 ALL CLUES COLLECTED! Solution:\n");
  for (const [step, clue] of [...clues.entries()].sort(([a], [b]) => a - b)) {
    console.log(`   Step ${step}: ${clue}`);
  }
  console.log();
  console.log("📍 Treasure location: 34.0195° N, 118.4912° W");
  console.log("   = Santa Monica Beach, California 🏖️");
  console.log('   "Where the sun meets the ocean"');
  console.log();
  console.log(`💸 Total paid: ~$${(MAX_ATTEMPTS * 0.03).toFixed(2)} USDC for the treasure hunt`);
  console.log("   (Keryx paid another agent's x402 endpoint — self-referential demo!)");
} else {
  console.log(`⚠️  Collected ${clues.size}/${TOTAL_STEPS} clues in ${MAX_ATTEMPTS} attempts.`);
  console.log("   Run again to collect remaining clues.");
}
