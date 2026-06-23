/**
 * Zero-fill a sparse day→USDC map into a contiguous series of the last `days` UTC calendar days,
 * ordered oldest→newest (today last). Shared by the SQLite and Supabase adapters so the dashboard's
 * "Settled · N days" chart always covers the full window from a full-table aggregation — never the
 * capped live feed, which only holds the most recent rows and collapses older days to ~zero.
 */

import type { DailyVolume } from "@/lib/types";

export function fillDailySeries(rows: DailyVolume[], days: number): DailyVolume[] {
  const byDay = new Map(rows.map((r) => [r.day, r.usdc]));
  const today = new Date();
  const out: DailyVolume[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    const day = d.toISOString().slice(0, 10);
    out.push({ day, usdc: byDay.get(day) ?? 0 });
  }
  return out;
}
