/** Creator-authorized listing discovery. Returns public links only; alert settings and
 * earnings remain in /api/me/sources under payout/author ownership. */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { discoverCreatorListings, ListingDiscoveryError } from "@/lib/creator/discover-listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const db = await getDb();
  const cursor = req.nextUrl.searchParams.get("cursor");
  if (cursor !== null && cursor.length > 256) {
    return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  }
  try {
    const page = await discoverCreatorListings(await db.listAllSources(), session.address, cursor);
    return NextResponse.json({
      listings: page.listings.map((source) => ({
        id: source.id,
        name: source.name,
        active: source.active !== false,
      })),
      nextCursor: page.nextCursor,
      uncertain: page.uncertain,
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (error instanceof ListingDiscoveryError) {
      return NextResponse.json({ error: error.publicMessage }, { status: 409 });
    }
    throw error;
  }
}
