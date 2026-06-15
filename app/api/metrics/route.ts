/** GET /api/metrics → dashboard aggregate metrics + creator leaderboard. */

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const [metrics, leaderboard] = await Promise.all([
    db.metrics(),
    db.creatorLeaderboard(),
  ]);
  return Response.json({ metrics, leaderboard });
}
