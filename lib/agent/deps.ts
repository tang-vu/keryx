/**
 * Agent dependencies — wires the reasoning engine, datastore, and payment gateway.
 * Injectable so the orchestrator can be tested with fakes and so the SSE route can
 * inject a BrowserCoSignGateway without the selector needing an SSE controller.
 */

import { getDb, type KeryxDB } from "../db";
import { getReasoningEngine, type ReasoningEngine } from "../llm";
import { getPaymentGateway, type GatewayOpts, type PaymentGateway } from "../payments/payment-gateway";

export interface AgentDeps {
  engine: ReasoningEngine;
  db: KeryxDB;
  gateway: PaymentGateway;
}

/**
 * Build agent dependencies.
 *
 * opts.gateway — when already constructed by the caller (e.g. the SSE route
 *   with a BrowserCoSignGateway), it is used directly and gateway opts are ignored.
 * opts.gatewayOpts — forwarded to getPaymentGateway() when no pre-built gateway
 *   is supplied (the common case for collectRun / volume engine / A2A).
 */
export async function getAgentDeps(opts?: {
  gateway?: PaymentGateway;
  gatewayOpts?: GatewayOpts;
}): Promise<AgentDeps> {
  const db = await getDb();
  const gateway = opts?.gateway ?? (await getPaymentGateway(db, opts?.gatewayOpts));
  const engine = getReasoningEngine();
  return { engine, db, gateway };
}
