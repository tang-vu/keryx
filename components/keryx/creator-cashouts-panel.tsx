"use client";

/**
 * Creator cash-outs panel: creators pulling accrued Gateway earnings on-chain via Gateway withdraw.
 * The point of this panel — unlike the payments feed, whose Circle settlement IDs are batched UUIDs
 * that do NOT open at /tx/ — every row here links a REAL EVM mint hash that resolves on ArcScan. It
 * is the dashboard's hard per-tx on-chain proof that the rewards are real, withdrawable USDC.
 */

import { ArrowUpRight } from "lucide-react";
import type { WithdrawalRecord } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtUsdc, shortAddr } from "./phase-style";

const EXPLORER = "https://testnet.arcscan.app";

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

export function CreatorCashoutsPanel({ withdrawals }: { withdrawals: WithdrawalRecord[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="font-serif text-lg font-normal">Creator cash-outs</CardTitle>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-paid">
          <span className="h-1.5 w-1.5 rounded-full bg-paid" />
          on-chain
        </span>
      </CardHeader>
      <CardContent className="px-0">
        <p className="px-6 pb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Creators minting earned USDC out of Circle Gateway to their own wallet. Each row is a real
          EVM tx that opens at <span className="text-ink-2">/tx/</span> on ArcScan — the per-tx proof
          the batched settlement IDs above can&apos;t give.
        </p>
        {withdrawals.length === 0 ? (
          <p className="px-6 py-6 text-center font-mono text-[11px] text-muted-foreground">
            No cash-outs yet. They appear here the moment a creator withdraws.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6 font-mono text-[10px] uppercase tracking-[0.1em]">
                  When
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.1em]">
                  Creator
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                  Amount
                </TableHead>
                <TableHead className="pr-6 text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                  On-chain
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withdrawals.map((w) => (
                <TableRow key={w.txHash}>
                  <TableCell className="pl-6 font-mono text-[11px] text-muted-foreground">
                    {timeAgo(w.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm" title={w.sourceName ?? w.label}>
                    {w.sourceName ?? w.label}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] text-paid">
                    ${fmtUsdc(w.amountUsdc)}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <a
                      href={`${EXPLORER}/tx/${w.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-paid hover:underline"
                      title={`View the on-chain mint tx for $${fmtUsdc(w.amountUsdc)} → ${w.recipient}`}
                    >
                      {shortAddr(w.txHash)}
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
