/**
 * GET /api/keys/[id]/usage  — return daily call counts for a key.
 *
 * Ownership is verified: only the issuing wallet can read usage.
 * Returns 30 days by default. Used by the dev portal usage chart.
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const db = await getDb();

  // Verify ownership: only fetch usage for keys belonging to the session wallet.
  const keys = await db.listApiKeys(session.address);
  const owned = keys.find((k) => k.id === id);
  if (!owned) return Response.json({ error: "not found" }, { status: 404 });

  const usage = await db.getUsage(id, 30);
  return Response.json(usage);
}
