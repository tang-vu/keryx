"use client";

/**
 * "Creators Paid" — fills in real time as `settle` steps stream. Each row is a
 * source/author payout with amount + tx short hash (or "simulated" offline).
 * Shows a running total. The emotional payoff of the demo: money moving.
 */

import { Coins, ExternalLink } from "lucide-react";
import type { PaymentRecord } from "@/lib/types";
import type { StreamMode } from "@/lib/hooks/use-ask-stream";
import { fmtUsdc, shortAddr, shortHash } from "./phase-style";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-emerald-500/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold tracking-tight">
            Creators paid
          </span>
        </div>
        <span className="font-mono text-sm font-semibold text-emerald-700 tabular-nums">
          ${fmtUsdc(total)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!hasPayments && (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {streaming
              ? "Waiting for the agent to settle rewards…"
              : "Payouts to cited creators appear here."}
          </p>
        )}
        <ul className="space-y-1">
          {payments.map((p, i) => (
            <li
              key={p.id ?? `${p.payee}-${i}`}
              className="animate-in fade-in slide-in-from-right-2 duration-300 flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {p.sourceName}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {p.settled && p.txHash ? (
                    <a
                      href={`${ARCSCAN}${p.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                    >
                      {shortHash(p.txHash)}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  ) : (
                    <span>{shortAddr(p.payee)} · simulated</span>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold tabular-nums",
                  "bg-emerald-500/10 text-emerald-700",
                )}
              >
                +${fmtUsdc(p.amountUsdc)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {hasPayments && (
        <div className="border-t border-border px-4 py-2.5 text-center text-[11px] text-muted-foreground">
          {mode === "real"
            ? "Settled on Arc testnet"
            : "Offline preview — payments simulated"}
        </div>
      )}
    </Card>
  );
}
