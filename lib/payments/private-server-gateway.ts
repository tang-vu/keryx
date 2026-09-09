import type { KeryxDB } from "../db/keryx-db";
import { addressSchema } from "../buyer/protocol";
import { privateResearchIdSchema } from "../a2a/private-research-intent";
import { ServerPaymentGateway } from "./server-payment-gateway";
import type { BatchPayloadSigner } from "./server-x402-client";
import { privateCreatorJournal } from "./private-creator-journal";

/** Internal gateway; the execution factory must provide a fresh validated worker and trusted signer. */
export class PrivateServerGateway extends ServerPaymentGateway {
  protected spend: { address: string };
  protected batchScheme: BatchPayloadSigner;
  private readonly getGatewayBalance: () => Promise<bigint>;

  constructor(options: {
    signerAddress: string; signer: BatchPayloadSigner; getGatewayBalance: () => Promise<bigint>;
    db: Pick<KeryxDB, "admitPrivateCreatorSubmission" | "confirmPrivateCreatorSubmission">;
    job: { id: string; owner: string; workerId: string };
  }) {
    super();
    const id = privateResearchIdSchema.parse(options.job.id), payer = addressSchema.parse(options.job.owner).toLowerCase();
    const workerId = options.job.workerId;
    this.spend = { address: addressSchema.parse(options.signerAddress).toLowerCase() };
    this.batchScheme = options.signer;
    this.getGatewayBalance = options.getGatewayBalance;
    const db = options.db;
    this.paymentJournal = input => {
      if (input.queryId !== id) throw new Error("Private gateway belongs to another job");
      return privateCreatorJournal(db, { id, payer, workerId, kind: input.kind, sourceId: input.sourceId, itemId: input.itemId });
    };
  }

  async ensureFunded(budget: number) {
    const micros = Math.round(budget * 1e6);
    if (!Number.isFinite(budget) || budget <= 0 || budget > 1 || !Number.isSafeInteger(micros)
      || micros <= 0 || Math.abs(budget - micros / 1e6) > 1e-10) throw new Error("Invalid private creator budget");
    const balance = await this.getGatewayBalance();
    if (typeof balance !== "bigint" || balance < BigInt(micros)) throw new Error("Private creator payer requires prefunding");
    return { address: this.spend.address };
  }
}
