/**
 * OfflineGateway — runs the full agent flow with no funded wallet.
 * Content comes straight from the DB; payments are recorded as simulated (settled:false)
 * and clearly excluded from "real settlement" claims. Dev only.
 */

import type { ArticleOfferRef, Author, PaymentRecord, Source, SourceItem, SourceItemIdentity } from "../types";
import type { KeryxDB } from "../db";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { makePayment, type FetchResult, type PaymentGateway } from "./payment-gateway";

export class OfflineGateway implements PaymentGateway {
  readonly mode = "offline" as const;
  private address = "0xOFFLINE_AGENT";

  constructor(private db: KeryxDB) {}

  async ensureFunded(): Promise<{ address: string }> {
    return { address: this.address };
  }

  agentAddress(): string {
    return this.address;
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
    const items = item ? [item] : await this.db.getItems(source.id);
    const content = item
      ? item.content || item.summary
      : items
          .slice(0, 5)
          .map((i) => `## ${i.title}\n${i.content || i.summary}`)
          .join("\n\n") || source.description;
    const itemIdentity = item ? sourceItemIdentity(item) : {};

    const payment = makePayment({
      kind: "fetch",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...itemIdentity,
      offerId: offer?.id,
      listPriceUsdc: offer?.listPriceUsdc,
      payer: this.address,
      payee: source.walletAddress,
      amountUsdc: priceUsdc,
      txHash: null,
      settled: false,
      settlementStatus: "simulated",
      rationale: "Access toll (simulated — offline dev mode).",
    });
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
    return makePayment({
      kind: "citation",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...item,
      payer: this.address,
      payee: author.walletAddress,
      amountUsdc: amount,
      weight,
      rationale,
      txHash: null,
      settled: false,
      settlementStatus: "simulated",
    });
  }
}
