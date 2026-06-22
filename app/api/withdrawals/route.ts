/** GET /api/withdrawals?limit=20 → recent creator cash-outs (on-chain Gateway withdraws).
 *  Each row carries a real EVM mint tx hash that resolves at the explorer /tx/ — unlike the
 *  per-payment Circle settlement UUIDs in /api/payments. */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(
    100,
    parseInt(new URL(req.url).searchParams.get("limit") ?? "20", 10) || 20,
  );
  const db = await getDb();
  const withdrawals = await db.listWithdrawals(limit);
  return Response.json({ withdrawals });
}
