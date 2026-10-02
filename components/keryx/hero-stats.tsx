"use client";

/**
 * Hero totals from /api/metrics. Displays the deployment's lifetime settled creator
 * payouts and payment counts, with explicit loading and unavailable states.
 */

import { useEffect, useState } from "react";
import { currentArcLabel } from "@/lib/arc-network-display";

export function HeroStats() {
  const [m, setM] = useState<{ paid: number; cites: number } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("Metrics unavailable"); return r.json(); })
      .then((d) => {
        if (!alive) return;
        if (!d?.metrics) { setState("error"); return; }
        setM({
          paid: d.metrics.totalCreatorPayoutsUsdc ?? 0,
          cites: d.metrics.totalPayments ?? 0,
        });
        setState("ready");
      })
      .catch(() => { if (alive) setState("error"); });
    return () => {
      alive = false;
    };
  }, []);

  if (state !== "ready" || !m) return <p className="border border-ink px-4 py-3 font-mono text-xs text-ink-3" role="status">{state === "loading" ? `Loading settled ${currentArcLabel} totals…` : "Settled totals unavailable."}</p>;

  return (
    <div className="flex w-full border border-ink">
      <Cell
        target={m.paid}
        fmt={(n) => `$${n.toFixed(2)}`}
        label={`Paid to creators · lifetime · ${currentArcLabel}`}
        money
      />
      <Cell
        target={m.cites}
        fmt={(n) => Math.round(n).toLocaleString()}
        label="Settled payments · lifetime"
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
  return (
    <div className="flex-1 border-r border-ink px-4 py-3.5 last:border-r-0">
      <div
        className={`font-display text-[clamp(24px,2.4vw,32px)] font-bold leading-none tracking-tight tabular-nums ${
          money ? "text-paid" : "text-ink"
        }`}
      >
        {fmt(target)}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
    </div>
  );
}
