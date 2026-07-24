/**
 * POST /api/me/sources/[id]/refresh — owner-triggered feed re-ingest.
 *
 * Registration reads a feed exactly once; this lets the creator pull in posts published
 * since ("I just published — make it purchasable now"), without waiting for the periodic
 * sweep. Adds only items the DB has never seen (deduped by link); metadata is untouched.
 *
 * SIWE session only, like the rest of /api/me — refreshing costs an outbound fetch of the
 * creator's feed host, so the limiter is keyed by SOURCE, not caller: it costs the same
 * whoever clicks, and one hot button must not hammer someone's blog.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ownsSource } from "@/lib/sources/source-ownership";
import { refreshSourceFeed } from "@/lib/ingest/refresh-feed";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return NextResponse.json({ error: "source not found" }, { status: 404 });
  if (!ownsSource(source, session.address)) {
    return NextResponse.json({ error: "not your source" }, { status: 403 });
  }
  if (source.active === false) {
    return NextResponse.json({ error: "This source is delisted." }, { status: 409 });
  }
  if (!source.rssUrl?.trim()) {
    return NextResponse.json({ error: "This source has no feed to refresh." }, { status: 409 });
  }

  const limited = await checkRateLimit(`feed-refresh:${id}`, "feedRefresh", {
    code: "refresh throttled",
    message: "This feed was just checked — give it a minute.",
  });
  if (limited) return limited;

  const result = await refreshSourceFeed(db, source);
  if (result.error) {
    return NextResponse.json(
      { error: "feed refresh failed", message: result.error },
      { status: 502 },
    );
  }
  return NextResponse.json({ added: result.added, total: result.total });
}
