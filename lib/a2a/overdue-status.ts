import type { PaymentRecord } from "../types";
import { assertPaymentSettlementState } from "../payments/payment-state";
import type { A2aOrder } from "./order";
import { isSupportedA2aResearchPackage } from "./research-package";
import type { PaidJobEscalation } from "./overdue-types";

/** RFC3339 storage forms; round fractional microseconds upward to avoid an early target alert. */
function recordedTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return time + (/[1-9]/.test((parts[7] ?? "").slice(3)) ? 1 : 0);
}
function subMillisecondTime(value: string | null): boolean {
  return typeof value === "string" && /\.\d{3}\d*[1-9]\d*(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}
function observedTime(nowMs: number): number | null {
  if (!Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) return null;
  return /^\d{4}-/.test(new Date(nowMs).toISOString()) ? nowMs : null;
}
function exactMicros(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const parts = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!parts) return null;
  const micros = BigInt(parts[1]) * 1_000_000n + BigInt((parts[2] ?? "").padEnd(6, "0"));
  return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
}
function recordedNetwork(order: A2aOrder) {
  const network = order.request?.network;
  return network === "eip155:5042" || network === "eip155:5042002" ? network : null;
}

/** Derive observation only. Original acceptance is the clock; updates/repair never restart it. */
export function paidJobEscalation(order: A2aOrder, nowMs: number, attempts: PaymentRecord[] | null = null): PaidJobEscalation {
  const now = observedTime(nowMs), accepted = recordedTime(order.createdAt);
  let target: number | null = null;
  try {
    if (isSupportedA2aResearchPackage(order.researchPackage, order.researchMode)) target = order.researchPackage.serviceLevel.targetCompletionMs;
  } catch { /* Malformed historical package has no asserted target. */ }
  const deadline = accepted === null || target === null ? null : accepted + target;
  const clockKnown = now !== null && accepted !== null && now >= accepted && deadline !== null && Number.isFinite(new Date(deadline).getTime());
  const state = !clockKnown ? "unavailable" : order.status === "completed" ? "completed" : now > deadline ? "overdue" : "within_target";
  const updated = recordedTime(order.updatedAt), started = recordedTime(order.startedAt);
  const chronologyKnown = clockKnown && updated !== null && updated >= accepted && updated <= now &&
    (order.startedAt === null || (started !== null && started >= accepted && started <= updated));
  const paymentAt = recordedTime(order.paymentStartedAt), savingAt = recordedTime(order.resultSavingAt);
  const checkpointsKnown = chronologyKnown && order.executionJournalVersion === 1 &&
    ![order.createdAt, order.updatedAt, order.startedAt, order.paymentStartedAt, order.resultSavingAt].some(subMillisecondTime) &&
    (order.paymentStartedAt === null || (started !== null && paymentAt !== null && paymentAt >= started && paymentAt <= updated)) &&
    (order.resultSavingAt === null || (started !== null && savingAt !== null && savingAt >= started && savingAt <= updated && (paymentAt === null || savingAt >= paymentAt)));
  const lastRecordedStage = !checkpointsKnown ? "unknown" : savingAt !== null ? "result_save_boundary" : paymentAt !== null
    ? "creator_payment_boundary" : started !== null ? "research_started" : "queued";
  const failureCode = order.status !== "failed" ? null :
    order.errorCode === "research_failed" || order.errorCode === "invalid_order_data" || order.errorCode === "operator_reviewed_no_result" ? order.errorCode : "unknown";
  return {
    state, escalationNeeded: state === "unavailable" ? null : state === "overdue",
    observedAt: now === null ? null : new Date(now).toISOString(),
    acceptedAt: accepted === null ? null : new Date(accepted).toISOString(),
    targetCompletionAt: clockKnown ? new Date(deadline).toISOString() : null,
    targetCompletionMs: target, elapsedMs: clockKnown ? now - accepted : null,
    lastRecordedStage, failureCode,
    creatorPaymentState: creatorPaymentState(order, attempts, checkpointsKnown, now),
    evaluation: "on_observation", objectiveKind: "provisional_slo", remedy: "none",
  };
}

function creatorPaymentState(order: A2aOrder, attempts: PaymentRecord[] | null, checkpointsKnown: boolean, now: number | null): PaidJobEscalation["creatorPaymentState"] {
  if (!checkpointsKnown) return "unknown";
  const network = recordedNetwork(order), cap = exactMicros(order.creatorBudgetUsdc);
  if (attempts !== null) {
    let total = 0, pending = false;
    const identifiers = new Set<string>(), boundary = recordedTime(order.paymentStartedAt);
    for (const attempt of attempts) {
      const micros = exactMicros(attempt.amountUsdc);
      const created = recordedTime(attempt.createdAt);
      if ((attempt.kind !== "fetch" && attempt.kind !== "citation") || attempt.queryId !== order.queryId ||
        order.id !== order.queryId || network === null || attempt.network !== network || micros === null || cap === null ||
        typeof attempt.payer !== "string" || typeof order.payee !== "string" || attempt.payer.toLowerCase() !== order.payee.toLowerCase() ||
        typeof attempt.id !== "string" || !attempt.id || identifiers.has(attempt.id) || created === null || now === null ||
        boundary === null || created < boundary || created > now || subMillisecondTime(attempt.createdAt)) return "unknown";
      identifiers.add(attempt.id);
      total += micros;
      if (!Number.isSafeInteger(total) || total > cap) return "unknown";
      try {
        const status = assertPaymentSettlementState(attempt);
        if (status === "simulated") return "unknown";
        pending ||= status === "pending";
      } catch { return "unknown"; }
    }
    if (attempts.length && order.paymentStartedAt === null) return "unknown";
    if (pending) return "pending_recorded";
  }
  // Definitive recorded legs cannot prove that another unrecorded call never crossed this boundary.
  return order.paymentStartedAt !== null ? "payment_boundary_crossed" : "no_creator_call_recorded";
}

/** Allowlist retained owner references; never export authorization nonce, worker, input or raw errors. */
export function originalOrderPayment(order: A2aOrder) {
  const amount = exactMicros(order.amountUsdc);
  return {
    kind: order.request?.monthlyId ? "monthly_allocation" as const : "inbound_payment" as const,
    reference: typeof order.transaction === "string" && /^[A-Za-z0-9:_-]{1,256}$/.test(order.transaction) ? order.transaction : null,
    network: recordedNetwork(order), asset: "USDC" as const,
    amountMicros: amount === null ? null : String(amount),
  };
}
