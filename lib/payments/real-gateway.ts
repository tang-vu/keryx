/**
 * RealGateway — settles on Arc testnet via Circle x402 batched nanopayments.
 *
 * Uses a PERSISTENT spend wallet (data/spend-wallet.json) that maintains a reusable Gateway
 * balance: it funds gas + deposits USDC only when the balance drops below a threshold, then
 * `gateway.pay()`s each source/cite endpoint (payTo = creator wallet → real settlement to creators).
 * Circle's facilitator won't settle against tiny balances, so we keep ~1 USDC and top up as needed;
 * the orchestrator's per-query budget (not the deposit) caps actual spend.
 */

import fs from "node:fs";
import path from "node:path";
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

const GAS_TOPUP = parseEther("0.05"); // native USDC for gas (18 decimals on Arc)
const GAS_MIN = parseEther("0.01");
const STORE = path.resolve(process.cwd(), "data", "spend-wallet.json");

/** Load (or create) the persistent spend wallet so its Gateway balance is reused across runs. */
function loadSpendKey(): `0x${string}` {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8")).privateKey;
  } catch {
    const pk = generatePrivateKey();
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify({ privateKey: pk, address: privateKeyToAccount(pk).address }, null, 2));
    return pk;
  }
}

export class RealGateway implements PaymentGateway {
  readonly mode = "real" as const;
  private spendKey = loadSpendKey();
  private spend = privateKeyToAccount(this.spendKey);
  private gateway = new GatewayClient({
    chain: config.network as SupportedChainName,
    privateKey: this.spendKey,
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
    return this.spend.address;
  }

  async ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }> {
    // 1) Gas: native USDC for the deposit/approval txs.
    const native = await this.publicClient.getBalance({ address: this.spend.address });
    if (native < GAS_MIN) {
      const gasTx = await this.funderWallet.sendTransaction({ to: this.spend.address, value: GAS_TOPUP });
      await this.publicClient.waitForTransactionReceipt({ hash: gasTx });
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
      const usdcTx = await this.funderWallet.writeContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [this.spend.address, depositAtomic],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: usdcTx });
    }

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

  async payFetch({ source, queryId }: { source: Source; queryId: string }): Promise<FetchResult> {
    const url = `${config.baseUrl}/api/source/${source.id}`;
    const r = await this.gateway.pay<{ content?: string; text?: string }>(url);
    const content = r.data?.content ?? r.data?.text ?? JSON.stringify(r.data ?? {});
    const payment = makePayment({
      kind: "fetch",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer: this.spend.address,
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
      payer: this.spend.address,
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
