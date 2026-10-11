"use client";

/**
 * Public "how the agent decides on this source" panel.
 *
 * Earnings tell a creator what happened. This tells them why: how many dispatches weighed this
 * source, how many chose to read it, how often that choice made the answer — and, in the agent's
 * own words, the reasons behind the most recent passes. Every rationale here is already public on
 * the dispatch it links to; the panel is the per-source view nobody could assemble by hand.
 *
 * No advice is rendered. The comparison line states the listed prices of alternatives the agent chose in the
 * very runs where this one was skipped, and stops there — repricing (or deepening the preview) is
 * the creator's call, made from the same numbers the agent used.
 *
 * Renders nothing until the run window has actually considered the source, so a fresh listing shows
 * silence instead of a row of zeros.
 */

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Scale } from "lucide-react";
import { fmtUsdc } from "@/components/keryx/phase-style";
import type { SourcePerformance } from "@/lib/creator/source-performance";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

interface FeedbackData {
  windowRuns: number;
  performance: SourcePerformance | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function DecisionFeedbackPanel({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<FeedbackData | null>(null);

  useEffect(() => {
    fetch(`/api/creator/${creatorId}/performance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FeedbackData | null) => setData(d))
      .catch(() => {});
  }, [creatorId]);

  const perf = data?.performance;
  if (!perf || perf.considered === 0) return null;

  const chosen = perf.bought + perf.reused;

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Scale className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorDecisions.title")}
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        {uiCopy(data?.windowRuns === 1 ? "creatorDecisions.window.one" : "creatorDecisions.window.other", { window: data?.windowRuns ?? "", considered: perf.considered })}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label={uiCopy("creatorDecisions.weighed")} value={String(perf.considered)} sub={uiCopy("creatorDecisions.dispatches")} />
        {/* Chosen leads, with the toll/cache split underneath: on a mature corpus most reads are
            cache hits, so a bare "Bought 0" would read as rejection when the source was in fact
            picked 39 times out of 47. */}
        <Cell
          label={uiCopy("creatorDecisions.chosen")}
          value={String(chosen)}
          sub={
            perf.bought > 0 && perf.reused > 0
              ? `${perf.bought} BUY / ${perf.reused} CACHE`
              : perf.bought > 0
                ? uiCopy(perf.bought === 1 ? "creatorDecisions.buy.one" : "creatorDecisions.buy.other", { count: perf.bought })
                : uiCopy(perf.reused === 1 ? "creatorDecisions.cache.one" : "creatorDecisions.cache.other", { count: perf.reused })
          }
          accent
        />
        <Cell
          label={uiCopy("creatorDecisions.citations")}
          value={String(perf.cited)}
          sub={perf.citeThrough !== null ? uiCopy(chosen === 1 ? "creatorDecisions.citeThrough.one" : "creatorDecisions.citeThrough.other", { percent: pct(perf.citeThrough), count: chosen }) : "—"}
          accent
        />
        <Cell
          label={uiCopy("creatorDecisions.passed")}
          value={String(perf.skipped)}
          sub={uiCopy("creatorDecisions.skipRate", { percent: pct(perf.skipped / perf.considered) })}
        />
      </div>

      <p className="mb-4 text-xs text-ink-2">{uiCopy("creatorDecisions.paymentBoundary")}</p>

      {/* The bar this source was measured against — same question, same budget, same minute. */}
      {perf.rivalPriceOnSkip !== null && perf.price !== null && (
        <p className="mb-4 border-l-2 border-line pl-3 font-serif text-[13px] text-ink-2">
          {perf.evChosen !== null && perf.evSkipped !== null ? uiRichCopy("creatorDecisions.ratedComparison", { rivalPrice: <span className="font-mono text-ink">${fmtUsdc(perf.rivalPriceOnSkip)}</span>, price: <span className="font-mono text-ink">${fmtUsdc(perf.price)}</span>, chosenValue: perf.evChosen.toFixed(2), skippedValue: perf.evSkipped.toFixed(2) }) : uiRichCopy("creatorDecisions.priceComparison", { rivalPrice: <span className="font-mono text-ink">${fmtUsdc(perf.rivalPriceOnSkip)}</span>, price: <span className="font-mono text-ink">${fmtUsdc(perf.price)}</span> })}
        </p>
      )}

      {perf.recentSkips.length > 0 && (
        <>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            {uiCopy("creatorDecisions.recent")}
          </h3>
          <div className="space-y-2">
            {perf.recentSkips.map((s) => (
              <div key={s.queryId} className="border-b border-line pb-2 last:border-0">
                <Link
                  href={`/dispatch/${s.queryId}`}
                  className="block truncate font-serif text-[13px] leading-snug text-ink transition-colors hover:text-seal"
                  title={s.question}
                >
                  {s.question}
                </Link>
                <p className="mt-1 font-serif text-[13px] italic leading-snug text-ink-2">
                  “{s.rationale}”
                </p>
                <p className="mt-1 font-mono text-[10px] text-ink-3">
                  {s.rivalPrice !== null ? uiCopy("creatorDecisions.skipWithRival", { value: s.expectedValue.toFixed(2), price: fmtUsdc(s.price), rivalPrice: fmtUsdc(s.rivalPrice), date: new Date(s.createdAt).toLocaleDateString() }) : uiCopy("creatorDecisions.skip", { value: s.expectedValue.toFixed(2), price: fmtUsdc(s.price), date: new Date(s.createdAt).toLocaleDateString() })}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-line bg-paper-2 px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <p
        className={`font-display text-[20px] leading-tight ${accent ? "text-paid" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="font-mono text-[10px] text-ink-3">{sub}</p>
    </div>
  );
}
