"use client";

/**
 * Hero traction strip — pulls the real settled metrics from /api/metrics and
 * tallies them up (Bodoni, letterpress) so the landing leads with proof, not
 * a claim. Hidden until there is something real to show.
 */

import { useEffect, useState } from "react";
import { useCountUp } from "@/lib/hooks/use-count-up";

interface Metrics {
  paid: number;
  payments: number;
  creators: number;
}

export function HeroStats() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.metrics) return;
        setM({
          paid: d.metrics.totalCreatorPayoutsUsdc ?? 0,
          payments: d.metrics.totalPayments ?? 0,
          creators: d.metrics.creatorsEarning ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!m || (m.paid <= 0 && m.payments <= 0)) return null;

  return (
    <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4 border-t border-line pt-6">
      <Figure target={m.paid} fmt={(n) => `$${n.toFixed(2)}`} label="settled to creators" />
      <Figure target={m.payments} fmt={(n) => Math.round(n).toLocaleString()} label="payments cleared" />
      <Figure target={m.creators} fmt={(n) => Math.round(n).toLocaleString()} label="creators earning" />
    </div>
  );
}

function Figure({
  target,
  fmt,
  label,
}: {
  target: number;
  fmt: (n: number) => string;
  label: string;
}) {
  const v = useCountUp(target);
  return (
    <div>
      <div className="letterpress font-display text-[34px] font-bold leading-none tabular-nums text-ink">
        {fmt(v)}
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
    </div>
  );
}
