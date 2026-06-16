"use client";

/**
 * §II · The reading — the grounded answer rendered as a printed page: serif
 * body with footnote citation markers, a footnotes apparatus where each one
 * pays its author, and a settlement strip (spent / % to creators / decisions /
 * engine + mode).
 */

import { useState } from "react";
import type { QueryRun } from "@/lib/types";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import { AnswerMarkdown } from "./answer-markdown";
import { ModeBadge } from "./mode-badge";
import { fmtUsdc } from "./phase-style";
import { cn } from "@/lib/utils";

export function AnswerCard({ run, meta }: { run: QueryRun; meta: AskMeta | null }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const bought = run.decisions.filter((d) => d.action === "BUY").length;
  const skipped = run.decisions.filter((d) => d.action === "SKIP").length;
  const cached = run.decisions.filter((d) => d.action === "CACHE").length;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-card animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="flex items-center justify-between gap-3 border-b border-line-2 px-5 py-3.5">
        <div className="flex items-baseline gap-2.5 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">
          <span className="text-seal">02</span>
          <span>The reading</span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {run.citations.length} cited
        </span>
      </div>

      <div className="px-6 py-6 sm:px-8">
        <div className="max-w-[62ch]">
          <AnswerMarkdown
            text={run.answer}
            citations={run.citations}
            onCitationClick={setHighlight}
          />
        </div>

        {run.citations.length > 0 && (
          <div className="mt-7 border-t border-line pt-5">
            <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
              Footnotes — each one pays its author
            </p>
            <ul>
              {run.citations.map((c) => (
                <li
                  key={c.marker}
                  className={cn(
                    "flex items-center gap-3 border-b border-line-2 py-2.5 transition-colors",
                    highlight === c.marker && "bg-seal/[0.06]",
                  )}
                >
                  <span className="w-5 shrink-0 font-serif text-[13px] font-semibold text-paid">
                    {c.marker.replace(/\D/g, "") || c.marker}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-ink">
                    {c.sourceName}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">
                    {Math.round(c.weight * 100)}%
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-sm tabular-nums text-paid">
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
    </div>
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-paper-2 px-5 py-3.5 text-sm sm:px-8">
      <Stat label="Spent" value={`$${fmtUsdc(spent)}`} mono />
      <Stat label="To creators" value={`${pct}%`} accent />
      <Stat
        label="Decisions"
        value={`${bought} bought · ${cached} cached · ${skipped} skipped`}
      />
      <div className="ml-auto flex items-center gap-2">
        <span className="rounded-md border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3">
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
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
        {label}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums text-ink",
          mono && "font-mono",
          accent && "text-paid",
        )}
      >
        {value}
      </span>
    </div>
  );
}
