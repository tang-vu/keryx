/**
 * Decision feedback for one source — how the agent judged it, and what it paid for instead.
 *
 *   GET /api/creator/[id]/performance → { sourceId, name, windowRuns, performance }
 *
 * Public, like the creator page it feeds. Every fact here is already published on the dispatch
 * permalinks this aggregates (the decision trace with its rationale is the point of Keryx); the
 * only thing added is the per-source view nobody could assemble by hand. `performance` is null when
 * the run window never considered the source — a brand-new listing, which the panel renders as
 * silence rather than as a row of zeros.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSourcePerformance } from "@/lib/creator/source-performance-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return NextResponse.json({ error: "source not found" }, { status: 404 });

  const { performance, windowRuns } = await getSourcePerformance(id);
  return NextResponse.json({
    sourceId: id,
    name: source.name,
    windowRuns,
    performance,
  });
}
