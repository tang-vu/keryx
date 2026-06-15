/**
 * Agent dependencies — wires the reasoning engine, datastore, and payment gateway.
 * Injectable so the orchestrator can be tested with fakes.
 */

import { getDb, type KeryxDB } from "../db";
import { getReasoningEngine, type ReasoningEngine } from "../llm";
import { getPaymentGateway, type PaymentGateway } from "../payments/payment-gateway";

export interface AgentDeps {
  engine: ReasoningEngine;
  db: KeryxDB;
  gateway: PaymentGateway;
}

export async function getAgentDeps(): Promise<AgentDeps> {
  const db = await getDb();
  const gateway = await getPaymentGateway(db);
  const engine = getReasoningEngine();
  return { engine, db, gateway };
}
