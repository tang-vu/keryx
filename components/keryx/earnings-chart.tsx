"use client";

/**
 * Settled USDC over the last 14 days — a banknote column chart, one bar per UTC day, from a
 * full-table server aggregation (`/api/metrics` → `dailySettled`). Today is struck in vermillion;
 * the rest in treasury green. Bars sit on an ink baseline.
 *
 * Bucketing the capped live feed here would undercount older days (the feed only holds the most
 * recent rows), so the chart consumes the pre-aggregated daily series instead.
 */

import type { DailyVolume } from "@/lib/types";

const DAYS = 14;

export function EarningsChart({ daily }: { daily: DailyVolume[] }) {
  // Right-align to exactly DAYS cells (today last); the server already returns a zero-filled window.
  const pad = Math.max(0, DAYS - daily.length);
  const cells: (DailyVolume | null)[] = [
    ...new Array(pad).fill(null),
    ...daily.slice(-DAYS),
  ];
  const max = Math.max(...cells.map((c) => c?.usdc ?? 0), 1e-9);
  const total = cells.reduce((a, c) => a + (c?.usdc ?? 0), 0);

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
          {cells.map((c, i) => {
            const v = c?.usdc ?? 0;
            return (
              <div
                key={c?.day ?? `pad-${i}`}
                className="flex-1 border-t border-ink"
                style={{
                  height: `${Math.max(2, (v / max) * 100)}%`,
                  background: i === DAYS - 1 ? "var(--seal)" : "var(--paid)",
                }}
                title={c ? `${c.day}: $${v.toFixed(3)}` : "no data"}
              />
            );
          })}
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
          <span>14 days ago</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
