"use client";

/**
 * Earnings over the last 14 days — a banknote column chart bucketed by day from
 * real settled payments (no mock data). Today is struck in vermillion; the rest
 * in treasury green. Bars sit on an ink baseline.
 */

import type { PaymentRecord } from "@/lib/types";

const DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function EarningsChart({ payments }: { payments: PaymentRecord[] }) {
  const now = Date.now();
  const buckets = new Array(DAYS).fill(0) as number[];
  for (const p of payments) {
    const t = new Date(p.createdAt).getTime();
    if (Number.isNaN(t)) continue;
    const idx = DAYS - 1 - Math.floor((now - t) / DAY_MS);
    if (idx >= 0 && idx < DAYS) buckets[idx] += p.amountUsdc ?? 0;
  }
  const max = Math.max(...buckets, 1e-9);
  const total = buckets.reduce((a, b) => a + b, 0);

  return (
    <div className="border border-ink bg-paper">
      <div className="flex items-center justify-between border-b border-ink px-6 py-[18px]">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
          Settled · 14 days
        </div>
        <div className="font-mono text-[10.5px] text-ink-3">
          ${total.toFixed(2)} total
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="flex h-[120px] items-end gap-1.5">
          {buckets.map((v, i) => (
            <div
              key={i}
              className="flex-1 border-t border-ink"
              style={{
                height: `${Math.max(2, (v / max) * 100)}%`,
                background: i === DAYS - 1 ? "var(--seal)" : "var(--paid)",
              }}
              title={`$${v.toFixed(3)}`}
            />
          ))}
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
          <span>14 days ago</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
