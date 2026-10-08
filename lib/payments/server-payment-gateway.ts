import { config } from "../config";
import type { ArticleOfferRef, Author, PaymentRecord, Source, SourceItem, SourceItemIdentity, SourceClaimReceipt } from "../types";
import { sourceClaimPath } from "../sources/source-claim-request";
import { assertCreatorPaymentClaim } from "./source-claim-payment";
import { matchesSourceItemIdentity, sourceItemIdentity } from "../sources/source-item-asset";
import { articlePaidPath } from "../offers/resolve-article-offer";
import { sourceFetchPayTo, sourceFetchTerms } from "../registry/source-fetch-payto";
import { makePayment, type FetchResult, type PaymentGateway } from "./payment-gateway";
import { PaymentPendingError, PaymentSettledError } from "./payment-state";
import { payWithServerSigner, type ServerX402Attempt, type BatchPayloadSigner, type ServerX402Submission } from "./server-x402-client";
import type { privateCreatorJournal } from "./private-creator-journal";
import { assertRecipientAllowed, type RecipientExclusion } from "./recipient-exclusion";
import { readPaidArticleBody, selectedArticleBodyContract } from "./paid-article-body";

export type PaymentJournalContext =
  | { queryId: string; kind: "fetch" | "citation"; sourceId: string; itemId: string | null; sourceClaim?: SourceClaimReceipt }
  | { queryId: string; kind: "operating-fee"; sourceId: "keryx:operating-fee"; itemId: null; operatingFee: import("./operating-fee-policy").OperatingFeeContext };

/** Shared creator payment operations, with no key loading, wallet creation or automatic funding. */
export abstract class ServerPaymentGateway implements PaymentGateway {
  readonly mode = "real" as const;
  protected abstract spend: { address: string };
  protected abstract batchScheme: BatchPayloadSigner;
  protected paymentJournal?: (input: PaymentJournalContext) => ReturnType<typeof privateCreatorJournal> & {
    beforeSignedSubmit?: (submission: Readonly<ServerX402Submission>, headerHash: string) => Promise<void> };
  protected signerForPayment(_input: PaymentJournalContext): BatchPayloadSigner { return this.batchScheme; }
  abstract ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }>;
  agentAddress(): string { return this.spend.address; }

  async payFetch({
    source,
    item,
    queryId,
    priceUsdc = source.fetchPrice,
    offer,
    sourceClaim,
    deniedRecipient,
  }: {
    source: Source;
    item?: SourceItem;
    queryId: string;
    priceUsdc?: number;
    offer?: ArticleOfferRef;
    sourceClaim?: SourceClaimReceipt;
  } & RecipientExclusion): Promise<FetchResult> {
    const bodyContract = selectedArticleBodyContract(item);
    const journal = this.paymentJournal?.({ queryId, kind: "fetch", sourceId: source.id, itemId: item?.id ?? null, sourceClaim });
    await assertCreatorPaymentClaim(source, sourceClaim, "fetch");
    const path = item
      ? articlePaidPath({
          sourceId: source.id,
          itemId: item.id,
          contentVersion: sourceItemIdentity(item).contentVersion,
          offerId: offer?.id,
          listPriceUsdc: offer?.listPriceUsdc,
        })
      : `/api/source/${source.id}`;
    const url = `${config.baseUrl}${sourceClaimPath(path, sourceClaim)}`;
    const itemIdentity = item ? sourceItemIdentity(item) : undefined;
    const fetchPayee = await sourceFetchPayTo(source);
    assertRecipientAllowed(fetchPayee, deniedRecipient);
    const observed = await payWithServerSigner<{
      content?: string;
      text?: string;
      item?: SourceItemIdentity;
      pricing?: { offerId?: string | null; priceUsdc?: number; listPriceUsdc?: number };
    }>({
      url,
      method: "GET",
      expectedPayee: fetchPayee,
      deniedRecipient,
      expectedAmount: priceUsdc,
      payer: this.spend.address,
      signer: this.signerForPayment({ queryId, kind: "fetch", sourceId: source.id, itemId: item?.id ?? null, sourceClaim }),
      beforeSubmit: journal?.beforeSubmit,
      beforeSignedSubmit: journal?.beforeSignedSubmit,
    });
    const outcome = journal ? await journal.recordOutcome(observed) : null;
    const attempt = outcome?.attempt ?? observed;
    const payment = paymentFromAttempt(attempt, {
      kind: "fetch",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...(itemIdentity ?? {}),
      sourceClaim,
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
    const content = readPaidArticleBody(attempt.data?.content ?? attempt.data?.text, bodyContract, payment);
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
    sourceClaim,
    deniedRecipient,
  }: {
    source: Source;
    author: Author;
    item?: SourceItemIdentity;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
    sourceClaim?: SourceClaimReceipt;
  } & RecipientExclusion): Promise<PaymentRecord> {
    assertRecipientAllowed(author.walletAddress, deniedRecipient);
    if (config.profile.name === "arc") {
      const terms = await sourceFetchTerms(source, { refresh: true });
      if (!terms.citationWallets?.has(author.walletAddress.toLowerCase())) throw new Error("Mainnet citation recipient has no fresh source authority");
    }
    const journal = this.paymentJournal?.({ queryId, kind: "citation", sourceId: source.id, itemId: item?.itemId ?? null, sourceClaim });
    await assertCreatorPaymentClaim(source, sourceClaim, "citation");
    const path = `/api/cite/${source.id}?author=${encodeURIComponent(
      author.walletAddress,
    )}&amount=${amount.toFixed(6)}`;
    const url = `${config.baseUrl}${sourceClaimPath(path, sourceClaim)}`;
    const observed = await payWithServerSigner<{ ok?: boolean }>({
      url,
      method: "POST",
      expectedPayee: author.walletAddress,
      deniedRecipient,
      expectedAmount: amount,
      payer: this.spend.address,
      signer: this.signerForPayment({ queryId, kind: "citation", sourceId: source.id, itemId: item?.itemId ?? null, sourceClaim }),
      beforeSubmit: journal?.beforeSubmit,
      beforeSignedSubmit: journal?.beforeSignedSubmit,
    });
    const outcome = journal ? await journal.recordOutcome(observed) : null;
    const attempt = outcome?.attempt ?? observed;
    const payment = paymentFromAttempt(attempt, {
      kind: "citation",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...item,
      sourceClaim,
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

export function checkJournalOutcome(status: string | undefined, payment: PaymentRecord, attempt: ServerX402Attempt<unknown>) {
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
  kind: "fetch" | "citation" | "operating-fee";
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

export function paymentFromAttempt(
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
    sourceClaim: context.sourceClaim,
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
    ...(attempt.authorizationPhase ? { authorizationPhase: attempt.authorizationPhase } : {}),
    rationale: settled
      ? context.settledRationale
      : `Signed x402 authorization submitted; settlement confirmation unavailable (${attempt.reason ?? "missing Circle receipt"}).`,
  });
}

export function throwIfDeliveryFailed(
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
