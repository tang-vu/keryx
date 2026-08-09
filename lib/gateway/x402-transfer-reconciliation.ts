import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";

export const PENDING_RECONCILIATION_STATE_KEY = "pendingPaymentReconciliation";
export const CIRCLE_X402_TRANSFERS_URL =
  "https://gateway-api-testnet.circle.com/v1/x402/transfers";

const ACCEPTED_STATUSES = new Set(["received", "batched", "confirmed", "completed"]);

export interface CircleX402Transfer {
  id: string;
  status: "received" | "batched" | "confirmed" | "completed" | "failed";
  token: string;
  sendingNetwork: string;
  recipientNetwork: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  nonce: string;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PendingTransferVerdict =
  | "settled"
  | "awaiting"
  | "failed"
  | "mismatch";

export interface PendingTransferCheck {
  verdict: PendingTransferVerdict;
  transfer?: CircleX402Transfer;
  reason: string;
}

export interface PendingReconciliationSummary {
  checkedAt: string;
  scanned: number;
  promoted: number;
  awaiting: number;
  /** Pending rows closed from exact Circle `failed` evidence. */
  failed: number;
  /** Browser cap reservations released against the same still-active grant generation. */
  releasedReservations: number;
  mismatched: number;
  raced: number;
  oldestPendingAt: string | null;
}

type TransferSearch = (
  payment: PaymentRecord,
  signal?: AbortSignal,
) => Promise<CircleX402Transfer[]>;

function canonicalHex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, "");
}

function canonicalAddress(value: string): string {
  return value.trim().toLowerCase();
}

function atomicUsdc(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const atomic = Math.round(amount * 1_000_000);
  if (Math.abs(amount - atomic / 1_000_000) > 1e-10) return null;
  return String(atomic);
}

function isCircleTransfer(value: unknown): value is CircleX402Transfer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return [
    "id",
    "status",
    "token",
    "sendingNetwork",
    "recipientNetwork",
    "fromAddress",
    "toAddress",
    "amount",
    "nonce",
    "createdAt",
    "updatedAt",
  ].every((key) => typeof row[key] === "string");
}

/**
 * Search Circle by nonce, then independently bind every payment-critical field. Query filters are
 * an optimisation, never proof: a response with the right nonce but a different economic tuple
 * must not turn a Keryx ledger row into settled traction.
 */
export async function searchCircleTransfer(
  payment: PaymentRecord,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CircleX402Transfer[]> {
  if (!payment.authorizationId) return [];
  const url = new URL(CIRCLE_X402_TRANSFERS_URL);
  url.searchParams.set("from", payment.payer);
  url.searchParams.set("to", payment.payee);
  url.searchParams.set("network", payment.network);
  url.searchParams.set("nonce", payment.authorizationId);
  url.searchParams.set("pageSize", "10");

  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Circle x402 transfer search returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { transfers?: unknown };
  if (!Array.isArray(body.transfers) || !body.transfers.every(isCircleTransfer)) {
    throw new Error("Circle x402 transfer search returned an invalid response");
  }
  return body.transfers;
}

export function checkPendingTransfer(
  payment: PaymentRecord,
  transfers: CircleX402Transfer[],
): PendingTransferCheck {
  if (
    payment.settled ||
    payment.settlementStatus !== "pending" ||
    !payment.authorizationId
  ) {
    return { verdict: "mismatch", reason: "ledger row is not a reconcilable pending authorization" };
  }
  const amount = atomicUsdc(payment.amountUsdc);
  if (!amount) return { verdict: "mismatch", reason: "ledger amount is not exact micro-USDC" };

  const nonceMatches = transfers.filter(
    (transfer) => canonicalHex(transfer.nonce) === canonicalHex(payment.authorizationId!),
  );
  if (nonceMatches.length === 0) {
    return { verdict: "awaiting", reason: "Circle has no transfer for this authorization yet" };
  }

  const exact = nonceMatches.filter(
    (transfer) =>
      transfer.token.toUpperCase() === "USDC" &&
      transfer.sendingNetwork === payment.network &&
      transfer.recipientNetwork === payment.network &&
      canonicalAddress(transfer.fromAddress) === canonicalAddress(payment.payer) &&
      canonicalAddress(transfer.toAddress) === canonicalAddress(payment.payee) &&
      transfer.amount === amount,
  );
  if (exact.length !== 1) {
    return {
      verdict: "mismatch",
      reason:
        exact.length > 1
          ? "Circle returned duplicate exact transfers for one authorization"
          : "Circle transfer does not match payer, payee, network, token, and amount",
    };
  }

  const transfer = exact[0];
  if (transfer.status === "failed") {
    return { verdict: "failed", transfer, reason: "Circle marks the transfer failed" };
  }
  if (!ACCEPTED_STATUSES.has(transfer.status)) {
    return { verdict: "mismatch", transfer, reason: `unknown Circle status ${transfer.status}` };
  }
  return {
    verdict: "settled",
    transfer,
    reason: `Circle accepted transfer ${transfer.id} (${transfer.status})`,
  };
}

/** Reconcile oldest-first so a fixed scan limit cannot starve long-lived ambiguous rows. */
export async function reconcilePendingPayments(
  db: Pick<
    KeryxDB,
    "listPendingPayments" | "settlePendingPayment" | "failPendingPayment" | "setSyncState"
  >,
  options: { limit?: number; search?: TransferSearch; signal?: AbortSignal } = {},
): Promise<PendingReconciliationSummary> {
  const pending = await db.listPendingPayments(options.limit ?? 100);
  const summary: PendingReconciliationSummary = {
    checkedAt: new Date().toISOString(),
    scanned: pending.length,
    promoted: 0,
    awaiting: 0,
    failed: 0,
    releasedReservations: 0,
    mismatched: 0,
    raced: 0,
    oldestPendingAt: pending[0]?.createdAt ?? null,
  };
  const search = options.search ?? searchCircleTransfer;

  for (const payment of pending) {
    if (options.signal?.aborted) throw options.signal.reason;
    const check = checkPendingTransfer(
      payment,
      await search(payment, options.signal),
    );
    if (check.verdict === "awaiting") summary.awaiting++;
    if (check.verdict === "mismatch") summary.mismatched++;
    if (!check.transfer || !payment.id || !payment.authorizationId) {
      continue;
    }
    if (check.verdict === "settled") {
      const promoted = await db.settlePendingPayment(
        payment.id,
        payment.authorizationId,
        check.transfer.id,
      );
      if (promoted) summary.promoted++;
      else summary.raced++;
    } else if (check.verdict === "failed") {
      const failed = await db.failPendingPayment(
        payment.id,
        payment.authorizationId,
        check.transfer.id,
      );
      if (failed.resolved) {
        summary.failed++;
        if (failed.reservationReleased) summary.releasedReservations++;
      } else {
        summary.raced++;
      }
    }
  }

  await db.setSyncState(PENDING_RECONCILIATION_STATE_KEY, JSON.stringify(summary));
  return summary;
}
