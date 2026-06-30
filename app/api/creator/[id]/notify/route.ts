/**
 * Notify-on-citation webhook settings for a single source — owner-only.
 *
 *   GET    /api/creator/[id]/notify  → { configured, url } for the owner (secret never returned)
 *   POST   /api/creator/[id]/notify  → set/rotate the webhook; body { url }. Returns { url, secret }
 *                                       once. An empty/absent url disables (deletes) the webhook.
 *
 * Ownership is enforced against the live SIWE session: the caller must be the source's payout wallet
 * or one of its author wallets. This lets an already-registered (e.g. seeded) creator add or rotate
 * a webhook after the fact, not just at register time. The secret is the HMAC key for the
 * X-Keryx-Signature header on each delivery and is shown exactly once, like an API key.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDeliverableUrl, randomNotifySecret } from "@/lib/notify/citation-webhook";
import type { Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True when `addr` is the source's payout wallet or one of its author wallets. */
function ownsSource(source: Source, addr: string): boolean {
  const a = addr.toLowerCase();
  return (
    source.walletAddress.toLowerCase() === a ||
    source.authors.some((au) => au.walletAddress.toLowerCase() === a)
  );
}

async function loadOwned(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return { error: NextResponse.json({ error: "source not found" }, { status: 404 }) };
  if (!ownsSource(source, session.address)) {
    return { error: NextResponse.json({ error: "not your source" }, { status: 403 }) };
  }
  return { db, source };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;
  const notify = await owned.db.getSourceNotify(id);
  // Never echo the secret on read — only configured state + the URL the owner set.
  return NextResponse.json({ configured: Boolean(notify?.url), url: notify?.url ?? null });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";

  // Empty url = disable. Delete any existing webhook and report disabled.
  if (!url) {
    await owned.db.deleteSourceNotify(id);
    return NextResponse.json({ configured: false, url: null });
  }

  if (url.length > 2048 || !isDeliverableUrl(url)) {
    return NextResponse.json(
      { error: "url must be an absolute http(s) URL under 2048 chars" },
      { status: 400 },
    );
  }

  const secret = randomNotifySecret();
  await owned.db.setSourceNotify(id, url, secret);
  // Secret returned once — the owner stores it to verify X-Keryx-Signature on deliveries.
  return NextResponse.json({ configured: true, url, secret });
}
