/**
 * PaymentGateway — the agent's money interface.
 *
 * `real`    → settles on Arc testnet via Circle x402. Two sub-modes:
 *             BrowserCoSignGateway: user funds their own session EOA; browser co-signs each
 *               authorization (non-custodial). Selected when a session grant is active.
 *             RealGateway: Keryx treasury wallet (GatewayClient.pay). Used by the volume
 *               engine / A2A / collectRun when no browser session is present.
 * `offline` → reads content from the DB and records simulated payments (settled:false) so the
 *             full reasoning + settlement FLOW runs with no funded wallet. Never the demo path.
 *
 * Selection priority: BrowserCoSign (active grant) → Real (funder key) → Offline.
 */

import { config } from "../config";
import type { Author, PaymentRecord, Source } from "../types";
import type { KeryxDB } from "../db";
import type { RequestSignatureFn } from "./browser-cosign-gateway";

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

export interface GatewayOpts {
  /** Present when the /api/ask route has an active browser co-sign grant. */
  sessionId?: string;
  /** Injected by the SSE route to emit sign-request events and await browser responses. */
  requestSignature?: RequestSignatureFn;
  /** AbortSignal tied to the SSE client connection — used to cancel pending signs. */
  abortSignal?: AbortSignal;
}

export async function getPaymentGateway(db: KeryxDB, opts?: GatewayOpts): Promise<PaymentGateway> {
  if (process.env.KERYX_FORCE_OFFLINE === "1") {
    const { OfflineGateway } = await import("./offline-gateway");
    return new OfflineGateway(db);
  }

  // Browser co-sign path: active session grant + sign callback injected by the SSE route.
  if (opts?.sessionId && opts?.requestSignature) {
    const { isGrantValid } = await import("./session-grants");
    if (isGrantValid(opts.sessionId)) {
      const { BrowserCoSignGateway } = await import("./browser-cosign-gateway");
      return new BrowserCoSignGateway(opts.sessionId, opts.requestSignature, opts.abortSignal);
    }
  }

  // Treasury path: Keryx's own funder key (volume engine / A2A / collectRun).
  if (config.funderKey.length > 0) {
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
