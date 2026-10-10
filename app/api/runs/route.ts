/**
 * GET /api/runs — recent dispatch history (last 50 runs).
 * Public — no auth. Returns lightweight QueryRun summaries.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { questionSummary } from "@/lib/history/public-history";
import { config } from "@/lib/config";
import { historyCohort, usageWindow } from "@/lib/usage/contracts";
import { parseRunUsage } from "@/lib/research/usage-provenance";
import { publicHistoryIncludes } from "@/lib/research-audit/usage-cohort";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request = new Request("https://keryx.invalid/api/runs")) {
  const params = new URL(request.url).searchParams;
  let window, cohort;
  try { window = usageWindow(params, config.profile.networkId); cohort = historyCohort(params); }
  catch { return NextResponse.json({ error: "invalid_usage_filter" }, { status: 400 }); }
  try {
    const db = await getDb();
    if (db.publicUsage) {
      const runs = await db.publicUsage.history(window, cohort, 50);
      return NextResponse.json(runs.map(run => questionSummary(run)), { headers: {
        "X-Keryx-History-Coverage": "complete-bounded-window-filtered-before-page",
        "X-Keryx-History-Network": window.network, "X-Keryx-History-Since": window.since,
        "X-Keryx-History-Until": window.until, "X-Keryx-History-Cohort": cohort,
      } });
    }
    // Existing enrolled/native recent-reader only. A sample cannot establish an outside/network/period page.
    if (params.has("network") || params.has("period") || params.has("since") || cohort !== "default")
      return NextResponse.json({ error: "classified_history_unavailable", complete: false }, { status: 503 });
    const runs = (await db.listRecentQueries(50)).filter(run => publicHistoryIncludes(parseRunUsage(run.usage)?.cohort ?? "unknown"));
    return NextResponse.json(runs.map(run => questionSummary(run)), { headers: {
      "X-Keryx-History-Coverage": "incomplete-current-store-50-row-sample-filtered-after-scan",
      "X-Keryx-History-Network": "unpartitioned", "X-Keryx-History-Cohort": "default",
    } });
  } catch (err) {
    void err;
    return NextResponse.json({ error: "Question history unavailable" }, { status: 503 });
  }
}
