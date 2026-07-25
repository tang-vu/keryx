/**
 * Demand board, machine-readable.
 *
 *   GET /api/wanted?limit=20 → { windowRuns, gaps: [{ claim, coverage, seen, queryId, question, createdAt }] }
 *
 * The same signal the /wanted page renders: sub-claims that real paid dispatches finished
 * under-covered. Public and unauthenticated, because it is an invitation — a creator tool, a feed
 * reader, or another agent should be able to poll what this corpus is missing without asking
 * anyone's permission. Every entry carries the dispatch id that proves it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDemand } from "@/lib/demand-signal";

export const runtime = "nodejs";
export const revalidate = 600;

const WINDOW_RUNS = 400;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : 20;

  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(WINDOW_RUNS);
    return NextResponse.json({ windowRuns: WINDOW_RUNS, gaps: buildDemand(runs, { limit }) });
  } catch {
    return NextResponse.json({ error: "demand board unavailable" }, { status: 503 });
  }
}
