/**
 * GET  /api/keys  — list all API keys for the SIWE-authenticated wallet.
 * POST /api/keys  — mint a new key (raw value shown once; SIWE-gated).
 *
 * Keys are identity + rate-limit only. Callers still pay via x402 on every /api/agent/ask call.
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { mintApiKey } from "@/lib/api-keys";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const db = await getDb();
  const keys = await db.listApiKeys(session.address);
  // Strip wallet from the returned list — caller knows their own address.
  return Response.json(
    keys.map(({ wallet: _w, ...k }) => k),
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { label?: string };
  const label = typeof body.label === "string" ? body.label.slice(0, 80) : undefined;

  const { rawKey, prefix, id } = await mintApiKey(session.address, label);

  return Response.json({ rawKey, prefix, id });
}
