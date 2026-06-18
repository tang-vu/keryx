"use client";

/**
 * Live payments feed table: time, kind (fetch/citation badge), source, amount,
 * settled? (Circle Gateway settlement ID — batched on-chain on Arc), payer → payee.
 * Settlement IDs are Circle UUIDs (not EVM tx hashes), so they are NOT linked to a
 * per-tx explorer page; on-chain proof is the batched settlement wallet, linked in the header.
 */

import { Check } from "lucide-react";
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

const EXPLORER = "https://testnet.arcscan.app";
// Gateway settlements are batched: many nanopayments → a few on-chain submitBatch txs from the
// settlement wallet. Per-payment Circle settlement IDs are UUIDs (they do NOT resolve as /tx/),
// so the verifiable on-chain link points at the settlement wallet's address page. Override with
// the real treasury wallet via NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET; defaults to Circle's Gateway
// settlement contract (always has on-chain batch activity).
const SETTLEMENT_WALLET =
  process.env.NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const SETTLEMENT_PROOF = `${EXPLORER}/address/${SETTLEMENT_WALLET}`;

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
        <div className="flex items-center gap-3">
          <a
            href={SETTLEMENT_PROOF}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-paid hover:underline"
            title="Settled via Circle Gateway batching — view the on-chain settlement wallet on ArcScan"
          >
            on-chain ↗
          </a>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-paid">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paid" />
            live
          </span>
        </div>
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
                      <span
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-paid"
                        title={`Circle Gateway settlement ID ${p.txHash} — batched on-chain on Arc (not a per-tx EVM hash)`}
                      >
                        <Check className="h-3 w-3" />
                        {shortHash(p.txHash)}
                      </span>
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
