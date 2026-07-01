/**
 * check-treasury.mts — treasury watchdog. Reads the funder (treasury) wallet's on-chain balances
 * and fires an ops alert BEFORE they run dry, so settlements never stop unnoticed.
 *
 * The funder backs settlement two ways: ERC-20 USDC (funds Gateway deposits) and native USDC (funds
 * the gas for those deposits). This checks both against thresholds and calls sendAlert when either
 * is low. Exit code 1 when an alert fired, 0 when healthy — so cron/CI can react too.
 *
 * Run:  npm run check-treasury      (wired hourly via cron in deploy-vps.sh)
 * Env:  KERYX_TREASURY_MIN_USDC (default 2)   KERYX_TREASURY_MIN_GAS (default 0.02)
 *       KERYX_ALERT_WEBHOOK — Discord/Slack webhook for the alert (optional; logs regardless)
 */

import { createPublicClient, erc20Abi, formatEther, http } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import { treasuryAlerts } from "./treasury-thresholds.ts";

function num(v: string | undefined, fallback: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  if (!config.funderKey) {
    console.log("[treasury] no funder key configured — offline/user-only mode, nothing to watch.");
    return;
  }

  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  // Bound the RPC so a hung/unreachable node fails the cron fast instead of piling up hung jobs.
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  const [gasWei, usdc6] = await Promise.all([
    client.getBalance({ address: funder.address }),
    client.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [funder.address],
    }),
  ]);

  // Native USDC (gas) is 18-decimal; ERC-20 USDC is 6-decimal (Arc constant).
  const status = { usdc: Number(usdc6) / 1e6, gas: Number(formatEther(gasWei)) };
  const thresholds = {
    minUsdc: num(process.env.KERYX_TREASURY_MIN_USDC, 2),
    minGas: num(process.env.KERYX_TREASURY_MIN_GAS, 0.02),
  };

  const shortAddr = `${funder.address.slice(0, 6)}…${funder.address.slice(-4)}`;
  console.log(`[treasury] funder ${shortAddr} — USDC ${status.usdc.toFixed(4)}, gas ${status.gas.toFixed(4)}`);

  const alerts = treasuryAlerts(status, thresholds);
  if (alerts.length > 0) {
    await sendAlert(`treasury low (funder ${shortAddr})`, alerts.join(" "));
    process.exitCode = 1;
  } else {
    console.log("[treasury] OK — both balances above thresholds.");
  }
}

main().catch((err) => {
  console.error("[treasury] check failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
