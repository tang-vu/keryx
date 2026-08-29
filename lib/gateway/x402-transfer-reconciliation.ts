import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
import {
  isAcknowledgedLegacyTreasuryPending,
  type PendingReconciliationAcknowledgement,
} from "./pending-reconciliation-acknowledgement";

export const PENDING_RECONCILIATION_STATE_KEY = "pendingPaymentReconciliation";
export const CIRCLE_X402_TRANSFERS_URL =
  "https://gateway-api-testnet.circle.com/v1/x402/transfers";

const TRANSFER_SEARCH_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const TRANSFER_SEARCH_PAGE_SIZE = 50;
const TRANSFER_SEARCH_MAX_PAGES = 20;

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
  /** Awaiting legacy treasury attempts explicitly risk-accepted without changing payment state. */
  acknowledgedAwaiting: number;
  /** Awaiting rows that still participate in stale/critical health escalation. */
  unacknowledgedAwaiting: number;
  /** Unresolved browser-funded rows whose session reservation remains held. */
  browserAwaiting: number;
  /** Unresolved server-treasury rows; these do not consume browser grant capacity. */
  treasuryAwaiting: number;
  /** Unresolved rows whose exact signed validBefore has passed. Not failure evidence. */
  expiredAwaiting: number;
  /** Legacy or malformed unresolved rows without an exact signed validity boundary. */
  unknownExpiryAwaiting: number;
  /** Earliest exact signed validity boundary among unresolved rows. */
  earliestAuthorizationExpiresAt: string | null;
  /** Pending rows closed from exact Circle `failed` evidence. */
  failed: number;
  /** Browser cap reservations released against the same still-active grant generation. */
  releasedReservations: number;
  mismatched: number;
  raced: number;
  oldestPendingAt: string | null;
  oldestUnacknowledgedPendingAt: string | null;
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
  const createdAt = Date.parse(payment.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw new Error("pending payment has an invalid creation time");
  }

  // Circle's documented search filters do not include the authorization nonce. Bound the result
  // set from shortly before the local submission, then follow every cursor and independently bind
  // the nonce plus the full economic tuple below. There is deliberately no endDate: a bearer
  // authorization can be submitted after Keryx recorded the ambiguous response. A nonce query
  // parameter is silently ignored by the current API; relying on it and reading only page one can
  // strand an older authorization once newer payments between the same wallets push it beyond the
  // default page.
  const baseUrl = new URL(CIRCLE_X402_TRANSFERS_URL);
  baseUrl.searchParams.set("from", payment.payer);
  baseUrl.searchParams.set("to", payment.payee);
  baseUrl.searchParams.set("network", payment.network);
  baseUrl.searchParams.set("token", "USDC");
  baseUrl.searchParams.set(
    "startDate",
    new Date(createdAt - TRANSFER_SEARCH_LOOKBACK_MS).toISOString(),
  );
  baseUrl.searchParams.set("pageSize", String(TRANSFER_SEARCH_PAGE_SIZE));

  const transfers: CircleX402Transfer[] = [];
  let pageAfter: string | null = null;
  for (let page = 0; page < TRANSFER_SEARCH_MAX_PAGES; page++) {
    const url = new URL(baseUrl);
    if (pageAfter) url.searchParams.set("pageAfter", pageAfter);
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
    transfers.push(...body.transfers);

    pageAfter = nextPageCursor(response.headers.get("Link"));
    if (!pageAfter) return transfers;
  }

  throw new Error(
    `Circle x402 transfer search exceeded ${TRANSFER_SEARCH_MAX_PAGES} pages`,
  );
}

function nextPageCursor(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/^\s*<([^>]+)>\s*;\s*rel="next"\s*$/i);
    if (!match) continue;
    let next: URL;
    try {
      next = new URL(match[1]);
    } catch {
      throw new Error("Circle x402 transfer search returned an invalid next-page link");
    }
    const expected = new URL(CIRCLE_X402_TRANSFERS_URL);
    if (next.origin !== expected.origin || next.pathname !== expected.pathname) {
      throw new Error("Circle x402 transfer search returned an untrusted next-page link");
    }
    const cursor = next.searchParams.get("pageAfter");
    if (!cursor) {
      throw new Error("Circle x402 transfer search next-page link omitted its cursor");
    }
    return cursor;
  }
  return null;
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
  options: {
    limit?: number;
    search?: TransferSearch;
    signal?: AbortSignal;
    acknowledgements?: PendingReconciliationAcknowledgement[];
    treasuryPayer?: string | null;
  } = {},
): Promise<PendingReconciliationSummary> {
  const pending = await db.listPendingPayments(options.limit ?? 100);
  const summary: PendingReconciliationSummary = {
    checkedAt: new Date().toISOString(),
    scanned: pending.length,
    promoted: 0,
    awaiting: 0,
    acknowledgedAwaiting: 0,
    unacknowledgedAwaiting: 0,
    browserAwaiting: 0,
    treasuryAwaiting: 0,
    expiredAwaiting: 0,
    unknownExpiryAwaiting: 0,
    earliestAuthorizationExpiresAt: null,
    failed: 0,
    releasedReservations: 0,
    mismatched: 0,
    raced: 0,
    oldestPendingAt: pending[0]?.createdAt ?? null,
    oldestUnacknowledgedPendingAt: null,
  };
  const search = options.search ?? searchCircleTransfer;

  for (const payment of pending) {
    if (options.signal?.aborted) throw options.signal.reason;
    const check = checkPendingTransfer(
      payment,
      await search(payment, options.signal),
    );
    if (check.verdict === "awaiting") {
      summary.awaiting++;
      if (
        isAcknowledgedLegacyTreasuryPending(
          payment,
          options.acknowledgements ?? [],
          options.treasuryPayer,
          Date.parse(summary.checkedAt),
        )
      ) {
        summary.acknowledgedAwaiting++;
      } else {
        summary.unacknowledgedAwaiting++;
        if (summary.oldestUnacknowledgedPendingAt === null) {
          summary.oldestUnacknowledgedPendingAt = payment.createdAt;
        }
      }
      if (payment.grantEpoch) summary.browserAwaiting++;
      else summary.treasuryAwaiting++;
      const expiry = payment.authorizationExpiresAt
        ? Date.parse(payment.authorizationExpiresAt)
        : Number.NaN;
      if (!Number.isFinite(expiry)) {
        summary.unknownExpiryAwaiting++;
      } else {
        if (expiry <= Date.parse(summary.checkedAt)) summary.expiredAwaiting++;
        if (
          summary.earliestAuthorizationExpiresAt === null ||
          expiry < Date.parse(summary.earliestAuthorizationExpiresAt)
        ) {
          summary.earliestAuthorizationExpiresAt = new Date(expiry).toISOString();
        }
      }
    }
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
