"use client";

/**
 * §II · The reading — the grounded answer set as a printed page: Spectral body
 * with footnote citation markers, a footnotes apparatus where each one pays its
 * author, and a settlement strip (spent / % to creators / decisions / engine).
 * When a permalink URL is available, a Share button copies it to the clipboard.
 */

import { useState, useCallback, useEffect } from "react";
import type { QueryRun } from "@/lib/types";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import { AnswerMarkdown } from "./answer-markdown";
import { ModeBadge } from "./mode-badge";
import { SectionHeading } from "./banknote";
import { fmtUsdc } from "./phase-style";
import { cn } from "@/lib/utils";

export function AnswerCard({ run, meta, permalink }: { run: QueryRun; meta: AskMeta | null; permalink?: string }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const bought = run.decisions.filter((d) => d.action === "BUY").length;
  const skipped = run.decisions.filter((d) => d.action === "SKIP").length;
  const cached = run.decisions.filter((d) => d.action === "CACHE").length;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
      <SectionHeading numeral="II" label="The reading" right={`${run.citations.length} cited`} />
      <div className="border border-ink bg-paper">
        <div className="px-6 py-6 sm:px-9">
          <div className="max-w-[64ch]">
            <AnswerMarkdown
              text={run.answer}
              citations={run.citations}
              onCitationClick={setHighlight}
            />
          </div>

          {run.citations.length > 0 && (
            <div className="mt-7 border-t border-ink pt-5">
              <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                Footnotes — each one pays its author
              </p>
              <ul>
                {run.citations.map((c) => (
                  <li
                    key={c.marker}
                    className={cn(
                      "flex items-center gap-3 border-b border-line py-2.5 transition-colors",
                      highlight === c.marker && "bg-seal/[0.06]",
                    )}
                  >
                    <span className="w-5 shrink-0 font-display text-[14px] font-semibold text-paid">
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

        <FeedbackBar queryId={run.id} />
        <SummaryStrip
          spent={run.totalSpent}
          toCreators={run.totalToCreators}
          bought={bought}
          skipped={skipped}
          cached={cached}
          engine={run.engine}
          meta={meta}
          permalink={permalink}
        />
      </div>
    </div>
  );
}

/** Thumbs up/down bar between footnotes and summary strip.
 *  Fetches existing stats on mount, POSTs on click, updates optimistically. */
function FeedbackBar({ queryId }: { queryId: string }) {
  const [up, setUp] = useState(0);
  const [down, setDown] = useState(0);
  const [voted, setVoted] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/feedback?queryId=${queryId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) { setUp(s.up ?? 0); setDown(s.down ?? 0); }
      })
      .catch(() => {});
  }, [queryId]);

  const vote = useCallback(
    async (rating: "up" | "down") => {
      if (busy || voted === rating) return;
      setBusy(true);
      // Optimistic update
      if (rating === "up") setUp((n) => n + 1);
      else setDown((n) => n + 1);
      setVoted(rating);
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queryId, rating }),
        });
        if (res.ok) {
          const s = await res.json();
          setUp(s.up ?? 0);
          setDown(s.down ?? 0);
        }
      } catch {
        /* revert on error — counts stay optimistic */
      } finally {
        setBusy(false);
      }
    },
    [queryId, busy, voted],
  );

  const total = up + down;
  return (
    <div className="flex items-center gap-3 border-t border-line px-6 py-2.5 sm:px-9">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        Helpful?
      </span>
      <button
        type="button"
        onClick={() => vote("up")}
        disabled={busy}
        className={cn(
          "flex items-center gap-1 border px-2 py-0.5 font-mono text-[12px] transition-colors",
          voted === "up"
            ? "border-paid bg-paid/10 text-paid"
            : "border-line text-ink-3 hover:border-ink hover:text-ink",
        )}
      >
        👍 {up}
      </button>
      <button
        type="button"
        onClick={() => vote("down")}
        disabled={busy}
        className={cn(
          "flex items-center gap-1 border px-2 py-0.5 font-mono text-[12px] transition-colors",
          voted === "down"
            ? "border-destructive bg-destructive/10 text-destructive"
            : "border-line text-ink-3 hover:border-ink hover:text-ink",
        )}
      >
        👎 {down}
      </button>
      {total > 0 && (
        <span className="font-mono text-[10px] text-ink-3">
          {total} vote{total !== 1 ? "s" : ""} · {Math.round((up / total) * 100)}% positive
        </span>
      )}
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
  permalink?: string;
}

function SummaryStrip({
  spent,
  toCreators,
  bought,
  skipped,
  cached,
  engine,
  meta,
  permalink,
}: SummaryStripProps) {
  const [copied, setCopied] = useState(false);
  const pct = spent > 0 ? Math.round((toCreators / spent) * 100) : 100;

  const copyPermalink = useCallback(() => {
    if (!permalink) return;
    navigator.clipboard.writeText(permalink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [permalink]);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink bg-paper-2 px-6 py-3.5 text-sm sm:px-9">
      <Stat label="Spent" value={`$${fmtUsdc(spent)}`} mono />
      <Stat label="To creators" value={`${pct}%`} accent />
      <Stat
        label="Decisions"
        value={`${bought} bought · ${cached} cached · ${skipped} skipped`}
      />
      <div className="ml-auto flex items-center gap-2">
        {permalink && (
          <button
            type="button"
            onClick={copyPermalink}
            className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-ink hover:text-ink"
          >
            {copied ? "✓ Copied" : "Share"}
          </button>
        )}
        <span className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3">
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
