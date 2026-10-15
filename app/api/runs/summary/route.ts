import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { historyCohort, usageWindow } from "@/lib/usage/contracts";
import { privacyReadsActive, requirePrivacy } from "@/lib/run-privacy/contracts";
import { publicHistoryIncludes } from "@/lib/research-audit/usage-cohort";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let window, cohort;
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("archive")) throw new Error("Archive population is not a current database window");
    window = usageWindow(params, config.profile.networkId); cohort = historyCohort(params);
  } catch { return Response.json({ error: "invalid_usage_filter" }, { status: 400 }); }
  try {
    const db = await getDb();
    if (!db.publicUsage) throw new Error("Public population unavailable");
    let publicQuestions: number;
    if (privacyReadsActive(db)) {
      requirePrivacy(db);
      if (!db.publicUsage.publishedHistory) throw new Error("Published population unavailable");
      // This exhausts the bounded classified public population; the one-row sample is not the count.
      publicQuestions = (await db.publicUsage.publishedHistory(window, cohort, 1)).windowRuns;
    } else {
      const summary = await db.publicUsage.summary(window);
      publicQuestions = summary.columns.filter(row => cohort === "default" ? publicHistoryIncludes(row.cohort) : row.cohort === cohort)
        .reduce((total, row) => total + row.researchRuns, 0);
    }
    if (!Number.isSafeInteger(publicQuestions) || publicQuestions < 0) throw new Error("Invalid public population");
    return Response.json({ complete: true, network: window.network, period: window.period, since: window.since, until: window.until,
      cohort, publicQuestions, basis: "complete-bounded-current-database-public-window" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "public_history_summary_unavailable", complete: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
