"use client";

/**
 * Creator leaderboard. Rank, source name, total earned, citations, payments.
 * Top earner highlighted with a gold crown.
 */

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
        <Trophy className="h-4 w-4 text-amber-600" />
        <CardTitle className="text-base">Creator leaderboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No creator earnings yet.
          </p>
        )}
        {rows.map((row, i) => (
          <div
            key={row.sourceId}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
              i === 0
                ? "border-amber-500/30 bg-amber-500/[0.06]"
                : "border-border hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                i === 0
                  ? "bg-amber-500 text-amber-950"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i === 0 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {row.sourceName}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {shortAddr(row.walletAddress)} · {row.citationCount} cites ·{" "}
                {row.paymentCount} pmts
              </p>
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-emerald-700">
              ${fmtUsdc(row.totalEarnedUsdc)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
