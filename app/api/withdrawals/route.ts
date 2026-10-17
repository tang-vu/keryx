/** GET /api/withdrawals?limit=20 → recent creator cash-outs (on-chain Gateway withdraws).
 *  Each row carries a real EVM mint tx hash that resolves at the explorer /tx/ — unlike the
 *  per-payment Circle settlement UUIDs in /api/payments. */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams, raw = params.get("limit");
  if (params.getAll("limit").length > 1 || raw !== null && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))))
    return Response.json({ error: "invalid_limit" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const limit = raw === null ? 20 : Math.min(100, Number(raw));
  const db = await getDb();
  const withdrawals = await db.listWithdrawals(limit);
  return Response.json({ withdrawals });
}
