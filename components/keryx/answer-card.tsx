"use client";

/**
 * Final answer card: rendered markdown with [S#] citation chips, a sources
 * legend, and a summary strip (spent / % to creators / bought·skipped /
 * engine + mode).
 */

import { useState } from "react";
import { Sparkles, Quote } from "lucide-react";
import type { QueryRun } from "@/lib/types";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import { AnswerMarkdown } from "./answer-markdown";
import { ModeBadge } from "./mode-badge";
import { fmtUsdc } from "./phase-style";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AnswerCard({ run, meta }: { run: QueryRun; meta: AskMeta | null }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const bought = run.decisions.filter((d) => d.action === "BUY").length;
  const skipped = run.decisions.filter((d) => d.action === "SKIP").length;
  const cached = run.decisions.filter((d) => d.action === "CACHE").length;

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-3 duration-500 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-amber-500/[0.08] to-transparent px-5 py-3">
        <Sparkles className="h-4 w-4 text-amber-600" />
        <span className="text-sm font-semibold tracking-tight">Grounded answer</span>
      </div>

      <div className="px-5 py-5">
        <AnswerMarkdown
          text={run.answer}
          citations={run.citations}
          onCitationClick={setHighlight}
        />

        {run.citations.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Quote className="h-3 w-3" /> Sources & rewards
            </p>
            <ul className="space-y-1.5">
              {run.citations.map((c) => (
                <li
                  key={c.marker}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    highlight === c.marker
                      ? "bg-amber-500/10 ring-1 ring-amber-500/30"
                      : "hover:bg-muted/50",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-700">
                      {c.marker}
                    </span>
                    <span className="truncate font-medium text-foreground">
                      {c.sourceName}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {Math.round(c.weight * 100)}%
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                    +${fmtUsdc(c.reward)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <SummaryStrip
        spent={run.totalSpent}
        toCreators={run.totalToCreators}
        bought={bought}
        skipped={skipped}
        cached={cached}
        engine={run.engine}
        meta={meta}
      />
    </Card>
  );
}

interface SummaryStripProps {
  spent: number;
  toCreators: number;
  bought: number;
  skipped: number;
  cached: number;
  engine: string;
  meta: AskMeta | null;
}

function SummaryStrip({
  spent,
  toCreators,
  bought,
  skipped,
  cached,
  engine,
  meta,
}: SummaryStripProps) {
  const pct = spent > 0 ? Math.round((toCreators / spent) * 100) : 100;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-muted/30 px-5 py-3 text-sm">
      <Stat label="Spent" value={`$${fmtUsdc(spent)}`} mono />
      <Stat label="To creators" value={`${pct}%`} accent />
      <Stat
        label="Decisions"
        value={`${bought} bought · ${cached} cached · ${skipped} skipped`}
      />
      <div className="ml-auto flex items-center gap-2">
        <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {engine}
        </span>
        <ModeBadge mode={meta?.mode ?? null} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          mono && "font-mono",
          accent && "text-emerald-700",
        )}
      >
        {value}
      </span>
    </div>
  );
}
