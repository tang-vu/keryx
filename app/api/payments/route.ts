/** GET /api/payments?limit=50 → recent settled/simulated payments (live feed). */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(
    200,
    parseInt(new URL(req.url).searchParams.get("limit") ?? "50", 10) || 50,
  );
  const db = await getDb();
  const payments = await db.listPayments(limit);
  return Response.json({ payments });
}
