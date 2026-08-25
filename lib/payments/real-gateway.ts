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
  http,
  parseEther,
  parseUnits,
} from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import type { ArticleOfferRef, Author, PaymentRecord, Source, SourceItem, SourceItemIdentity } from "../types";
import {
  matchesSourceItemIdentity,
  sourceItemIdentity,
} from "../sources/source-item-asset";
import { articlePaidPath } from "../offers/resolve-article-offer";
import { sourceFetchPayTo } from "../registry/source-fetch-payto";
import { makePayment, type FetchResult, type PaymentGateway } from "./payment-gateway";
import { PaymentPendingError, PaymentSettledError } from "./payment-state";
import { payWithServerSigner, type ServerX402Attempt } from "./server-x402-client";

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
  private batchScheme = new BatchEvmScheme(this.spend);
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
      const usdcTx = await this.funderWallet.writeContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [this.spend.address, depositAtomic],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: usdcTx, timeout: 90_000 });
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

  async payFetch({
    source,
    item,
    queryId,
    priceUsdc = source.fetchPrice,
    offer,
  }: {
    source: Source;
    item?: SourceItem;
    queryId: string;
    priceUsdc?: number;
    offer?: ArticleOfferRef;
  }): Promise<FetchResult> {
    const url = item
      ? `${config.baseUrl}${articlePaidPath({
          sourceId: source.id,
          itemId: item.id,
          contentVersion: sourceItemIdentity(item).contentVersion,
          offerId: offer?.id,
          listPriceUsdc: offer?.listPriceUsdc,
        })}`
      : `${config.baseUrl}/api/source/${source.id}`;
    const itemIdentity = item ? sourceItemIdentity(item) : undefined;
    const fetchPayee = await sourceFetchPayTo(source);
    const attempt = await payWithServerSigner<{
      content?: string;
      text?: string;
      item?: SourceItemIdentity;
      pricing?: { offerId?: string | null; priceUsdc?: number; listPriceUsdc?: number };
    }>({
      url,
      method: "GET",
      expectedPayee: fetchPayee,
      expectedAmount: priceUsdc,
      payer: this.spend.address,
      signer: this.batchScheme,
    });
    const payment = paymentFromAttempt(attempt, {
      kind: "fetch",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...(itemIdentity ?? {}),
      offerId: offer?.id,
      listPriceUsdc: offer?.listPriceUsdc,
      payer: this.spend.address,
      payee: fetchPayee,
      settledRationale: "Access toll settled on Arc via x402.",
    });
    throwIfDeliveryFailed(attempt, payment, source.name);
    if (itemIdentity && !matchesSourceItemIdentity(attempt.data?.item, itemIdentity)) {
      throwIdentityMismatch(payment, source.name);
    }
    if (itemIdentity && !matchesArticlePricing(attempt.data?.pricing, priceUsdc, offer)) {
      throwPricingMismatch(payment, source.name);
    }
    const content = attempt.data?.content ?? attempt.data?.text ?? JSON.stringify(attempt.data ?? {});
    return { content, payment };
  }

  async payCitation({
    source,
    author,
    item,
    amount,
    weight,
    queryId,
    rationale,
  }: {
    source: Source;
    author: Author;
    item?: SourceItemIdentity;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
  }): Promise<PaymentRecord> {
    const url = `${config.baseUrl}/api/cite/${source.id}?author=${encodeURIComponent(
      author.walletAddress,
    )}&amount=${amount.toFixed(6)}&query=${encodeURIComponent(queryId)}`;
    const attempt = await payWithServerSigner<{ ok?: boolean }>({
      url,
      method: "POST",
      expectedPayee: author.walletAddress,
      expectedAmount: amount,
      payer: this.spend.address,
      signer: this.batchScheme,
    });
    const payment = paymentFromAttempt(attempt, {
      kind: "citation",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...item,
      payer: this.spend.address,
      payee: author.walletAddress,
      weight,
      settledRationale: rationale,
    });
    throwIfDeliveryFailed(attempt, payment, source.name);
    return payment;
  }
}

interface AttemptPaymentContext extends Partial<SourceItemIdentity> {
  kind: "fetch" | "citation";
  queryId: string;
  sourceId: string;
  sourceName: string;
  payer: string;
  payee: string;
  weight?: number;
  settledRationale: string;
  offerId?: string;
  listPriceUsdc?: number;
}

function paymentFromAttempt(
  attempt: ServerX402Attempt<unknown>,
  context: AttemptPaymentContext,
): PaymentRecord {
  const settled = attempt.settlementStatus === "settled";
  return makePayment({
    id: `x402:${attempt.authorizationId}`,
    kind: context.kind,
    queryId: context.queryId,
    sourceId: context.sourceId,
    sourceName: context.sourceName,
    itemId: context.itemId,
    itemTitle: context.itemTitle,
    itemUrl: context.itemUrl,
    contentVersion: context.contentVersion,
    itemPublishedAt: context.itemPublishedAt,
    offerId: context.offerId,
    listPriceUsdc: context.listPriceUsdc,
    payer: context.payer,
    payee: context.payee,
    amountUsdc: attempt.amountUsdc,
    weight: context.weight,
    txHash: attempt.transaction,
    settled,
    settlementStatus: attempt.settlementStatus,
    authorizationId: attempt.authorizationId,
    authorizationExpiresAt: attempt.authorizationExpiresAt,
    rationale: settled
      ? context.settledRationale
      : `Signed x402 authorization submitted; settlement confirmation unavailable (${attempt.reason ?? "missing Circle receipt"}).`,
  });
}

function throwIfDeliveryFailed(
  attempt: ServerX402Attempt<unknown>,
  payment: PaymentRecord,
  sourceName: string,
): void {
  if (attempt.delivered) return;
  const reason = attempt.reason ?? "paid resource unavailable";
  if (payment.settled) {
    payment.rationale = `Circle settlement confirmed, but the paid route failed (${reason}).`;
    throw new PaymentSettledError(
      `payment settled, but ${sourceName} could not deliver its paid response (${reason})`,
      payment,
    );
  }
  throw new PaymentPendingError(
    `settlement confirmation pending after signed submission (${reason})`,
    payment,
  );
}

function throwIdentityMismatch(payment: PaymentRecord, sourceName: string): never {
  const reason = "paid response did not match the selected article version";
  if (payment.settled) {
    payment.rationale = `Circle settlement confirmed, but ${reason}.`;
    throw new PaymentSettledError(
      `payment settled, but ${sourceName} returned a different article identity`,
      payment,
    );
  }
  throw new PaymentPendingError(
    `settlement confirmation pending and ${reason}`,
    payment,
  );
}

function matchesArticlePricing(
  value: unknown,
  expectedPrice: number,
  offer?: ArticleOfferRef,
): boolean {
  if (!value || typeof value !== "object") return false;
  const pricing = value as {
    offerId?: string | null;
    priceUsdc?: number;
    listPriceUsdc?: number;
  };
  return (
    pricing.offerId === (offer?.id ?? null) &&
    Math.abs(Number(pricing.priceUsdc) - expectedPrice) < 0.0000005 &&
    (!offer || Math.abs(Number(pricing.listPriceUsdc) - offer.listPriceUsdc) < 0.0000005)
  );
}

function throwPricingMismatch(payment: PaymentRecord, sourceName: string): never {
  const reason = "paid response did not match the selected article offer";
  if (payment.settled) {
    payment.rationale = `Circle settlement confirmed, but ${reason}.`;
    throw new PaymentSettledError(
      `payment settled, but ${sourceName} returned different article pricing`,
      payment,
    );
  }
  throw new PaymentPendingError(`settlement confirmation pending and ${reason}`, payment);
}
