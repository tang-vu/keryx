/** GET /api/payments?limit=50 → recent attempts; unavailable reads return503, not empty history. */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { publicFinancialPayment } from "@/lib/run-privacy/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams, raw = params.get("limit");
  if (params.getAll("limit").length > 1 || raw !== null && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))))
    return Response.json({ error: "invalid_limit" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const limit = raw === null ? 50 : Math.min(200, Number(raw));
  try {
    const db = await getDb();
    const payments = await db.listPayments(limit);
    return Response.json({ payments:payments.map(publicFinancialPayment) },{headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({ error: "Payment history unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
