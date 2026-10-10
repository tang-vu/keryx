/**
 * GET /api/runs — recent dispatch history (last 50 runs).
 * Public — no auth. Returns lightweight QueryRun summaries.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTestnetArchive } from "@/lib/history/testnet-archive";
import { mergeQuestionHistory, questionSummary } from "@/lib/history/public-history";
import { config } from "@/lib/config";
import { historyCohort, usageWindow } from "@/lib/usage/contracts";
import { parseRunUsage } from "@/lib/research/usage-provenance";
import { publicHistoryIncludes } from "@/lib/research-audit/usage-cohort";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request = new Request("https://keryx.invalid/api/runs")) {
  const params = new URL(request.url).searchParams;
  let window, cohort, archived;
  try {
    if (params.getAll("archive").length > 1 || params.has("archive") && params.get("archive") !== "testnet") throw Error("Invalid archive selector");
    archived = params.get("archive") === "testnet";
    window = usageWindow(params, archived ? "eip155:5042002" : config.profile.networkId); cohort = historyCohort(params);
    if (archived && window.network !== "eip155:5042002") throw Error("Invalid archive network");
  }
  catch { return NextResponse.json({ error: "invalid_usage_filter" }, { status: 400 }); }
  try {
    const includes = (run: import("@/lib/types").QueryRun) => publicHistoryIncludes(parseRunUsage(run.usage)?.cohort ?? "unknown");
    if (archived) {
      // The unchanged guarded archive reader qualifies its own fixed historical rail,
      // not a complete classified time window. Never fake a filtered empty/full page.
      if (window.period !== "all" || cohort !== "default")
        return NextResponse.json({ error: "classified_archive_history_unavailable", complete: false }, { status: 503 });
      const archive = await getTestnetArchive();
      if (!archive) return NextResponse.json({ error: "testnet_history_unavailable", complete: false }, { status: 503 });
      const rows = (await archive.listRecentQueries(50)).filter(includes);
      return NextResponse.json(rows.map(run => questionSummary(run, archive.info)), { headers: {
        "X-Keryx-Testnet-History": "available", "X-Keryx-History-Network": archive.info.network,
        "X-Keryx-History-Profile": "historical-testnet-archive",
        "X-Keryx-History-Coverage": "incomplete-archive-50-row-sample-scripted-filtered-after-scan",
        "X-Keryx-History-Cohort": "default",
      } });
    }
    const db = await getDb();
    const classified = params.has("network") || params.has("period") || params.has("since") || cohort !== "default";
    if (classified && db.publicUsage) {
      const runs = await db.publicUsage.history(window, cohort, 50);
      return NextResponse.json(runs.map(run => questionSummary(run)), { headers: {
        "X-Keryx-History-Coverage": "complete-bounded-window-filtered-before-page",
        "X-Keryx-History-Network": window.network, "X-Keryx-History-Since": window.since,
        "X-Keryx-History-Until": window.until, "X-Keryx-History-Cohort": cohort,
        "X-Keryx-Testnet-History": "not-included-classified-current-profile",
      } });
    }
    // Existing enrolled/native recent-reader only. A sample cannot establish an outside/network/period page.
    if (classified)
      return NextResponse.json({ error: "classified_history_unavailable", complete: false }, { status: 503 });
    const runs = await db.listRecentQueries(50);
    let archive, historical = [] as import("@/lib/types").QueryRun[], archiveStatus = "not-configured";
    try { archive = await getTestnetArchive(); if (archive) { historical = await archive.listRecentQueries(50); archiveStatus = "available"; } }
    catch { archiveStatus = "unavailable"; }
    // Preserve default compatibility and current-wins identity before hiding scripts;
    // an older duplicate cannot resurrect a current scripted run.
    const rows = mergeQuestionHistory(runs, historical, 100).filter(row => includes(row.run)).slice(0, 50);
    return NextResponse.json(rows.map(row => questionSummary(row.run, row.historical ? archive!.info : undefined)), { headers: {
      "X-Keryx-Testnet-History": archiveStatus,
      "X-Keryx-History-Coverage": "incomplete-current-and-archive-50-row-scans-deduped-scripted-filtered-before-final-page",
      "X-Keryx-History-Network": "current-unpartitioned-plus-labelled-testnet-archive", "X-Keryx-History-Cohort": "default",
    } });
  } catch (err) {
    void err;
    return NextResponse.json({ error: "Question history unavailable" }, { status: 503 });
  }
}
