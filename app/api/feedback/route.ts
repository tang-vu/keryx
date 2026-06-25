/**
 * POST /api/feedback — record thumbs up/down on a completed dispatch.
 * GET  /api/feedback?queryId=… — fetch feedback stats for a specific dispatch
 *      (omit queryId for global satisfaction rate).
 *
 * No auth required — feedback is anonymous engagement signal. Rate-limited
 * per IP to prevent vote spam.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(clientIp(req), "public");
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const queryId = body.queryId as string | undefined;
    const rating = body.rating as string | undefined;
    const comment = (body.comment as string | undefined) ?? undefined;

    if (!queryId || !rating) {
      return NextResponse.json({ error: "queryId and rating required" }, { status: 400 });
    }
    if (rating !== "up" && rating !== "down") {
      return NextResponse.json({ error: "rating must be 'up' or 'down'" }, { status: 400 });
    }

    const db = await getDb();
    await db.recordFeedback(queryId, rating, comment);

    // Return updated stats so the UI can reflect immediately
    const stats = await db.getFeedbackStats(queryId);
    return NextResponse.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const queryId = req.nextUrl.searchParams.get("queryId") ?? undefined;
    const db = await getDb();
    const stats = await db.getFeedbackStats(queryId);
    return NextResponse.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
