/**
 * DELETE /api/keys/[id]  — revoke an API key.
 *
 * Ownership check is enforced at the DB level: revokeApiKey(id, wallet) only soft-deletes
 * if the row's wallet matches the session wallet. Returns 200 regardless (idempotent soft-delete).
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  const db = await getDb();
  await db.revokeApiKey(id, session.address);

  return Response.json({ ok: true });
}
