/**
 * GET /api/creator/[id] — per-creator stats: total earned, times cited,
 * recent payments, earnings-over-time. Public — no auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (!source) {
      return NextResponse.json({ error: "creator not found" }, { status: 404 });
    }

    // All-time payouts for this creator (full-table, not the capped live feed) so every
    // headline number matches the leaderboard rather than a recent slice.
    const [creatorPayments, leaderboard] = await Promise.all([
      db.listPaymentsBySource(id),
      db.creatorLeaderboard(),
    ]);

    // Leaderboard carries the authoritative all-time aggregates + rank. Fall back to
    // payment-derived totals only when the source hasn't earned yet (absent from leaderboard).
    const entry = leaderboard.find((e) => e.sourceId === id);
    const rank = leaderboard.findIndex((e) => e.sourceId === id) + 1;

    const settledPayments = creatorPayments.filter((p) => p.settled);
    const settledTotal = settledPayments.reduce((sum, p) => sum + p.amountUsdc, 0);
    const totalEarned = entry?.totalEarnedUsdc ?? creatorPayments.reduce((s, p) => s + p.amountUsdc, 0);
    const paymentCount = entry?.paymentCount ?? creatorPayments.length;
    const citationCount = entry?.citationCount ?? creatorPayments.filter((p) => p.kind === "citation").length;

    // Earnings per day from all-time settled payouts.
    const dailyMap = new Map<string, number>();
    for (const p of settledPayments) {
      const day = p.createdAt.slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + p.amountUsdc);
    }
    const dailyEarnings = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    return NextResponse.json({
      source: {
        id: source.id,
        name: source.name,
        description: source.description,
        walletAddress: source.walletAddress,
        fetchPrice: source.fetchPrice,
        verified: source.verified,
      },
      stats: {
        totalEarned,
        settledTotal,
        paymentCount,
        citationCount,
        rank,
      },
      recentPayments: creatorPayments.slice(0, 25),
      dailyEarnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
