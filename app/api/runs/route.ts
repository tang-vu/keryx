/**
 * GET /api/runs — recent dispatch history (last 50 runs).
 * Public — no auth. Returns lightweight QueryRun summaries.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(50);
    // Return lightweight summaries — no full trace steps
    const summaries = runs.map((r) => ({
      id: r.id,
      question: r.question,
      createdAt: r.createdAt,
      engine: r.engine,
      totalSpent: r.totalSpent,
      totalToCreators: r.totalToCreators,
      citationCount: r.citations?.length ?? 0,
      answerSnippet: r.answer?.slice(0, 120) ?? "",
    }));
    return NextResponse.json(summaries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
