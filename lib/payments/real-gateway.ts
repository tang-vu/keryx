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
  GatewayClient,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  parseEther,
  parseUnits,
} from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { assertArcRpcChain, attestedArcHttp } from "../arc-rpc-attestation";
import { ServerPaymentGateway } from "./server-payment-gateway";
import type { BatchPayloadSigner } from "./server-x402-client";
import { requireRuntimeStorageMode } from "../db/runtime-storage-config";

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
  protected spend: ReturnType<typeof privateKeyToAccount>;
  private signer: BatchEvmScheme;
  private gateway: GatewayClient;
  private funder: ReturnType<typeof privateKeyToAccount>;
  private publicClient: ReturnType<typeof createPublicClient>;
  private funderWallet: ReturnType<typeof createWalletClient<ReturnType<typeof attestedArcHttp>, typeof arcTestnet, ReturnType<typeof privateKeyToAccount>>>;
  constructor(private readonly authorityCheck: () => void) {
    super(); authorityCheck();
    this.paymentAuthorityCheck = authorityCheck;
    this.spendKey = loadSpendKey();
    this.spend = privateKeyToAccount(this.spendKey);
    this.signer = new BatchEvmScheme(this.spend);
    this.gateway = new GatewayClient({ chain: config.network as SupportedChainName,
      privateKey: this.spendKey, rpcUrl: config.rpcUrl });
    this.funder = privateKeyToAccount(config.funderKey as `0x${string}`);
    this.publicClient = createPublicClient({ chain: arcTestnet, transport: attestedArcHttp(config.rpcUrl) });
    this.funderWallet = createWalletClient({ account: this.funder, chain: arcTestnet, transport: attestedArcHttp(config.rpcUrl) });
  }
  protected batchScheme: BatchPayloadSigner = {
    createPaymentPayload: async (version, requirements) => {
      this.authorityCheck();
      await assertArcRpcChain(config.rpcUrl);
      this.authorityCheck();
      return this.signer.createPaymentPayload(version, requirements);
    },
  };

  async ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }> {
    this.authorityCheck();
    // 1) Gas: native USDC for the deposit/approval txs.
    const native = await this.publicClient.getBalance({ address: this.spend.address });
    if (native < GAS_MIN) {
      this.authorityCheck();
      const gasTx = await this.funderWallet.sendTransaction({ to: this.spend.address, value: GAS_TOPUP });
      await this.publicClient.waitForTransactionReceipt({ hash: gasTx, timeout: 90_000 });
    }

    // 2) Gateway balance: top up only when below threshold (reuse the balance across queries).
    const minAvailable = parseUnits(
      Math.max(config.gatewayMinAvailableUsdc, budget).toFixed(6),
      6,
    );
    const balances = await this.gateway.getBalances();
    if (balances.gateway.available >= minAvailable) {
      return { address: this.spend.address }; // already funded
    }

    const depositStr = config.gatewayDepositUsdc;
    const depositAtomic = parseUnits(depositStr, 6);
    const usdcBal = await this.publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.spend.address],
    });
    if (usdcBal < depositAtomic) {
      this.authorityCheck();
      const usdcTx = await this.funderWallet.writeContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [this.spend.address, depositAtomic],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: usdcTx, timeout: 90_000 });
    }

    await assertArcRpcChain(config.rpcUrl);
    this.authorityCheck();
    const dep = await this.gateway.deposit(depositStr);

    // Circle's facilitator settles against the OFF-CHAIN Gateway balance, which lags the on-chain
    // deposit tx. Poll until credited before returning (else settle → insufficient_balance).
    const want = balances.gateway.available + depositAtomic;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const b = await this.gateway.getBalances();
      if (b.gateway.available >= want - parseUnits("0.01", 6)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return { address: this.spend.address, depositTx: dep.depositTxHash };
  }

}
