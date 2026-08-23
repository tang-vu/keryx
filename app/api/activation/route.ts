/**
 * Same-origin landing counter. The endpoint accepts one event and persists only UTC day + count;
 * it does not read cookies, IPs, wallet sessions, referrers, questions, or user-agent strings.
 */

import { getDb } from "@/lib/db";
import { recordActivationEvent } from "@/lib/activation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  if (!host || !origin) {
    return Response.json({ error: "same-origin request required" }, { status: 403 });
  }
  try {
    if (new URL(origin).host !== host) {
      return Response.json({ error: "origin mismatch" }, { status: 403 });
    }
  } catch {
    return Response.json({ error: "invalid origin" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { event?: unknown } | null;
  if (body?.event !== "reader_landing") {
    return Response.json({ error: "unsupported event" }, { status: 400 });
  }
  await recordActivationEvent(await getDb(), "reader_landing");
  return new Response(null, { status: 204 });
}
