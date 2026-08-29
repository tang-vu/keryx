/** Testnet economics observer. All money is ledger-derived; all pricing projections are labeled. */

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  return Response.json(await db.economics(), {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
