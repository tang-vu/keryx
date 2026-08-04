/**
 * GET /api/creator/[id] — per-creator stats: total earned, times cited,
 * recent payments, earnings-over-time. Public — no auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  findAccount,
  SETTLEMENT_PARITY_STATE_KEY,
  type SettlementParitySummary,
} from "@/lib/gateway/settlement-parity";

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
    const totalEarned = entry?.totalEarnedUsdc ?? settledTotal;
    const paymentCount = entry?.paymentCount ?? settledPayments.length;
    const citationCount = entry?.citationCount ?? settledPayments.filter((p) => p.kind === "citation").length;

    // Earnings per day from all-time settled payouts.
    const dailyMap = new Map<string, number>();
    for (const p of settledPayments) {
      const day = p.createdAt.slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + p.amountUsdc);
    }
    const dailyEarnings = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));

    // Attach the question that triggered each payout so the creator sees WHAT work of
    // theirs was used, not an opaque query id — the tangible "you were cited for this".
    // Dedupe by queryId first so a creator cited several times in one query costs one read.
    const recent = creatorPayments.slice(0, 25);
    const uniqueQueryIds = [...new Set(recent.map((p) => p.queryId).filter(Boolean))];
    const questionById = new Map<string, string>();
    await Promise.all(
      uniqueQueryIds.map(async (qid) => {
        const run = await db.getQueryRun(qid);
        if (run?.question) questionById.set(qid, run.question);
      }),
    );
    const recentPayments = recent.map((p) => ({
      ...p,
      question: questionById.get(p.queryId) ?? null,
    }));

    // Circle's own word on this creator's money. Gateway payouts carry no explorer hash, so the
    // hourly parity watchdog asks Circle what it holds per payee and stores the answer; this reads
    // it back for the wallets that belong to this source — its own (fetch tolls) and each author's
    // (citation splits). Null when the sweep has not run yet: no claim is better than a stale one.
    let gatewayProof: {
      checkedAt: string;
      wallets: { address: string; label?: string; owedUsdc: number; heldUsdc: number | null; verdict: string }[];
    } | null = null;
    try {
      const raw = await db.getSyncState(SETTLEMENT_PARITY_STATE_KEY);
      const summary = raw ? (JSON.parse(raw) as SettlementParitySummary) : null;
      const mine = [source.walletAddress, ...(source.authors ?? []).map((a) => a.walletAddress)];
      const wallets = [...new Set(mine.filter(Boolean).map((w) => w.toLowerCase()))]
        .map((w) => findAccount(summary, w))
        .filter((a): a is NonNullable<typeof a> => a !== null);
      if (summary && wallets.length > 0) gatewayProof = { checkedAt: summary.checkedAt, wallets };
    } catch {
      /* an unreadable summary costs the proof row, never the profile */
    }

    return NextResponse.json({
      source: {
        id: source.id,
        name: source.name,
        description: source.description,
        walletAddress: source.walletAddress,
        fetchPrice: source.fetchPrice,
        verified: source.verified,
      },
      gatewayProof,
      stats: {
        totalEarned,
        settledTotal,
        paymentCount,
        citationCount,
        rank,
      },
      recentPayments,
      dailyEarnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
