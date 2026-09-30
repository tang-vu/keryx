/**
 * RealGateway — settles on Arc testnet via Circle x402 batched nanopayments.
 *
 * Uses a PERSISTENT spend wallet (data/spend-wallet.json) that maintains a reusable Gateway
 * balance: it funds gas + deposits USDC only when the balance drops below a threshold, then uses
 * Circle's batching signer for each source/cite endpoint (payTo = creator wallet → settlement).
 * Circle's facilitator won't settle against tiny balances, so we keep ~1 USDC and top up as needed;
 * the orchestrator's per-query budget (not the deposit) caps actual spend.
 */

import fs from "node:fs";
import path from "node:path";
import {
  BatchEvmScheme,
} from "@circle-fin/x402-batching/client";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  parseEther,
  parseUnits,
  type LocalAccount,
} from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { assertArcRpcChain, attestedArcHttp } from "../arc-rpc-attestation";
import { ServerPaymentGateway } from "./server-payment-gateway";
import type { BatchPayloadSigner } from "./server-x402-client";
import { requireRuntimeStorageMode } from "../db/runtime-storage-config";
import { guardedLocalAccount, guardedEvmHttp, type EvmAuthorityGuard } from "./guarded-evm-authority";
import { createGatewayDepositAttempt } from "./gateway-deposit-funding";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";

const GAS_TOPUP = parseEther("0.05"); // native USDC for gas (18 decimals on Arc)
const GAS_MIN = parseEther("0.01");
const STORE = path.resolve(process.cwd(), "data", "spend-wallet.json");

/** Load (or create) the persistent spend wallet so its Gateway balance is reused across runs. */
function loadSpendKey(): `0x${string}` {
  requireRuntimeStorageMode("testnet-real");
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8")).privateKey;
  } catch {
    const pk = generatePrivateKey();
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify({ privateKey: pk, address: privateKeyToAccount(pk).address }, null, 2));
    return pk;
  }
}

export class RealGateway extends ServerPaymentGateway {
  private spendKey: `0x${string}`;
  protected spend: LocalAccount;
  private signer: BatchEvmScheme;
  private funder: LocalAccount;
  private guard: EvmAuthorityGuard;
  private funding?: Promise<{ address: string; depositTx?: string }>;
  private fundingMinimum?: bigint;
  private depositAttempt?: ReturnType<typeof createGatewayDepositAttempt>;
  private transferEvidence: { nativeSendStarted?: true; nativeTxHash?: `0x${string}`;
    usdcSendStarted?: true; usdcTxHash?: `0x${string}` } = {};
  private publicClient: ReturnType<typeof createPublicClient>;
  private funderWallet: ReturnType<typeof createWalletClient<ReturnType<typeof guardedEvmHttp>, typeof arcTestnet, LocalAccount>>;
  private spendWallet: ReturnType<typeof createWalletClient<ReturnType<typeof guardedEvmHttp>, typeof arcTestnet, LocalAccount>>;
  constructor(private readonly authorityCheck: () => void) {
    super(); authorityCheck();
    this.paymentAuthorityCheck = authorityCheck;
    this.guard = { assertAuthority: authorityCheck, attestChain: () => assertArcRpcChain(config.rpcUrl) };
    this.spendKey = loadSpendKey();
    this.spend = guardedLocalAccount(this.spendKey, this.guard);
    this.signer = new BatchEvmScheme(this.spend);
    this.funder = guardedLocalAccount(config.funderKey as `0x${string}`, this.guard);
    this.publicClient = createPublicClient({ chain: arcTestnet, transport: attestedArcHttp(config.rpcUrl) });
    this.funderWallet = createWalletClient({ account: this.funder, chain: arcTestnet, transport: guardedEvmHttp(config.rpcUrl, this.guard, { timeout: 4000 }) });
    this.spendWallet = createWalletClient({ account: this.spend, chain: arcTestnet, transport: guardedEvmHttp(config.rpcUrl, this.guard, { timeout: 4000 }) });
  }
  protected batchScheme: BatchPayloadSigner = {
    createPaymentPayload: async (version, requirements) => {
      this.authorityCheck();
      await assertArcRpcChain(config.rpcUrl);
      this.authorityCheck();
      return this.signer.createPaymentPayload(version, requirements);
    },
  };

  /** Descriptive in-memory evidence only; never restart/signing authority. */
  fundingEvidence() {
    return Object.freeze({ ...this.transferEvidence, deposit: this.depositAttempt?.snapshot(),
      restartReconciliationAvailable: false as const });
  }

  async ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }> {
    this.authorityCheck();
    const minimum = Math.ceil(Math.max(config.gatewayMinAvailableUsdc, budget) * 1_000_000);
    if (!Number.isFinite(budget) || budget < 0 || !Number.isSafeInteger(minimum) || minimum < 0)
      throw new Error("Invalid funding budget");
    const minimumMicros = BigInt(minimum);
    if (this.fundingMinimum !== undefined && minimumMicros > this.fundingMinimum)
      throw new Error("Funding terms changed; new prefunding review required");
    // Retain success AND uncertain failure. A fresh handle/restart remains a
    // separate operator reconciliation gate, never an automatic retry here.
    if (!this.funding) {
      this.fundingMinimum = minimumMicros;
      this.funding = this.fundOnce(minimumMicros);
    }
    return this.funding;
  }

  private async available(): Promise<bigint> {
    this.authorityCheck();
    const available = await getGatewayAvailableAtomic(this.spend.address);
    this.authorityCheck();
    if (available === null) throw new Error("Gateway credit unavailable");
    return available;
  }

  private async confirmed(hash: `0x${string}`): Promise<void> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    this.authorityCheck();
    if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase())
      throw new Error("Funding receipt unavailable or reverted; retain original evidence");
  }

  private async fundOnce(minAvailable: bigint): Promise<{ address: string; depositTx?: string }> {
    const available = await this.available();
    if (available >= minAvailable) return { address: this.spend.address };
    const depositAtomic = parseUnits(config.gatewayDepositUsdc, 6);
    if (depositAtomic <= BigInt(0) || available + depositAtomic < minAvailable)
      throw new Error("Configured prefunding amount insufficient for requested minimum");
    // 1) Gas: native USDC for the deposit/approval txs.
    const native = await this.publicClient.getBalance({ address: this.spend.address });
    if (native < GAS_MIN) {
      this.authorityCheck();
      this.transferEvidence.nativeSendStarted = true;
      const gasTx = await this.funderWallet.sendTransaction({ to: this.spend.address, value: GAS_TOPUP });
      this.transferEvidence.nativeTxHash = gasTx;
      await this.confirmed(gasTx);
    }

    // 2) One bounded deposit; never automatically add deposits for a larger budget.
    const usdcBal = await this.publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.spend.address],
    });
    if (usdcBal < depositAtomic) {
      this.authorityCheck();
      this.transferEvidence.usdcSendStarted = true;
      const usdcTx = await this.funderWallet.writeContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [this.spend.address, depositAtomic],
      });
      this.transferEvidence.usdcTxHash = usdcTx;
      await this.confirmed(usdcTx);
    }

    this.depositAttempt = createGatewayDepositAttempt({ address: this.spend.address,
      amountMicros: depositAtomic, maxAmountMicros: depositAtomic,
      publicClient: this.publicClient, walletClient: this.spendWallet, guard: this.guard });
    const dep = await this.depositAttempt.run();

    // Circle's facilitator settles against the OFF-CHAIN Gateway balance, which lags the on-chain
    // deposit tx. Poll until credited before returning (else settle → insufficient_balance).
    const want = available + depositAtomic;
    const toleratedCredit = want - parseUnits("0.01", 6);
    const requiredCredit = toleratedCredit > minAvailable ? toleratedCredit : minAvailable;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const credited = await this.available();
      if (credited >= requiredCredit)
        return { address: this.spend.address, depositTx: dep.depositTxHash };
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("Gateway deposit credit unresolved; retain original funding evidence");
  }

}
