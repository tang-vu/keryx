/** GET /api/metrics → dashboard aggregate metrics + creator leaderboard + most-cited topics. */

import { getDb } from "@/lib/db";
import { getTestnetArchive } from "@/lib/history/testnet-archive";
import { loadSourceLeaderboard } from "@/lib/sources/source-leaderboard";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Derive "most-cited topics" from real data: every citation payment is mapped
 * to its source's tags, and each citation contributes one unit split evenly
 * across that source's tags. Only returned once there is genuine signal (≥3
 * distinct topics), so the dashboard panel stays hidden until it's meaningful.
 */
function topicBreakdown(
  payments: { kind: string; sourceId: string; settled: boolean }[],
  tagsById: Map<string, string[]>,
): { name: string; pct: number }[] {
  const tally = new Map<string, number>();
  for (const p of payments) {
    if (!p.settled || p.kind !== "citation") continue;
    const tags = tagsById.get(p.sourceId);
    if (!tags?.length) continue;
    const share = 1 / tags.length;
    for (const t of tags) tally.set(t, (tally.get(t) ?? 0) + share);
  }
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  if (total <= 0 || tally.size < 3) return [];
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, v]) => ({ name, pct: Math.round((v / total) * 100) }));
}

export async function GET(request?: Request) {
  const views = request ? new URL(request.url).searchParams.getAll("view") : [];
  const dashboardOnly = views.length === 1 && views[0] === "dashboard";
  const db = await getDb();
  const [metrics, leaderboard, payments, sources, dailySettled, feedback, activationFunnel] = await Promise.all([
    db.metrics(),
    db.creatorLeaderboard(),
    dashboardOnly ? Promise.resolve([]) : db.listPayments(1000),
    db.listSources(),
    dashboardOnly ? Promise.resolve([]) : db.dailySettled(14),
    // Feedback is optional engagement metadata, independent of settled metrics.
    dashboardOnly ? Promise.resolve(undefined) : db.getFeedbackStats().catch(() => undefined),
    dashboardOnly ? Promise.resolve(undefined) : db.activationFunnel(30).catch(() => undefined),
  ]);
  // Display identity only: retain every original payment/source/wallet and amount.
  const namesById = new Map(sources.map(source => [source.id, source.name]));
  const namedLeaderboard = leaderboard.map(row => ({
    ...row,
    sourceName: (!row.sourceName || row.sourceName === row.sourceId)
      ? namesById.get(row.sourceId) || row.sourceName || row.sourceId : row.sourceName,
  }));
  const sourceLeaderboard = await loadSourceLeaderboard(db, { sources, earnings: namedLeaderboard, network: config.networkId });
  const dashboard = {
    usage: { endpoint: "/api/usage", page: "/usage", classification: "outside/team/scripted/unknown", unclassifiedIsOutside: false },
    metricsScope: { cohort: "mixed-all-origins", period: "all-time", network: "not-row-partitioned",
      countingRule: "Existing recorded activity totals; not outside-user traction. Use /api/usage for explicit network/period/cohort figures." },
    metrics,
    leaderboard: namedLeaderboard,
    sourceLeaderboard,
  };
  // The explicit dashboard view uses fresh ledger reads without waiting for
  // engagement, chart, or archive data that this consumer never displays.
  if (dashboardOnly) return Response.json(dashboard);
  const tagsById = new Map(sources.map((s) => [s.id, (s.tags ?? []).slice(0, 3)]));
  const topics = topicBreakdown(payments, tagsById);
  let historicalArchive;
  try {
    const archive = await getTestnetArchive();
    historicalArchive = archive ? { status: "available", info: archive.info, summary: await archive.summary() } : { status: "not-configured" };
  } catch { historicalArchive = { status: "unavailable" }; }
  return Response.json({
    ...dashboard,
    historicalArchive,
    metrics: {
      ...metrics,
      satisfactionRate: feedback?.rate,
      feedbackTotal: feedback?.total,
      activationFunnel,
    },
    topics,
    dailySettled,
  });
}
