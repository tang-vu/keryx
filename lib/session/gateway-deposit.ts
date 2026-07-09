"use client";

/**
 * Moves USDC from the session EOA into Circle's Gateway: an ERC-20 approve, then a deposit.
 *
 * Both transactions are signed by the session key, which now lives in the signer worker — so the
 * wallet client passed in here is worker-backed, and the worker will only sign transactions aimed
 * at these two contracts. That is deliberate: before the deposit lands, the session EOA holds
 * spendable USDC, and a plain value transfer out of it is exactly what an attacker would want.
 */

import { erc20Abi, parseUnits, type PublicClient, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { config } from "@/lib/config";

/**
 * Minimal ABI for GatewayWallet.deposit(address token, uint256 value).
 * Copied from @circle-fin/x402-batching/dist/client/index.js:236-246 (GATEWAY_WALLET_ABI), which
 * does not export it. Selector: keccak256("deposit(address,uint256)") = 0x47e7ef24 — not the
 * 0xb6b55f25 of a one-argument deposit(uint256).
 */
const GATEWAY_WALLET_DEPOSIT_ABI = [
  {
    name: "deposit",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "token", type: "address" as const },
      { name: "value", type: "uint256" as const },
    ],
    outputs: [],
  },
] as const;

export async function depositToGateway(
  sessionWallet: WalletClient,
  publicClient: PublicClient,
  budgetUsdc: number,
): Promise<string> {
  const amountAtomic = parseUnits(budgetUsdc.toFixed(6), 6);

  const approveTx = await sessionWallet.writeContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [config.gatewayWallet, amountAtomic],
    chain: arcTestnet,
    account: sessionWallet.account!,
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({
    hash: approveTx,
    timeout: 90_000,
  });
  if (approveReceipt.status !== "success") {
    throw new Error("USDC approval reverted — could not authorise the Gateway deposit.");
  }

  const depositTx = await sessionWallet.writeContract({
    address: config.gatewayWallet,
    abi: GATEWAY_WALLET_DEPOSIT_ABI,
    functionName: "deposit",
    args: [config.usdcAddress, amountAtomic],
    gas: BigInt(120000),
    chain: arcTestnet,
    account: sessionWallet.account!,
  });
  const depositReceipt = await publicClient.waitForTransactionReceipt({
    hash: depositTx,
    timeout: 90_000,
  });
  if (depositReceipt.status !== "success") {
    throw new Error("Gateway deposit reverted — funds stayed in the session address.");
  }
  return depositTx;
}
