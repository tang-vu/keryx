import crypto from "node:crypto";
import type { ResearchMode } from "../types";

export type A2aOrderStatus = "running" | "completed" | "failed";

export const A2A_REVIEW_AFTER_MS = 15 * 60_000;
export const A2A_QUEUE_SLA_MS = 2 * 60_000;

export interface A2aResolutionEvidence {
  executionJournalVersion: 1 | null;
  paymentBoundaryCrossed: boolean;
  resultSaveBoundaryCrossed: boolean;
  creatorAttempts: number;
  settledCreatorMicros: number;
  pendingCreatorMicros: number;
  failedCreatorMicros: number;
  simulatedCreatorMicros: number;
  queryRunFound: boolean;
}

export interface A2aOrderResolution {
  action: "repair_completed" | "close_failed";
  actor: "automatic-poll" | "operator-cli";
  reason:
    | "saved_real_query_run"
    | "no_saved_run_before_execution_boundaries";
  evidence: A2aResolutionEvidence;
  resolvedAt: string;
}

export type A2aOrderResolutionUpdate =
  | {
      status: "completed";
      response: Record<string, unknown>;
      resolution: A2aOrderResolution;
    }
  | {
      status: "failed";
      errorCode: "operator_reviewed_no_result";
      /** The CAS accepts only jobs started at or before this timestamp. */
      startedBefore: string;
      resolution: A2aOrderResolution;
    };

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
  /** Versioned proof that creator payment calls are checkpointed before they can begin. */
  executionJournalVersion: 1 | null;
  /** Set durably before the first creator gateway call; null proves no call only for journal v1. */
  paymentStartedAt: string | null;
  /** Set before QueryRun persistence so operator close cannot race a late no-payment result. */
  resultSavingAt: string | null;
  response: Record<string, unknown> | null;
  errorCode: string | null;
  /** Private immutable evidence for an operator/automatic recovery transition. */
  resolution: A2aOrderResolution | null;
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
