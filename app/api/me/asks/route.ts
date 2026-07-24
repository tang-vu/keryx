/**
 * The signed-in wallet's own dispatch ledger — the data behind /me/asks.
 *
 *   GET /api/me/asks?limit= → { wallet, totals, asks: [...] }
 *
 * Receipts, not history-for-everyone: a dispatch appears here only if it was run while this exact
 * wallet held a SIWE session (see app/api/ask). Totals keep the wallet's own spend apart from
 * free-trial dispatches, whose USDC came from the Keryx treasury — presenting the two as one
 * number would tell a user they spent money they never spent.
 *
 * SIWE session only. There is deliberately no API-key path: a key identifies a wallet for the
 * paid endpoints, and those runs are not attributed here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_LIMIT) : DEFAULT_LIMIT;

  const db = await getDb();
  const runs = await db.listQueryRunsByAsker(session.address, limit);

  const asks = runs.map((r) => ({
    id: r.id,
    question: r.question,
    createdAt: r.createdAt,
    budget: r.budget,
    spentUsdc: r.totalSpent,
    toCreatorsUsdc: r.totalToCreators,
    citationCount: r.citations?.length ?? 0,
    // Which sources this wallet's money reached — the point of a citation toll, and the one
    // thing a payer can't reconstruct from a bank-style amount alone.
    creators: (r.citations ?? []).map((c) => ({
      sourceId: c.sourceId,
      name: c.sourceName,
      rewardUsdc: c.reward,
    })),
    confidence: r.confidence?.level ?? null,
    funded: r.askerFunded === true,
    isFollowUp: Boolean(r.parentId),
  }));

  const funded = asks.filter((a) => a.funded);
  const trial = asks.filter((a) => !a.funded);

  return NextResponse.json({
    wallet: session.address,
    totals: {
      dispatches: asks.length,
      // Own spend: only dispatches this wallet's session key actually paid for.
      spentUsdc: funded.reduce((n, a) => n + a.spentUsdc, 0),
      toCreatorsUsdc: funded.reduce((n, a) => n + a.toCreatorsUsdc, 0),
      citations: asks.reduce((n, a) => n + a.citationCount, 0),
      trialDispatches: trial.length,
      trialToCreatorsUsdc: trial.reduce((n, a) => n + a.toCreatorsUsdc, 0),
    },
    // True when the page is looking at a capped window rather than the wallet's whole history.
    truncated: asks.length === limit,
    asks,
  });
}
