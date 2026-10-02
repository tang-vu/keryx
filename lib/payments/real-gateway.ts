/**
 * RealGateway — settles on Arc testnet via Circle x402 batched nanopayments.
 *
 * Uses a PERSISTENT spend wallet (data/spend-wallet.json) that maintains a reusable Gateway
 * balance: it funds gas + deposits USDC only when the balance drops below a threshold, then uses
 * Circle's batching signer for each source/cite endpoint (payTo = creator wallet → settlement).
 * Circle's facilitator won't settle against tiny balances, so we keep ~1 USDC and top up as needed;
 * the orchestrator's per-query budget (not the deposit) caps actual spend.
 */

import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  parseEther,
  parseUnits,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { attestedArcHttp } from "../arc-rpc-attestation";
import { ServerPaymentGateway } from "./server-payment-gateway";
import type { BatchPayloadSigner } from "./server-x402-client";
import { loadPersistentTreasuryWallet } from "./persistent-treasury-wallet";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import { ARC_GATEWAY_DEPOSIT_ABI, GuardedArcSubmissionUnknownError, sendGuardedArcTransaction } from "./guarded-arc-transaction";
import { createPinnedArcBatchSigner } from "./pinned-arc-batch-signer";

const GAS_TOPUP = parseEther("0.05"); // native USDC for gas (18 decimals on Arc)
const GAS_MIN = parseEther("0.01");
const STORE = path.resolve(process.cwd(), "data", "spend-wallet.json");

function exactMicroUsdc(value: number, message: string): bigint {
  const decimal = Number.isFinite(value) && value >= 0
    ? /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(String(value)) : null;
  if (!decimal) throw new Error(message);
  const micros = BigInt(decimal[1]) * BigInt(1000000) + BigInt((decimal[2] ?? "").padEnd(6, "0"));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(message);
  return micros;
}

export class TreasuryGatewayCreditUnknownError extends Error {
  constructor(readonly transactionHash: `0x${string}`) {
    super("Circle Gateway credit outcome unknown; inspect the original deposit transaction before further funding");
    this.name = "TreasuryGatewayCreditUnknownError";
  }
}

export class RealGateway extends ServerPaymentGateway {
  private spendKey = loadPersistentTreasuryWallet(STORE).privateKey;
  protected spend = privateKeyToAccount(this.spendKey);
  protected batchScheme: BatchPayloadSigner = createPinnedArcBatchSigner(this.spend, config.rpcUrl);
  private funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  private publicClient = createPublicClient({ chain: arcTestnet, transport: attestedArcHttp(config.rpcUrl) });
  private fundingBudget?: number;
  private fundingAttempt?: Promise<{ address: string; depositTx?: string }>;

  private async confirmed(hash: `0x${string}`): Promise<void> {
    let receipt;
    try { receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 }); }
    catch { throw new GuardedArcSubmissionUnknownError(hash); }
    if (typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
      throw new GuardedArcSubmissionUnknownError(hash);
    }
    if (receipt.status === "reverted") throw new Error("Treasury funding transaction reverted");
    if (receipt.status !== "success") throw new GuardedArcSubmissionUnknownError(hash);
  }

  private async available(): Promise<bigint> {
    const available = await getGatewayAvailableAtomic(this.spend.address);
    if (available === null) throw new Error("Circle Gateway credit unavailable; funding outcome unknown");
    return available;
  }

  async ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }> {
    const budgetMicros = exactMicroUsdc(budget, "Treasury funding budget is invalid");
    if (this.fundingAttempt) {
      if (budget !== this.fundingBudget) throw new Error("Treasury funding budget changed; retained attempt requires recovery");
      return this.fundingAttempt;
    }
    const minimumMicros = exactMicroUsdc(config.gatewayMinAvailableUsdc, "Treasury funding configuration is invalid");
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(config.gatewayDepositUsdc)) {
      throw new Error("Treasury funding configuration is invalid");
    }
    const depositAtomic = parseUnits(config.gatewayDepositUsdc, 6);
    if (depositAtomic <= BigInt(0) || depositAtomic > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Treasury funding configuration is invalid");
    }
    this.fundingBudget = budget;
    this.fundingAttempt = this.fundOnce(budgetMicros > minimumMicros ? budgetMicros : minimumMicros, depositAtomic);
    return this.fundingAttempt;
  }

  private async fundOnce(minAvailable: bigint, depositAtomic: bigint): Promise<{ address: string; depositTx?: string }> {
    // 1) Gas: native USDC for the deposit/approval txs.
    const native = await this.publicClient.getBalance({ address: this.spend.address });
    if (native < GAS_MIN) {
      const gasTx = await sendGuardedArcTransaction({ account: this.funder, rpcUrl: config.rpcUrl,
        transaction: { to: this.spend.address, value: GAS_TOPUP } });
      await this.confirmed(gasTx);
    }

    // 2) Gateway balance: top up only when below threshold (reuse the balance across queries).
    const available = await this.available();
    if (available >= minAvailable) {
      return { address: this.spend.address }; // already funded
    }

    const usdcBal = await this.publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.spend.address],
    });
    if (usdcBal < depositAtomic) {
      const usdcTx = await sendGuardedArcTransaction({ account: this.funder, rpcUrl: config.rpcUrl,
        transaction: { to: config.usdcAddress, data: encodeFunctionData({ abi: erc20Abi,
          functionName: "transfer", args: [this.spend.address, depositAtomic] }) } });
      await this.confirmed(usdcTx);
    }

    const allowance = await this.publicClient.readContract({ address: config.usdcAddress,
      abi: erc20Abi, functionName: "allowance", args: [this.spend.address, config.gatewayWallet] });
    if (allowance < depositAtomic) {
      const approvalTx = await sendGuardedArcTransaction({ account: this.spend, rpcUrl: config.rpcUrl,
        transaction: { to: config.usdcAddress, data: encodeFunctionData({ abi: erc20Abi,
          functionName: "approve", args: [config.gatewayWallet, depositAtomic] }) } });
      await this.confirmed(approvalTx);
    }
    const depositTx = await sendGuardedArcTransaction({ account: this.spend, rpcUrl: config.rpcUrl,
      transaction: { to: config.gatewayWallet, data: encodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI,
        functionName: "deposit", args: [config.usdcAddress, depositAtomic] }), gas: BigInt(120000) } });
    await this.confirmed(depositTx);

    // Circle's facilitator settles against the OFF-CHAIN Gateway balance, which lags the on-chain
    // deposit tx. Poll until credited before returning (else settle → insufficient_balance).
    const want = available + depositAtomic;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      let observed;
      try { observed = await this.available(); }
      catch { throw new TreasuryGatewayCreditUnknownError(depositTx); }
      if (observed >= minAvailable && observed >= want - parseUnits("0.01", 6)) {
        return { address: this.spend.address, depositTx };
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new TreasuryGatewayCreditUnknownError(depositTx);
  }

}
