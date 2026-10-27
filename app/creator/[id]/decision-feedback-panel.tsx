"use client";
import { formatNumber, selectPlural } from "@/lib/i18n/format";

import { DisplayTime } from "@/components/keryx/display-time";
import { createRichMessages as createDateMessages } from "@/lib/i18n/rich-messages";

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


import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Scale } from "lucide-react";
import { fmtUsdc } from "@/components/keryx/phase-style";
import { isSourcePerformanceResponse, type SourcePerformanceResponse } from "@/lib/creator/source-performance-response";
import { useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";






type FeedbackRead = { creatorId: string; attempt: number } & (
  { status: "available"; data: SourcePerformanceResponse } | { status: "unavailable" }
);
const READ_TIMEOUT_MS = 15_000;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function DecisionFeedbackPanel({ creatorId }: { creatorId: string }) {
  return <DecisionFeedbackContent key={creatorId} creatorId={creatorId} />;
}

function DecisionFeedbackContent({ creatorId }: { creatorId: string }) {
  const uiCopy = useUiMessages();
  const uiRichCopy = useUiRichMessages();
  const [result, setResult] = useState<FeedbackRead | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setResult({ creatorId, attempt, status: "unavailable" });
    }, READ_TIMEOUT_MS);
    void (async () => {
      try {
        const response = await fetch(`/api/creator/${encodeURIComponent(creatorId)}/performance`, {
          signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error("Feedback unavailable");
        const data: unknown = await response.json();
        if (!isSourcePerformanceResponse(data, creatorId)) throw new Error("Invalid feedback response");
        if (!active) return;
        active = false;
        clearTimeout(timer);
        setResult({ creatorId, attempt, status: "available", data });
      } catch {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        setResult({ creatorId, attempt, status: "unavailable" });
      }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [creatorId, attempt]);

  const current = result?.creatorId === creatorId && result.attempt === attempt ? result : null;
  if (result?.creatorId === creatorId && result.status === "unavailable") {
    const pending = current === null;
    return <section aria-label={uiCopy("creatorDecisions.title")} className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{uiCopy("creatorDecisions.title")}</h2>
      <p role="status" className="max-w-xl font-serif text-sm text-ink-2">{uiCopy("sourceLearning.unavailable")}</p>
      <button type="button" disabled={pending} aria-busy={pending} onClick={() => setAttempt(value => value + 1)}
        className="mt-3 min-h-11 rounded-sm border border-line px-3 font-mono text-xs text-ink disabled:opacity-50">
        {uiCopy("myHistory.retry")}
      </button>
    </section>;
  }

  const data = current?.status === "available" ? current.data : null;
  const perf = data?.performance;
  if (!perf || perf.considered === 0) return null;

  const chosen = perf.bought + perf.reused;

  return (
    <section aria-label={uiCopy("creatorDecisions.title")} className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Scale className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorDecisions.title")}
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        {uiCopy(selectPlural(data?.windowRuns) === "one" ? "creatorDecisions.window.one" : "creatorDecisions.window.other", { window: data?.windowRuns ?? "", considered: perf.considered })}
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
                ? uiCopy(selectPlural(perf.bought) === "one" ? "creatorDecisions.buy.one" : "creatorDecisions.buy.other", { count: perf.bought })
                : uiCopy(selectPlural(perf.reused) === "one" ? "creatorDecisions.cache.one" : "creatorDecisions.cache.other", { count: perf.reused })
          }
          accent
        />
        <Cell
          label={uiCopy("creatorDecisions.citations")}
          value={String(perf.cited)}
          sub={perf.citeThrough !== null ? uiCopy(selectPlural(chosen) === "one" ? "creatorDecisions.citeThrough.one" : "creatorDecisions.citeThrough.other", { percent: pct(perf.citeThrough), count: chosen }) : "—"}
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
          {perf.evChosen !== null && perf.evSkipped !== null ? uiRichCopy("creatorDecisions.ratedComparison", { rivalPrice: <span className="font-mono text-ink">${fmtUsdc(perf.rivalPriceOnSkip)}</span>, price: <span className="font-mono text-ink">${fmtUsdc(perf.price)}</span>, chosenValue: formatNumber(perf.evChosen, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), skippedValue: formatNumber(perf.evSkipped, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }) : uiRichCopy("creatorDecisions.priceComparison", { rivalPrice: <span className="font-mono text-ink">${fmtUsdc(perf.rivalPriceOnSkip)}</span>, price: <span className="font-mono text-ink">${fmtUsdc(perf.price)}</span> })}
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
                  {s.rivalPrice !== null ? dateCopy("creatorDecisions.skipWithRival", { value: formatNumber(s.expectedValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), price: fmtUsdc(s.price), rivalPrice: fmtUsdc(s.rivalPrice), date: <DisplayTime value={s.createdAt} dateOnly /> }) : dateCopy("creatorDecisions.skip", { value: formatNumber(s.expectedValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), price: fmtUsdc(s.price), date: <DisplayTime value={s.createdAt} dateOnly /> })}
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

const dateCopy = createDateMessages("en");
