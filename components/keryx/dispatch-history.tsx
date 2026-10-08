"use client";

/**
 * Recent dispatches panel — shows the last N queries on the dashboard.
 * Each row links to the dispatch permalink. Shows question, spend,
 * citation count, and relative time.
 */

import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtUsdc } from "./phase-style";

export interface RunSummary {
  id: string;
  question: string;
  createdAt: string;
  totalSpent: number;
  totalToCreators: number;
  citationCount: number;
  archive?: { network: string; capturedAt: string };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function DispatchHistory({ runs, title = "Recent dispatches", showFinancials = true }: { runs: RunSummary[]; title?: string; showFinancials?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-4">
        <History className="h-4 w-4 text-seal" />
        <CardTitle className="font-serif text-lg font-normal">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {runs.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No dispatches yet.
          </p>
        )}
        {runs.map((r) => (
          <Link
            key={r.id}
            href={`/dispatch/${encodeURIComponent(r.id)}`}
            className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 transition-colors hover:bg-paper-2"
          >
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-serif text-[14px] leading-relaxed text-ink">
                {r.question}
              </p>
              <p className="font-mono text-[10px] text-ink-3">
                {timeAgo(r.createdAt)} · {r.citationCount} citation{r.citationCount === 1 ? "" : "s"}
                {r.archive && " · Arc testnet history"}
                {showFinancials && <> · ${fmtUsdc(r.totalToCreators)} to creators</>}
              </p>
            </div>
            {showFinancials && <span className="shrink-0 font-mono text-[12px] tabular-nums text-paid">
              ${fmtUsdc(r.totalSpent)}
            </span>}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
