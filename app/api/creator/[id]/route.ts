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

    const [payments, leaderboard, dailySettled] = await Promise.all([
      db.listPayments(500),
      db.creatorLeaderboard(),
      db.dailySettled(14),
    ]);

    // Filter payments to this creator only
    const creatorPayments = payments.filter((p) => p.sourceId === id);
    const totalEarned = creatorPayments.reduce((sum, p) => sum + p.amountUsdc, 0);
    const settledPayments = creatorPayments.filter((p) => p.settled);
    const settledTotal = settledPayments.reduce((sum, p) => sum + p.amountUsdc, 0);

    // Count citations from query runs that cited this source
    const recentQueries = await db.listRecentQueries(200);
    let citationCount = 0;
    for (const run of recentQueries) {
      for (const c of run.citations ?? []) {
        if (c.sourceId === id) citationCount++;
      }
    }

    // Leaderboard rank
    const rank = leaderboard.findIndex((e) => e.sourceId === id) + 1;

    // Earnings per day (from dailySettled, filtered to this source's payments)
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
        paymentCount: creatorPayments.length,
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
