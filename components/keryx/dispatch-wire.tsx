"use client";

/**
 * The dispatch wire — a running tape of recent settlements under the nav, like
 * a treasury ticker. Pulls real payouts from /api/payments; falls back to a
 * representative sample if the wire is quiet.
 */

import { useEffect, useState } from "react";
import type { PaymentRecord } from "@/lib/types";

interface WireItem {
  who: string;
  amt: string;
}

const FALLBACK: WireItem[] = [
  { who: "@circle-research", amt: "+$0.018" },
  { who: "@402.org", amt: "+$0.020" },
  { who: "@arc-docs", amt: "+$0.011" },
  { who: "@fieldguide.dev", amt: "+$0.016" },
  { who: "@stables-weekly", amt: "+$0.009" },
  { who: "@agent-econ", amt: "+$0.022" },
  { who: "@circle-research", amt: "+$0.014" },
  { who: "@arc-docs", amt: "+$0.008" },
];

function handleize(name: string): string {
  return (
    "@" +
    (name || "source")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20)
  );
}

export function DispatchWire() {
  const [items, setItems] = useState<WireItem[]>(FALLBACK);

  useEffect(() => {
    let alive = true;
    fetch("/api/payments?limit=12", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.payments?.length) return;
        const real = (d.payments as PaymentRecord[])
          .filter((p) => (p.amountUsdc ?? 0) > 0)
          .slice(0, 12)
          .map((p) => ({
            who: handleize(p.sourceName),
            amt: `+$${(p.amountUsdc ?? 0).toFixed(3)}`,
          }));
        if (real.length) setItems(real);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = [...items, ...items];

  return (
    <div className="flex h-10 items-center overflow-hidden border-b border-ink bg-panel">
      <div className="z-[2] flex h-full flex-none items-center gap-2.5 bg-ink px-4 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-paper">
        <span className="h-1.5 w-1.5 rounded-full bg-seal" style={{ animation: "kxBlink 1.6s infinite" }} />
        Dispatch wire
      </div>
      <div
        className="flex w-max"
        style={{
          animation: "kxTape 46s linear infinite",
          maskImage: "linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)",
        }}
      >
        {run.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 whitespace-nowrap px-5 font-mono text-[11.5px] text-ink-3"
          >
            <span className="tracking-[0.1em] text-seal">PAID</span>
            <span className="text-ink">{t.who}</span>
            <span className="font-medium text-paid">{t.amt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
