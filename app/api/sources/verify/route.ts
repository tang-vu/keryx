/**
 * POST /api/sources/verify — prove feed ownership so a source can start earning.
 *   body: { sourceId }   requires a valid SIWE session.
 *
 * Flow: the registrant places `keryx-verify:<their-payout-wallet>` anywhere in the feed, then
 * calls this route. The server re-fetches the feed and checks the token is present. Because the
 * token carries the payout wallet and only the feed's owner can edit the feed, an impostor who
 * listed a feed they don't own can never satisfy this — so they can never flip `verified` and
 * never reach the agent's money path (see lib/agent/run-agent.ts discovery gate).
 *
 * Ownership: the caller's session wallet must equal the source's payout wallet. That binds the
 * proof to the wallet that will actually receive the tolls/rewards, closing the replay angle
 * (a token copied from elsewhere proves control of a different wallet, which we reject here).
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { feedContainsToken, verificationToken } from "@/lib/sources/feed-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  if (!sourceId) {
    return Response.json({ error: "sourceId required" }, { status: 400 });
  }

  const db = await getDb();
  const source = await db.getSource(sourceId);
  if (!source) {
    return Response.json({ error: "source not found" }, { status: 404 });
  }

  // Only the wallet that receives this source's payouts may verify it.
  if (source.walletAddress.toLowerCase() !== session.address.toLowerCase()) {
    return Response.json({ error: "not the source's payout wallet" }, { status: 403 });
  }

  if (source.verified) {
    return Response.json({ verified: true, alreadyVerified: true });
  }

  // Feed to check: an RSS-listed source carries rssUrl; on-chain rows fall back to the canonical url.
  const feedUrl = source.rssUrl || source.url;
  if (!feedUrl) {
    return Response.json(
      { error: "this source has no feed to verify against", token: verificationToken(source.walletAddress) },
      { status: 400 },
    );
  }

  const present = await feedContainsToken(feedUrl, source.walletAddress);
  if (!present) {
    return Response.json({
      verified: false,
      token: verificationToken(source.walletAddress),
      message: "Verification token not found in the feed yet. Add the exact line, let the feed publish, then retry.",
    });
  }

  await db.upsertSource({ ...source, verified: true });
  return Response.json({ verified: true });
}
