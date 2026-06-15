/**
 * OfflineGateway — runs the full agent flow with no funded wallet.
 * Content comes straight from the DB; payments are recorded as simulated (settled:false)
 * and clearly excluded from "real settlement" claims. Dev only.
 */

import type { Author, PaymentRecord, Source } from "../types";
import type { KeryxDB } from "../db";
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
    queryId,
  }: {
    source: Source;
    queryId: string;
  }): Promise<FetchResult> {
    const items = await this.db.getItems(source.id);
    const content =
      items
        .slice(0, 5)
        .map((i) => `## ${i.title}\n${i.content || i.summary}`)
        .join("\n\n") || source.description;

    const payment = makePayment({
      kind: "fetch",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer: this.address,
      payee: source.walletAddress,
      amountUsdc: source.fetchPrice,
      txHash: null,
      settled: false,
      rationale: "Access toll (simulated — offline dev mode).",
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
    return makePayment({
      kind: "citation",
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer: this.address,
      payee: author.walletAddress,
      amountUsdc: amount,
      weight,
      rationale,
      txHash: null,
      settled: false,
    });
  }
}
