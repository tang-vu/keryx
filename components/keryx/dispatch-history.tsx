"use client";
import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";

import { DisplayTime } from "@/components/keryx/display-time";


/**
 * Recent dispatches panel — shows the last N queries on the dashboard.
 * Each row links to the dispatch permalink. Shows question, spend,
 * citation count, and relative time.
 */

import { createRichMessages } from "@/lib/i18n/rich-messages";
import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const copy = createMessages("en");

export interface RunSummary {
  id: string;
  question: string;
  createdAt: string;
  totalSpent: number;
  totalToCreators: number;
  citationCount: number;
  archive?: { network: string; capturedAt: string };
}

function timeAgo(iso: string) {
  return <DisplayTime value={iso} relative />;
}

export function DispatchHistory({ runs, title = copy("dispatchHistory.title"), showFinancials = true }: { runs: RunSummary[]; title?: string; showFinancials?: boolean }) {
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
            {copy("dispatchHistory.empty")}
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
                {showFinancials ? createRichMessages("en")(r.archive ? selectPlural(r.citationCount) === "one" ? "dispatchHistory.summary.historical.financial.one" : "dispatchHistory.summary.historical.financial.other" : selectPlural(r.citationCount) === "one" ? "dispatchHistory.summary.current.financial.one" : "dispatchHistory.summary.current.financial.other", { time: timeAgo(r.createdAt), count: r.citationCount, amount: formatRecordedUsdc(r.totalToCreators) }) : createRichMessages("en")(r.archive ? selectPlural(r.citationCount) === "one" ? "dispatchHistory.summary.historical.plain.one" : "dispatchHistory.summary.historical.plain.other" : selectPlural(r.citationCount) === "one" ? "dispatchHistory.summary.current.plain.one" : "dispatchHistory.summary.current.plain.other", { time: timeAgo(r.createdAt), count: r.citationCount })}
              </p>
            </div>
            {showFinancials && <span className="shrink-0 font-mono text-[12px] tabular-nums text-paid">
              {formatRecordedUsdc(r.totalSpent)}
            </span>}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
