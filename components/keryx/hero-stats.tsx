"use client";

/**
 * Hero denomination box — the real settled metrics from /api/metrics, struck in
 * Bodoni and tallied up. Two cells: paid to creators (green) and citations
 * today (ink). Hidden until there is something real to show.
 */

import { useEffect, useState } from "react";
import { useCountUp } from "@/lib/hooks/use-count-up";

export function HeroStats() {
  const [m, setM] = useState<{ paid: number; cites: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.metrics) return;
        setM({
          paid: d.metrics.totalCreatorPayoutsUsdc ?? 0,
          cites: d.metrics.totalPayments ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!m || (m.paid <= 0 && m.cites <= 0)) return null;

  return (
    <div className="flex w-full border border-ink">
      <Cell
        target={m.paid}
        fmt={(n) => `$${n.toFixed(2)}`}
        label="Paid to creators"
        money
      />
      <Cell
        target={m.cites}
        fmt={(n) => Math.round(n).toLocaleString()}
        label="Citations today"
      />
    </div>
  );
}

function Cell({
  target,
  fmt,
  label,
  money,
}: {
  target: number;
  fmt: (n: number) => string;
  label: string;
  money?: boolean;
}) {
  const v = useCountUp(target);
  return (
    <div className="flex-1 border-r border-ink px-4 py-3.5 last:border-r-0">
      <div
        className={`font-display text-[clamp(24px,2.4vw,32px)] font-bold leading-none tracking-tight tabular-nums ${
          money ? "text-paid" : "text-ink"
        }`}
      >
        {fmt(v)}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
    </div>
  );
}
