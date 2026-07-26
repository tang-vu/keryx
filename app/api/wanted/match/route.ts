/**
 * POST /api/wanted/match — read a feed nobody has listed, and say which open claims it answers.
 *
 *   { rssUrl } → { feed: { title, link, posts }, gapsChecked, judged, matches: [...] }
 *
 * The demand board's whole argument is that listing a source is worth the trouble, and until now it
 * asked a writer to establish that for themselves by reading a page of sentences. This does the
 * comparison for them, against their real feed, with no wallet, no signature and nothing written
 * down: the request reads the feed, puts its posts to the same judge the board is built from, and
 * forgets both.
 *
 * Deliberately anonymous, which is the whole risk model here — the caller picks an address this
 * server will connect to, and gets a reasoning call for free. `fetchPublicText` vets every hop
 * before the socket opens; the rate limit is keyed by IP and tighter than the public read tier;
 * the judged material is capped well below the ask path's.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildBoard } from "@/lib/demand-signal";
import { judgeFeedAgainstGaps } from "@/lib/demand-match-judge";
import { ingestRssXml } from "@/lib/ingest/rss";
import { getReasoningEngine } from "@/lib/llm";
import { fetchPublicText, UnsafeTargetError } from "@/lib/net/public-fetch";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_RUNS = 400;
/** Deeper than the page shows: a writer's beat may sit well below the loudest holes. */
const BOARD_LIMIT = 40;
const MAX_POSTS = 20;

export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(clientIp(req), "feedProbe");
  if (blocked) return blocked;

  let rssUrl: string;
  try {
    const body = (await req.json()) as { rssUrl?: unknown };
    rssUrl = typeof body.rssUrl === "string" ? body.rssUrl.trim() : "";
  } catch {
    return NextResponse.json({ error: "send { rssUrl }" }, { status: 400 });
  }
  if (!rssUrl) return NextResponse.json({ error: "send { rssUrl }" }, { status: 400 });
  if (rssUrl.length > 2048) {
    return NextResponse.json({ error: "that URL is too long" }, { status: 400 });
  }

  // Read the feed first: a bad URL is the common case and should not cost a board build.
  let feed;
  try {
    feed = await ingestRssXml(await fetchPublicText(rssUrl), rssUrl, MAX_POSTS);
  } catch (err) {
    const message =
      err instanceof UnsafeTargetError
        ? err.message
        : "that address did not return a feed Keryx could read";
    return NextResponse.json({ error: "feed unreadable", message }, { status: 400 });
  }
  if (feed.items.length === 0) {
    return NextResponse.json(
      { error: "feed unreadable", message: "that feed has no posts in it" },
      { status: 400 },
    );
  }

  let open;
  try {
    const db = await getDb();
    open = buildBoard(await db.listRecentQueries(WINDOW_RUNS), { limit: BOARD_LIMIT }).open;
  } catch {
    return NextResponse.json({ error: "demand board unavailable" }, { status: 503 });
  }

  const verdict = await judgeFeedAgainstGaps(open, feed.items, getReasoningEngine(), {
    title: feed.feedTitle,
    description: feed.feedDescription,
  });

  return NextResponse.json({
    feed: { title: feed.feedTitle, link: feed.link, posts: feed.items.length },
    gapsChecked: open.length,
    // How the call was reached, because it changes what everything under it means: the agent's own
    // buy/skip decision, or vocabulary overlap standing in for it while a provider is down.
    judged: verdict.judged,
    wouldBuy: verdict.wouldBuy,
    rationale: verdict.rationale,
    expectedValue: verdict.expectedValue,
    matches: verdict.matches.map((m) => ({
      claim: m.gap.claim,
      coverage: m.gap.coverage,
      seen: m.gap.seen,
      queryId: m.gap.queryId,
      question: m.gap.question,
      shared: m.shared,
      ...(m.post ? { post: { title: m.post.title, link: m.post.link ?? "" } } : {}),
    })),
  });
}
