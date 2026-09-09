import { config } from "../config";
import type { ArticleOfferRef, Author, PaymentRecord, Source, SourceItem, SourceItemIdentity } from "../types";
import { matchesSourceItemIdentity, sourceItemIdentity } from "../sources/source-item-asset";
import { articlePaidPath } from "../offers/resolve-article-offer";
import { sourceFetchPayTo } from "../registry/source-fetch-payto";
import { makePayment, type FetchResult, type PaymentGateway } from "./payment-gateway";
import { PaymentPendingError, PaymentSettledError } from "./payment-state";
import { payWithServerSigner, type ServerX402Attempt, type BatchPayloadSigner } from "./server-x402-client";
import type { privateCreatorJournal } from "./private-creator-journal";

export interface PaymentJournalContext { queryId: string; kind: "fetch" | "citation"; sourceId: string; itemId: string | null }

/** Shared creator payment operations, with no key loading, wallet creation or automatic funding. */
export abstract class ServerPaymentGateway implements PaymentGateway {
  readonly mode = "real" as const;
  protected abstract spend: { address: string };
  protected abstract batchScheme: BatchPayloadSigner;
  protected paymentJournal?: (input: PaymentJournalContext) => ReturnType<typeof privateCreatorJournal>;
  abstract ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }>;
  agentAddress(): string { return this.spend.address; }

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
    const journal = this.paymentJournal?.({ queryId, kind: "fetch", sourceId: source.id, itemId: item?.id ?? null });
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
    const observed = await payWithServerSigner<{
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
      beforeSubmit: journal?.beforeSubmit,
    });
    const outcome = journal ? await journal.recordOutcome(observed) : null;
    const attempt = outcome?.attempt ?? observed;
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
    checkJournalOutcome(outcome?.journalStatus, payment, attempt);
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
    const journal = this.paymentJournal?.({ queryId, kind: "citation", sourceId: source.id, itemId: item?.itemId ?? null });
    const url = `${config.baseUrl}/api/cite/${source.id}?author=${encodeURIComponent(
      author.walletAddress,
    )}&amount=${amount.toFixed(6)}`;
    const observed = await payWithServerSigner<{ ok?: boolean }>({
      url,
      method: "POST",
      expectedPayee: author.walletAddress,
      expectedAmount: amount,
      payer: this.spend.address,
      signer: this.batchScheme,
      beforeSubmit: journal?.beforeSubmit,
    });
    const outcome = journal ? await journal.recordOutcome(observed) : null;
    const attempt = outcome?.attempt ?? observed;
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
    checkJournalOutcome(outcome?.journalStatus, payment, attempt);
    throwIfDeliveryFailed(attempt, payment, source.name);
    return payment;
  }
}

function checkJournalOutcome(status: string | undefined, payment: PaymentRecord, attempt: ServerX402Attempt<unknown>) {
  if (status === "receipt-mismatch") {
    if (payment.settled) throw new PaymentSettledError("Private receipt requires reconciliation", payment);
    throw new PaymentPendingError("Private receipt requires reconciliation", payment);
  }
  if (status === "confirmation-unpersisted") {
    payment.rationale = `${payment.rationale ?? ""} Durable confirmation requires recovery.`.trim();
    if (!attempt.delivered) attempt.reason = `${attempt.reason ?? "paid resource unavailable"}; durable confirmation requires recovery`;
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
