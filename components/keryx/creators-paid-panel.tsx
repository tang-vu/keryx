"use client";

/**
 * §III · The settlement — fills in real time as `settle` steps stream. Each row
 * is a creator payout with amount + tx hash (or "simulated" offline), under a
 * running total. When the herald has paid in full, the wax "PAID" stamp slams
 * down over the receipt — the emotional payoff: money moved, settled on Arc.
 */

import { ExternalLink } from "lucide-react";
import type { PaymentRecord } from "@/lib/types";
import type { StreamMode } from "@/lib/hooks/use-ask-stream";
import { fmtUsdc, shortAddr, shortHash } from "./phase-style";
import { PaidStamp } from "./paid-stamp";

interface CreatorsPaidPanelProps {
  payments: PaymentRecord[];
  mode: StreamMode | null;
  streaming: boolean;
}

const ARCSCAN = "https://testnet.arcscan.app/tx/";

export function CreatorsPaidPanel({
  payments,
  mode,
  streaming,
}: CreatorsPaidPanelProps) {
  const total = payments.reduce((sum, p) => sum + (p.amountUsdc ?? 0), 0);
  const hasPayments = payments.length > 0;
  const settled = hasPayments && !streaming;

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-md border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line-2 bg-paid/[0.06] px-5 py-3.5">
        <div className="flex items-baseline gap-2.5 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">
          <span className="text-seal">03</span>
          <span>The settlement</span>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-paid">
          ${fmtUsdc(total)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!hasPayments && (
          <p className="px-2 py-10 text-center font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3">
            {streaming
              ? "Waiting on the herald to pay…"
              : "Payouts to cited creators appear here."}
          </p>
        )}
        <ul>
          {payments.map((p, i) => (
            <li
              key={p.id ?? `${p.payee}-${i}`}
              className="flex items-center justify-between gap-3 border-t border-line-2 px-2.5 py-2.5 first:border-t-0 hover:bg-paid/[0.05] animate-in fade-in slide-in-from-right-2 duration-300"
            >
              <div className="min-w-0">
                <p className="truncate font-serif text-[15px] text-ink">
                  {p.sourceName}
                </p>
                <p className="font-mono text-[11px] text-ink-3">
                  {p.settled && p.txHash ? (
                    <a
                      href={`${ARCSCAN}${p.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-paid hover:underline"
                    >
                      {shortHash(p.txHash)}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  ) : (
                    <span>{shortAddr(p.payee)} · simulated</span>
                  )}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-paid/10 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-paid">
                +${fmtUsdc(p.amountUsdc)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {hasPayments && (
        <div className="border-t border-line-2 px-5 py-2.5 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {mode === "real"
            ? "Settled · USDC on Arc"
            : "Offline preview — payments simulated"}
        </div>
      )}

      {settled && (
        <PaidStamp className="absolute -bottom-5 -right-3 z-10 h-28 w-28" />
      )}
    </div>
  );
}
