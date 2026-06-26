"use client";

/**
 * Creator leaderboard. Rank, source name, total earned, citations, payments.
 * Top earner highlighted with a gold crown. Rows link to /creator/[id] for
 * per-creator earnings detail.
 */

import Link from "next/link";
import { Crown, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtUsdc, shortAddr } from "./phase-style";
import { cn } from "@/lib/utils";

export interface LeaderboardEntry {
  sourceId: string;
  sourceName: string;
  walletAddress: string;
  totalEarnedUsdc: number;
  paymentCount: number;
  citationCount: number;
}

export function CreatorLeaderboard({ rows }: { rows: LeaderboardEntry[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-4">
        <Trophy className="h-4 w-4 text-seal" />
        <CardTitle className="font-serif text-lg font-normal">
          Creator leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No creator earnings yet.
          </p>
        )}
        {rows.map((row, i) => (
          <Link
            key={row.sourceId}
            href={`/creator/${row.sourceId}`}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
              i === 0
                ? "border-seal/30 bg-seal/[0.06] hover:bg-seal/[0.1]"
                : "border-line hover:bg-paper-2",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold",
                i === 0 ? "bg-seal text-cream" : "bg-paper-2 text-ink-3",
              )}
            >
              {i === 0 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-[15px] text-ink">
                {row.sourceName}
              </p>
              <p className="font-mono text-[11px] text-ink-3">
                {shortAddr(row.walletAddress)} · {row.citationCount} cites ·{" "}
                {row.paymentCount} pmts
              </p>
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-paid">
              ${fmtUsdc(row.totalEarnedUsdc)}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
