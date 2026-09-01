import crypto from "node:crypto";
import type { ResearchMode } from "../types";

export type A2aOrderStatus = "running" | "completed" | "failed";

export interface A2aOrderRequest {
  question: string;
  model?: string;
  origin: "a2a" | "engine";
}

export interface A2aOrder {
  id: string;
  queryId: string;
  authorizationId: string;
  requestHash: string;
  payer: string;
  payee: string;
  amountUsdc: number;
  creatorBudgetUsdc: number;
  serviceFeeUsdc: number;
  researchMode: ResearchMode;
  status: A2aOrderStatus;
  transaction: string;
  /** Private worker input. Never expose this field from the polling endpoint. */
  request: A2aOrderRequest | null;
  /** Null means durably queued. Once set, the job is never automatically claimed again. */
  startedAt: string | null;
  workerId: string | null;
  response: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export function a2aOrderId(input: {
  network: string;
  payer: string;
  payee: string;
  authorizationId: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        "keryx-a2a-v2",
        input.network,
        input.payer.toLowerCase(),
        input.payee.toLowerCase(),
        input.authorizationId.toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
  return `a2a_${digest}`;
}

export function a2aRequestHash(input: {
  question: string;
  creatorBudgetUsdc: number;
  serviceFeeUsdc: number;
  researchMode: ResearchMode;
  model?: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        question: input.question,
        creatorBudgetUsdc6: Math.round(input.creatorBudgetUsdc * 1e6),
        serviceFeeUsdc6: Math.round(input.serviceFeeUsdc * 1e6),
        researchMode: input.researchMode,
        model: input.model ?? null,
      }),
    )
    .digest("hex");
}

/** A conflict may be replay, but never trust it until the incoming economic tuple agrees. */
export function sameA2aOrder(a: A2aOrder, b: A2aOrder): boolean {
  return (
    a.id === b.id &&
    a.queryId === b.queryId &&
    a.authorizationId.toLowerCase() === b.authorizationId.toLowerCase() &&
    a.requestHash === b.requestHash &&
    a.payer.toLowerCase() === b.payer.toLowerCase() &&
    a.payee.toLowerCase() === b.payee.toLowerCase() &&
    Math.round(a.amountUsdc * 1e6) === Math.round(b.amountUsdc * 1e6) &&
    Math.round(a.creatorBudgetUsdc * 1e6) === Math.round(b.creatorBudgetUsdc * 1e6) &&
    Math.round(a.serviceFeeUsdc * 1e6) === Math.round(b.serviceFeeUsdc * 1e6) &&
    a.researchMode === b.researchMode &&
    a.transaction === b.transaction
  );
}
