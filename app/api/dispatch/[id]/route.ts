/**
 * GET /api/dispatch/[id] — public permalink for a completed dispatch.
 *
 * Returns the full QueryRun (answer, citations, decisions, trace steps,
 * payments). No auth required — permalinks are public by design so judges
 * and external users can review any dispatch without a wallet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  try {
    const db = await getDb();
    const run = await db.getQueryRun(id);
    if (!run) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
