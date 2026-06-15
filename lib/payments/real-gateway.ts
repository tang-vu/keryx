/**
 * RealGateway — settles on Arc testnet via Circle x402 batched nanopayments.
 *
 * Flow (mirrors the verified scaffold): spin an ephemeral spend wallet, fund it from the funder
 * (native USDC for gas + ERC-20 USDC to spend), deposit into the Gateway Wallet, then
 * `gateway.pay()` each source/cite endpoint. The toll/reward lands in the creator's wallet
 * because each endpoint declares `payTo = creatorWallet`. Every payment is a real settlement.
 */

import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import type { Author, PaymentRecord, Source } from "../types";
import { makePayment, type FetchResult, type PaymentGateway } from "./payment-gateway";

const GAS_FUND = parseEther("0.02"); // native USDC for gas (18 decimals on Arc)

export class RealGateway implements PaymentGateway {
  readonly mode = "real" as const;
  private ephemeralKey = generatePrivateKey();
  private ephemeral = privateKeyToAccount(this.ephemeralKey);
  private gateway = new GatewayClient({
    chain: config.network as SupportedChainName,
    privateKey: this.ephemeralKey,
    rpcUrl: config.rpcUrl,
  });
  private funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  private publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  private funderWallet = createWalletClient({
    account: this.funder,
    chain: arcTestnet,
    transport: http(config.rpcUrl),
  });

  agentAddress(): string {
    return this.ephemeral.address;
  }

  async ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }> {
    const depositStr = Math.max(budget * 1.2, 0.05).toFixed(6);
    const usdcAtomic = parseUnits(depositStr, 6);

    // 1) gas (native USDC), wait, 2) ERC-20 USDC to spend, wait
    const gasTx = await this.funderWallet.sendTransaction({
      to: this.ephemeral.address,
      value: GAS_FUND,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: gasTx });

    const usdcTx = await this.funderWallet.writeContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [this.ephemeral.address, usdcAtomic],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: usdcTx });

    // 3) move USDC into Gateway for gasless batched spending
    const dep = await this.gateway.deposit(depositStr);
    return { address: this.ephemeral.address, depositTx: dep.depositTxHash };
  }

  async payFetch({
    source,
    queryId,
  }: {
    source: Source;
    queryId: string;
  }): Promise<FetchResult> {
    const url = `${config.baseUrl}/api/source/${source.id}`;
    const r = await this.gateway.pay<{ content?: string; text?: string; items?: unknown }>(url);
    const content =
      r.data?.content ?? r.data?.text ?? JSON.stringify(r.data ?? {});
    const payment = makePayment({
      kind: "fetch",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer: this.ephemeral.address,
      payee: source.walletAddress,
      amountUsdc: numAmount(r.formattedAmount, source.fetchPrice),
      txHash: r.transaction,
      settled: true,
      rationale: "Access toll settled on Arc via x402.",
    });
    return { content, payment };
  }

  async payCitation({
    source,
    author,
    amount,
    weight,
    queryId,
    rationale,
  }: {
    source: Source;
    author: Author;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
  }): Promise<PaymentRecord> {
    const url = `${config.baseUrl}/api/cite/${source.id}?author=${encodeURIComponent(
      author.walletAddress,
    )}&amount=${amount.toFixed(6)}&query=${encodeURIComponent(queryId)}`;
    const r = await this.gateway.pay<{ ok?: boolean }>(url, { method: "POST" });
    return makePayment({
      kind: "citation",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer: this.ephemeral.address,
      payee: author.walletAddress,
      amountUsdc: numAmount(r.formattedAmount, amount),
      weight,
      rationale,
      txHash: r.transaction,
      settled: true,
    });
  }
}

function numAmount(formatted: string | undefined, fallback: number): number {
  const n = formatted ? parseFloat(formatted) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
