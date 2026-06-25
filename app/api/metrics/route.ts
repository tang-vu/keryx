/** GET /api/metrics → dashboard aggregate metrics + creator leaderboard + most-cited topics. */

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Derive "most-cited topics" from real data: every citation payment is mapped
 * to its source's tags, and each citation contributes one unit split evenly
 * across that source's tags. Only returned once there is genuine signal (≥3
 * distinct topics), so the dashboard panel stays hidden until it's meaningful.
 */
function topicBreakdown(
  payments: { kind: string; sourceId: string }[],
  tagsById: Map<string, string[]>,
): { name: string; pct: number }[] {
  const tally = new Map<string, number>();
  for (const p of payments) {
    if (p.kind !== "citation") continue;
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

export async function GET() {
  const db = await getDb();
  const [metrics, leaderboard, payments, sources, dailySettled, feedback] = await Promise.all([
    db.metrics(),
    db.creatorLeaderboard(),
    db.listPayments(1000),
    db.listSources(),
    db.dailySettled(14),
    db.getFeedbackStats(),
  ]);
  const tagsById = new Map(sources.map((s) => [s.id, (s.tags ?? []).slice(0, 3)]));
  const topics = topicBreakdown(payments, tagsById);
  return Response.json({
    metrics: { ...metrics, satisfactionRate: feedback.rate, feedbackTotal: feedback.total },
    leaderboard,
    topics,
    dailySettled,
  });
}
