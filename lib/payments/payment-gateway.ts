/**
 * PaymentGateway — the agent's money interface.
 *
 * `real`   → settles on Arc testnet via Circle x402 (GatewayClient.pay). The demo path.
 * `offline`→ reads content from the DB and records simulated payments (settled:false) so the
 *            full reasoning + settlement FLOW runs with no funded wallet. Never the demo path.
 *
 * Selection: real when a funder key is configured and KERYX_FORCE_OFFLINE !== "1".
 */

import { config } from "../config";
import type { Author, PaymentRecord, Source } from "../types";
import type { KeryxDB } from "../db";

export interface FetchResult {
  content: string;
  payment: PaymentRecord;
}

export interface PaymentGateway {
  readonly mode: "real" | "offline";
  /** Ensure the agent's spend wallet is funded for this run. Returns the agent address. */
  ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }>;
  /** Pay the x402 access toll for a source and return its unlocked content. */
  payFetch(args: { source: Source; queryId: string }): Promise<FetchResult>;
  /** Settle a weighted citation reward to one author wallet. */
  payCitation(args: {
    source: Source;
    author: Author;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
  }): Promise<PaymentRecord>;
  agentAddress(): string;
}

export async function getPaymentGateway(db: KeryxDB): Promise<PaymentGateway> {
  const useReal =
    config.funderKey.length > 0 && process.env.KERYX_FORCE_OFFLINE !== "1";
  if (useReal) {
    const { RealGateway } = await import("./real-gateway");
    return new RealGateway();
  }
  const { OfflineGateway } = await import("./offline-gateway");
  return new OfflineGateway(db);
}

/** Build a PaymentRecord with consistent defaults. */
export function makePayment(
  partial: Omit<PaymentRecord, "network" | "createdAt"> &
    Partial<Pick<PaymentRecord, "network" | "createdAt">>,
): PaymentRecord {
  return {
    network: config.networkId,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}
