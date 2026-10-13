/**
 * GET /answers/feed.xml — Atom feed of the public answer archive, so readers,
 * aggregators, and other agents can subscribe to cited answers.
 * Same selection as /answers (cited answers, one canonical
 * dispatch per question), same revalidation cadence.
 */

import { getArchiveCached } from "@/lib/answers-archive-cache";
import { buildAnswersFeedXml } from "@/lib/answers-feed";
import { filterArchiveLanguage, parseArchiveLanguage } from "@/lib/answers-language";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE = process.env.BASE_URL || "https://keryx.cc";

export async function GET(request?: Request): Promise<Response> {
  // getArchiveCached never throws (a DB hiccup serves the last good copy, or nothing) and the
  // builder takes the newest few — see FEED_ENTRY_LIMIT.
  const languages = request ? new URL(request.url).searchParams.getAll("language") : [];
  const language = parseArchiveLanguage(languages.length === 1 ? languages[0] : null);
  const xml = buildAnswersFeedXml(filterArchiveLanguage(await getArchiveCached(), language), BASE, language);
  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
