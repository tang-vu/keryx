/**
 * GET /answers/feed.xml — Atom feed of the public answer archive, so readers,
 * aggregators, and other agents can subscribe to new paid answers the moment
 * they settle. Same selection as /answers (real cited answers, one canonical
 * dispatch per question), same revalidation cadence.
 */

import { getDb } from "@/lib/db";
import { buildArchive } from "@/lib/answers-archive";
import { buildAnswersFeedXml } from "@/lib/answers-feed";

export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";

export async function GET(): Promise<Response> {
  let xml: string;
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(600);
    xml = buildAnswersFeedXml(buildArchive(runs), BASE);
  } catch {
    // DB unreachable (e.g. building with no local db) — serve a valid, empty feed.
    xml = buildAnswersFeedXml([], BASE);
  }
  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=600",
    },
  });
}
