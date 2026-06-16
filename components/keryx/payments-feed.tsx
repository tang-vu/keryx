"use client";

/**
 * Live payments feed table: time, kind (fetch/citation badge), source, amount,
 * settled? (tx short hash → arcscan), payer → payee (mono short addresses).
 */

import { ExternalLink } from "lucide-react";
import type { PaymentRecord } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtUsdc, shortAddr, shortHash } from "./phase-style";
import { cn } from "@/lib/utils";

const ARCSCAN = "https://testnet.arcscan.app/tx/";

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function PaymentsFeed({ payments }: { payments: PaymentRecord[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="font-serif text-lg font-normal">
          Live payments feed
        </CardTitle>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-paid">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paid" />
          live
        </span>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Flow</TableHead>
                <TableHead className="pr-6">Settled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No payments yet — run a query on the Ask page.
                  </TableCell>
                </TableRow>
              )}
              {payments.map((p, i) => (
                <TableRow key={p.id ?? `${p.payee}-${i}`}>
                  <TableCell className="pl-6 font-mono text-xs text-muted-foreground">
                    {timeAgo(p.createdAt)}
                  </TableCell>
                  <TableCell>
                    <KindBadge kind={p.kind} />
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm font-medium">
                    {p.sourceName}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums text-paid">
                    ${fmtUsdc(p.amountUsdc)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {shortAddr(p.payer)} → {shortAddr(p.payee)}
                  </TableCell>
                  <TableCell className="pr-6">
                    {p.settled && p.txHash ? (
                      <a
                        href={`${ARCSCAN}${p.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-paid hover:underline"
                      >
                        {shortHash(p.txHash)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        simulated
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function KindBadge({ kind }: { kind: PaymentRecord["kind"] }) {
  const citation = kind === "citation";
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
        citation
          ? "border-seal/30 bg-seal/10 text-seal"
          : "border-ink-3/40 bg-paper-2 text-ink-2",
      )}
    >
      {kind}
    </span>
  );
}
