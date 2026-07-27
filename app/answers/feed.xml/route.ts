/**
 * GET /answers/feed.xml — Atom feed of the public answer archive, so readers,
 * aggregators, and other agents can subscribe to new paid answers the moment
 * they settle. Same selection as /answers (real cited answers, one canonical
 * dispatch per question), same revalidation cadence.
 */

import { getArchiveCached } from "@/lib/answers-archive-cache";
import { buildAnswersFeedXml } from "@/lib/answers-feed";

export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";

export async function GET(): Promise<Response> {
  // getArchiveCached never throws (a DB hiccup serves the last good copy, or nothing) and the
  // builder takes the newest few — see FEED_ENTRY_LIMIT.
  const xml = buildAnswersFeedXml(await getArchiveCached(), BASE);
  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=600",
    },
  });
}
