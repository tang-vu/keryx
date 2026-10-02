/**
 * PaymentGateway — the agent's money interface.
 *
 * `real`    → the trusted selected Arc profile. A browser grant uses caller-owned custody.
 *             Mainnet hosted requests require a reviewed sealed-storage policy and separately
 *             admitted, prefunded signer. Testnet retains its legacy treasury funding adapter.
 * `offline` → reads content from the DB and records simulated payments (settled:false) so the
 *             full reasoning + settlement FLOW runs with no funded wallet. Never the demo path.
 *
 * An expired/missing caller grant never falls back to treasury. Mainnet never falls back
 * to simulation or legacy custody because a treasury policy/key/balance is absent.
 */

import { config } from "../config";
import type {
  ArticleOfferRef,
  Author,
  PaymentRecord,
  Source,
  SourceItem,
  SourceItemIdentity,
} from "../types";
import type { KeryxDB } from "../db";
import type { RequestSignatureFn } from "./browser-cosign-gateway";
import { assertPaymentSettlementState } from "./payment-state";

export interface FetchResult {
  content: string;
  payment: PaymentRecord;
}

export interface PaymentGateway {
  readonly mode: "real" | "offline";
  /** Ensure the agent's spend wallet is funded for this run. Returns the agent address. */
  ensureFunded(budget: number): Promise<{ address: string; depositTx?: string }>;
  /** Pay the x402 access toll for one article, or the legacy source bundle when item is absent. */
  payFetch(args: {
    source: Source;
    item?: SourceItem;
    queryId: string;
    /** Trusted discovery price, independently checked against the x402 challenge. */
    priceUsdc?: number;
    offer?: ArticleOfferRef;
  }): Promise<FetchResult>;
  /** Settle a weighted citation reward to one author wallet. */
  payCitation(args: {
    source: Source;
    author: Author;
    item?: SourceItemIdentity;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
  }): Promise<PaymentRecord>;
  agentAddress(): string;
}

export interface GatewayOpts {
  /** Present when the /api/ask route has an active browser co-sign grant. */
  sessionId?: string;
  /** Injected by the SSE route to emit sign-request events and await browser responses. */
  requestSignature?: RequestSignatureFn;
  /** AbortSignal tied to the SSE client connection — used to cancel pending signs. */
  abortSignal?: AbortSignal;
}

export async function getPaymentGateway(db: KeryxDB, opts?: GatewayOpts): Promise<PaymentGateway> {
  if (opts?.requestSignature && !opts.sessionId) {
    throw new Error("browser signature callback requires a session id");
  }
  if (process.env.KERYX_FORCE_OFFLINE === "1") {
    if (config.profile.name === "arc") throw new Error("Mainnet payments cannot select offline simulation");
    const { OfflineGateway } = await import("./offline-gateway");
    return new OfflineGateway(db);
  }

  // Browser co-sign path: active session grant + sign callback injected by the SSE route.
  if (opts?.sessionId) {
    if (!opts.requestSignature) throw new Error("browser session requires a signature callback");
    const { getGrant } = await import("./session-grants");
    const grant = await getGrant(opts.sessionId);
    if (!grant) throw new Error("browser session grant expired or revoked");
    const { BrowserCoSignGateway } = await import("./browser-cosign-gateway");
    return new BrowserCoSignGateway(
      opts.sessionId,
      grant.sessAddr,
      opts.requestSignature,
      opts.abortSignal,
      grant.grantEpoch,
    );
  }

  if (config.profile.name === "arc") {
    const { createMainnetHostedGateway } = await import("./mainnet-hosted-gateway");
    return createMainnetHostedGateway(db);
  }

  // Legacy testnet treasury path retains its original wallet/funding behavior.
  if (config.funderKey.length > 0) {
    const { RealGateway } = await import("./real-gateway");
    return new RealGateway();
  }

  if (config.profile.name === "arc") throw new Error("Mainnet treasury payment authority is unavailable");

  const { OfflineGateway } = await import("./offline-gateway");
  return new OfflineGateway(db);
}

/** Build a PaymentRecord with consistent defaults. */
export function makePayment(
  partial: Omit<PaymentRecord, "network" | "createdAt"> &
    Partial<Pick<PaymentRecord, "network" | "createdAt">>,
): PaymentRecord {
  const payment: PaymentRecord = {
    network: config.networkId,
    createdAt: new Date().toISOString(),
    ...partial,
  };
  payment.settlementStatus = assertPaymentSettlementState(payment);
  return payment;
}
