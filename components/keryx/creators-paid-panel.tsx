"use client";

/**
 * §III · The settlement — fills in real time as `settle` steps stream. A
 * weighted split bar, a ledger of creator payouts (amount + Circle settlement ID / simulated),
 * a Bodoni green total. When the herald has paid in full, the wax "PAID" stamp
 * slams down over the receipt. Settlement IDs are Circle Gateway UUIDs (batched on-chain on Arc),
 * not per-tx EVM hashes — the verifiable on-chain link is the settlement wallet, in the footer.
 */

import { Check, CircleX, Clock3 } from "lucide-react";
import type { PaymentRecord } from "@/lib/types";
import {
  paymentCountsAsSpent,
  paymentSettlementStatus,
} from "@/lib/payments/payment-state";
import type { StreamMode } from "@/lib/hooks/use-ask-stream";
import { fmtUsdc, shortAddr } from "./phase-style";
import { SectionHeading } from "./banknote";
import { PaidStamp } from "./paid-stamp";

interface CreatorsPaidPanelProps {
  payments: PaymentRecord[];
  mode: StreamMode | null;
  streaming: boolean;
}

const EXPLORER = "https://testnet.arcscan.app";
// Per-payment Circle settlement IDs are UUIDs (they do NOT resolve as /tx/); on-chain proof is the
// batched settlement wallet. Override with the real treasury wallet via
// NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET; defaults to Circle's Gateway settlement contract.
const SETTLEMENT_WALLET =
  process.env.NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const SETTLEMENT_PROOF = `${EXPLORER}/address/${SETTLEMENT_WALLET}`;

export function CreatorsPaidPanel({
  payments,
  mode,
  streaming,
}: CreatorsPaidPanelProps) {
  const total = payments
    .filter(paymentCountsAsSpent)
    .reduce((sum, payment) => sum + (payment.amountUsdc ?? 0), 0);
  const hasPayments = payments.length > 0;
  const pendingCount = payments.filter(
    (payment) => paymentSettlementStatus(payment) === "pending",
  ).length;
  const failedCount = payments.filter(
    (payment) => paymentSettlementStatus(payment) === "failed",
  ).length;
  const paidInFull =
    hasPayments &&
    !streaming &&
    payments.every((payment) => paymentSettlementStatus(payment) === "settled");
  const pctOf = (p: PaymentRecord) =>
    typeof p.weight === "number"
      ? Math.round(p.weight * 100)
      : total > 0
        ? Math.round(((p.amountUsdc ?? 0) / total) * 100)
        : 0;

  return (
    <div className="relative flex h-full flex-col">
      <SectionHeading numeral="III" label="The settlement" right="weighted · USDC on Arc" />
      <div className="relative flex flex-1 flex-col overflow-hidden border border-ink bg-paper">
        {hasPayments && (
          <div className="flex h-7 border-b border-ink">
            {payments.map((p, i) => (
              <div
                key={p.id ?? `seg-${i}`}
                className="flex items-center justify-center overflow-hidden border-r border-paper font-mono text-[10px] text-cream last:border-r-0"
                style={{
                  flex: Math.max(p.amountUsdc ?? 0.0001, 0.0001),
                  background:
                    paymentSettlementStatus(p) === "failed"
                      ? "#b91c1c"
                      : paymentSettlementStatus(p) === "pending"
                      ? "#b45309"
                      : i % 2
                        ? "var(--paid-2)"
                        : "var(--paid)",
                }}
              >
                {pctOf(p)}%
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {!hasPayments && (
            <p className="px-2 py-10 text-center font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3">
              {streaming
                ? "Waiting on the herald to pay…"
                : "Payouts to cited creators appear here."}
            </p>
          )}
          {payments.map((p, i) => (
            <div
              key={p.id ?? `${p.payee}-${i}`}
              className="flex items-baseline gap-3 border-b border-line py-3 animate-in fade-in slide-in-from-right-2 duration-300"
            >
              <span className="w-4 shrink-0 font-display text-[13px] font-semibold text-paid">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-[15px] text-ink">
                  {p.sourceName}
                </p>
                <p className="font-mono text-[11px] text-ink-3">
                  {paymentSettlementStatus(p) === "settled" && p.txHash ? (
                    <span
                      className="inline-flex items-center gap-1 text-paid"
                      title={`Circle Gateway settlement ID ${p.txHash} — batched on-chain on Arc (not a per-tx EVM hash)`}
                    >
                      <Check className="h-2.5 w-2.5" />
                      batched
                    </span>
                  ) : paymentSettlementStatus(p) === "failed" ? (
                    <span className="inline-flex items-center gap-1 text-red-700">
                      <CircleX className="h-2.5 w-2.5" />
                      failed · not charged
                    </span>
                  ) : paymentSettlementStatus(p) === "pending" ? (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <Clock3 className="h-2.5 w-2.5" />
                      confirmation pending
                    </span>
                  ) : (
                    <span>{shortAddr(p.payee)} · simulated</span>
                  )}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-ink-3">
                {pctOf(p)}%
              </span>
              <span className="w-[68px] shrink-0 text-right font-mono text-sm tabular-nums text-paid">
                ${fmtUsdc(p.amountUsdc)}
                {paymentSettlementStatus(p) === "pending"
                  ? " ?"
                  : paymentSettlementStatus(p) === "failed"
                    ? " ×"
                    : ""}
              </span>
            </div>
          ))}
        </div>

        {hasPayments && (
          <div className="flex items-center justify-between gap-4 border-t border-ink px-5 py-3.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
              {pendingCount > 0 ? (
                `${pendingCount} pending · confirmed total`
              ) : failedCount > 0 ? (
                `${failedCount} failed · not charged`
              ) : mode === "real" ? (
                <a
                  href={SETTLEMENT_PROOF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-paid hover:underline"
                  title="Settled via Circle Gateway batching — view the on-chain settlement wallet on ArcScan"
                >
                  Settled · USDC on Arc ↗
                </a>
              ) : (
                "Offline — simulated"
              )}
            </span>
            <span className="letterpress font-display text-[30px] font-bold leading-none tracking-tight tabular-nums text-paid">
              ${fmtUsdc(total)}
            </span>
          </div>
        )}

        {paidInFull && (
          <PaidStamp className="absolute -bottom-5 -right-3 z-10 h-28 w-28" />
        )}
      </div>
    </div>
  );
}
