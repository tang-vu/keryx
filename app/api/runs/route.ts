/**
 * GET /api/runs — recent dispatch history (last 50 runs).
 * Public — no auth. Returns lightweight QueryRun summaries.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTestnetArchive } from "@/lib/history/testnet-archive";
import { mergeQuestionHistory, questionSummary } from "@/lib/history/public-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(50);
    let archive, historical = [] as import("@/lib/types").QueryRun[];
    let archiveStatus = "not-configured";
    try {
      archive = await getTestnetArchive();
      if (archive) { historical = await archive.listRecentQueries(50); archiveStatus = "available"; }
    } catch { archiveStatus = "unavailable"; }
    const summaries = mergeQuestionHistory(runs, historical, 50).map(({ run, historical }) => questionSummary(run, historical ? archive!.info : undefined));
    return NextResponse.json(summaries, { headers: { "X-Keryx-Testnet-History": archiveStatus } });
  } catch (err) {
    void err;
    return NextResponse.json({ error: "Question history unavailable" }, { status: 503 });
  }
}
