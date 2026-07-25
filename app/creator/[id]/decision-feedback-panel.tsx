"use client";

/**
 * Public "how the agent decides on this source" panel.
 *
 * Earnings tell a creator what happened. This tells them why: how many dispatches weighed this
 * source, how many bought it, how often a purchase actually made the answer — and, in the agent's
 * own words, the reasons behind the most recent passes. Every rationale here is already public on
 * the dispatch it links to; the panel is the per-source view nobody could assemble by hand.
 *
 * No advice is rendered. The comparison line states what the agent paid for other sources in the
 * very runs where this one was skipped, and stops there — repricing (or deepening the preview) is
 * the creator's call, made from the same numbers the agent used.
 *
 * Renders nothing until the run window has actually considered the source, so a fresh listing shows
 * silence instead of a row of zeros.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Scale } from "lucide-react";
import { fmtUsdc } from "@/components/keryx/phase-style";
import type { SourcePerformance } from "@/lib/creator/source-performance";

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
        <Scale className="h-3.5 w-3.5 text-seal" /> How the agent decides on this source
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        Every dispatch weighs this source against the others and records why it bought or passed.
        Across the last {data?.windowRuns} dispatches, {perf.considered} of them weighed this one.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label="Weighed" value={String(perf.considered)} sub="dispatches" />
        {/* Chosen leads, with the toll/cache split underneath: on a mature corpus most reads are
            cache hits, so a bare "Bought 0" would read as rejection when the source was in fact
            picked 39 times out of 47. */}
        <Cell
          label="Chosen"
          value={String(chosen)}
          sub={
            perf.bought > 0 && perf.reused > 0
              ? `${perf.bought} fresh · ${perf.reused} cached`
              : perf.bought > 0
                ? `${perf.bought} fresh tolls`
                : `all ${perf.reused} from cache`
          }
          accent
        />
        <Cell
          label="Cited"
          value={String(perf.cited)}
          sub={perf.citeThrough !== null ? `${pct(perf.citeThrough)} of ${chosen} reads` : "—"}
          accent
        />
        <Cell
          label="Passed"
          value={String(perf.skipped)}
          sub={`${pct(perf.skipped / perf.considered)} of the time`}
        />
      </div>

      {/* The bar this source was measured against — same question, same budget, same minute. */}
      {perf.rivalPriceOnSkip !== null && perf.price !== null && (
        <p className="mb-4 border-l-2 border-line pl-3 font-serif text-[13px] text-ink-2">
          In the dispatches that passed on it, the sources the agent did choose were listed at a
          median <span className="font-mono text-ink">${fmtUsdc(perf.rivalPriceOnSkip)}</span> per
          read. This one asks{" "}
          <span className="font-mono text-ink">${fmtUsdc(perf.price)}</span>.
          {perf.evChosen !== null && perf.evSkipped !== null && (
            <>
              {" "}
              It rated this source {perf.evChosen.toFixed(2)} when it bought and{" "}
              {perf.evSkipped.toFixed(2)} when it passed, on its 0–1 expected-value scale.
            </>
          )}
        </p>
      )}

      {perf.recentSkips.length > 0 && (
        <>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Most recent passes, in the agent&apos;s words
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
                  expected value {s.expectedValue.toFixed(2)} · asked ${fmtUsdc(s.price)}
                  {s.rivalPrice !== null && <> · chose ${fmtUsdc(s.rivalPrice)} instead</>} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString()}
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
