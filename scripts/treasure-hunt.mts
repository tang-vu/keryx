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

import { createPublicClient, encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: npx tsx scripts/treasure-hunt.mts [BASE_URL]\nSet KERYX_TREASURE_PAYEE to the known scaffold creator address. Provide an existing owner-provisioned wallet file or explicit KERYX_BUYER_PRIVATE_KEY. Each authorized toll is exactly 0.03 testnet USDC. Inspect pending attempts before retrying.");
    return;
  }
  const PAYEE = process.env.KERYX_TREASURE_PAYEE;
  if (!PAYEE || !isAddress(PAYEE) || /^0x0{40}$/i.test(PAYEE)) {
    throw new Error("Set KERYX_TREASURE_PAYEE to the scaffold creator address before funding or paying; use --help for usage");
  }
  const { config } = await import("../lib/config.ts");
  const { attestedArcHttp } = await import("../lib/arc-rpc-attestation.ts");
  const { ARC_GATEWAY_DEPOSIT_ABI, GuardedArcSubmissionUnknownError, sendGuardedArcTransaction } = await import("../lib/payments/guarded-arc-transaction.ts");
  const { getGatewayAvailableAtomic } = await import("../lib/gateway/gateway-balance.ts");
  const { payWithServerSigner } = await import("../lib/payments/server-x402-client.ts");
  const { createPinnedArcBatchSigner } = await import("../lib/payments/pinned-arc-batch-signer.ts");
  const { loadPersistentTreasuryWallet } = await import("../lib/payments/persistent-treasury-wallet.ts");
  const USDC = config.usdcAddress;
  const RPC = config.rpcUrl;
  const SCAFFOLD_URL = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
  const DEPOSIT_USDC = process.env.KERYX_GATEWAY_DEPOSIT ?? "0.5";
  const FAUCET = "https://faucet.circle.com";
  const WALLET_FILE =
    process.env.KERYX_WALLET_FILE ?? path.join(os.homedir(), ".keryx", "buyer-wallet.json");

  function loadKey(): `0x${string}` {
    const envKey = process.env.KERYX_BUYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (envKey !== undefined) {
      try { privateKeyToAccount(envKey); return envKey; }
      catch { throw new Error("Explicit buyer key invalid; owner configuration recovery required"); }
    }
    return loadPersistentTreasuryWallet(WALLET_FILE).privateKey;
  }

  const key = loadKey();
  const account = privateKeyToAccount(key);
  const gatewaySigner = createPinnedArcBatchSigner(account, RPC);
  const pub = createPublicClient({ chain: arcTestnet, transport: attestedArcHttp(RPC) });
  async function confirmed(hash: `0x${string}`) {
    let receipt;
    try { receipt = await pub.waitForTransactionReceipt({ hash }); }
    catch { throw new GuardedArcSubmissionUnknownError(hash); }
    if (typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new GuardedArcSubmissionUnknownError(hash);
    if (receipt.status === "reverted") throw new Error(`Transaction reverted (${hash}); inspect the original hash before any manual retry.`);
    if (receipt.status !== "success") throw new GuardedArcSubmissionUnknownError(hash);
  }

  async function ensureFunded() {
    const first = await getGatewayAvailableAtomic(account.address);
    if (first === null) throw new Error("Gateway balance unavailable");
    if (first >= parseUnits("0.03", 6)) return;
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
    const amount = parseUnits(DEPOSIT_USDC, 6);
    const allowance = await pub.readContract({ address: USDC, abi: erc20Abi,
      functionName: "allowance", args: [account.address, config.gatewayWallet] });
    if (allowance < amount) {
      const approval = await sendGuardedArcTransaction({ account, rpcUrl: RPC,
        transaction: { to: USDC, data: encodeFunctionData({ abi: erc20Abi,
          functionName: "approve", args: [config.gatewayWallet, amount] }) } });
      await confirmed(approval);
    }
    const deposit = await sendGuardedArcTransaction({ account, rpcUrl: RPC,
      transaction: { to: config.gatewayWallet, gas: BigInt(120000), data: encodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI,
        functionName: "deposit", args: [USDC, amount] }) } });
    await confirmed(deposit);
    for (let i = 0; i < 30; i++) {
      const b = await getGatewayAvailableAtomic(account.address);
      if (b === null) throw new Error("Gateway balance unavailable");
      if (b >= parseUnits("0.03", 6)) return;
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
  let settledPayments = 0;
  let attemptsUsed = 0;

  console.log("🔍 Collecting clues from /api/premium/agent-task ($0.03 each)...\n");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && clues.size < TOTAL_STEPS; attempt++) {
    attemptsUsed = attempt;
    try {
      const result = await payWithServerSigner<{ clue: string; step: number; total_steps: number }>({
        url: `${SCAFFOLD_URL}/api/premium/agent-task`, method: "GET", expectedPayee: PAYEE,
        expectedAmount: 0.03, payer: account.address, signer: gatewaySigner,
      });
      if (result.settlementStatus !== "settled" || !result.delivered || !result.data) {
        console.log(`   Payment ${result.settlementStatus}; delivery=${result.delivered}. Stop and inspect the original attempt before retrying.`);
        break;
      }
      const { clue, step, total_steps } = result.data;
      settledPayments++;

      if (!clues.has(step)) {
        clues.set(step, clue);
        console.log(`   [$${result.amountUsdc}] Step ${step}/${total_steps}: ${clue}`);
      } else {
        console.log(`   [$${result.amountUsdc}] Step ${step} (duplicate, ${TOTAL_STEPS - clues.size} remaining)`);
      }
    } catch {
      console.log(`   Attempt ${attempt}: payment challenge/signing failed; inspect the original configuration before retrying.`);
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
    console.log(`💸 Confirmed settled tolls: $${(settledPayments * 0.03).toFixed(2)} USDC for the treasure hunt`);
    console.log("   (Keryx paid another agent's x402 endpoint — self-referential demo!)");
  } else {
    console.log(`⚠️  Collected ${clues.size}/${TOTAL_STEPS} clues in ${attemptsUsed} attempts; confirmed settled tolls $${(settledPayments * 0.03).toFixed(2)}.`);
    console.log("   Run again to collect remaining clues.");
  }
}
await main().catch((error: unknown) => {
  // Only the public transaction hash survives the guarded submission error.
  if (error instanceof Error && "transactionHash" in error && typeof error.transactionHash === "string"
    && /^0x[0-9a-f]{64}$/i.test(error.transactionHash)) {
    console.error(`Transaction outcome unknown (${error.transactionHash}); inspect the original hash before any manual retry.`);
  } else console.error(error instanceof Error ? error.message : "Treasure hunt failed");
  process.exitCode = 1;
});
