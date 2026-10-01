import Parser from "rss-parser";
import type { IngestedFeed } from "../ingest/rss";

export const SUPER_SIMPLE_CHANNEL_ID = "UCLsooMJoIpl_7ux2jvdPB-Q";
export const SUPER_SIMPLE_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${SUPER_SIMPLE_CHANNEL_ID}`;

/** Only the reviewed publisher feed is admitted; this is not a channel URL resolver. */
export function isApprovedYoutubeFeed(url: string): boolean {
  return url === SUPER_SIMPLE_FEED_URL;
}

interface YoutubeItem {
  title?: string; link?: string; id?: string; videoId?: string; channelId?: string;
  isoDate?: string; mediaGroup?: { "media:description"?: unknown[] };
}
const parser = new Parser<{ "yt:channelId"?: string }, YoutubeItem>({
  customFields: { feed: ["yt:channelId"], item: [
    ["yt:channelId", "channelId"], ["yt:videoId", "videoId"], ["media:group", "mediaGroup"],
  ] },
});

/** Publisher metadata only. Never emits community statistics or fetches video media/transcripts. */
export async function ingestYoutubeMetadata(xml: string, feedUrl: string): Promise<IngestedFeed> {
  if (!isApprovedYoutubeFeed(feedUrl) || Buffer.byteLength(xml, "utf8") > 500_000)
    throw new Error("Unapproved or oversized YouTube feed");
  const declarations = xml.replace(/<!--[\s\S]*?-->/g, "");
  const root = declarations.match(/<feed\s[^>]*>/)?.[0];
  if (!root || /<!DOCTYPE|<!ENTITY/i.test(xml) ||
      (declarations.match(/xmlns(?:\:[\w-]+)?\s*=/g) ?? []).length !== 3)
    throw new Error("Unexpected YouTube feed namespace or declaration");
  // rss-parser identifies prefixed field names; bind them at the root and refuse rebinding.
  for (const [name, value] of [["xmlns", "http://www.w3.org/2005/Atom"],
    ["xmlns:yt", "http://www.youtube.com/xml/schemas/2015"],
    ["xmlns:media", "http://search.yahoo.com/mrss/"]]) {
    if (!new RegExp(`${name}\\s*=\\s*[\"']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`).test(root))
      throw new Error("Unexpected YouTube feed namespace");
  }
  let feed;
  try { feed = await parser.parseString(xml); }
  catch { throw new Error("Malformed YouTube metadata feed"); }
  // YouTube currently omits the UC prefix in the root channelId, but includes it in entries.
  if (feed["yt:channelId"] !== SUPER_SIMPLE_CHANNEL_ID && feed["yt:channelId"] !== SUPER_SIMPLE_CHANNEL_ID.slice(2))
    throw new Error("YouTube feed channel mismatch");
  const seen = new Set<string>();
  const items: IngestedFeed["items"] = [];
  for (const item of feed.items) {
    const videoId = item.videoId;
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || item.channelId !== SUPER_SIMPLE_CHANNEL_ID ||
        item.id !== `yt:video:${videoId}` || item.link !== `https://www.youtube.com/watch?v=${videoId}` || seen.has(videoId)) continue;
    const title = item.title?.trim().slice(0, 1000);
    if (!title) continue;
    const rawDescription = item.mediaGroup?.["media:description"];
    const description = rawDescription?.length === 1 && typeof rawDescription[0] === "string"
      ? rawDescription[0].trim().slice(0, 10_000) : "";
    const parsedDate = item.isoDate ? new Date(item.isoDate) : undefined;
    const publishedAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : undefined;
    const content = ["Publisher-provided YouTube metadata; video content has not been reviewed.",
      `Title: ${title}`, `Video URL: ${item.link}`, ...(publishedAt ? [`Published: ${publishedAt}`] : []),
      description ? `Publisher description: ${description}` : "Publisher description: not supplied."].join("\n");
    items.push({ title, link: item.link, summary: description.slice(0, 280) || title,
      content, deliveryKind: "metadata_only", ...(publishedAt ? { publishedAt } : {}) });
    seen.add(videoId);
    if (items.length === 10) break;
  }
  return { feedTitle: feed.title?.slice(0, 200) || "Super Simple Songs - Kids Songs",
    feedDescription: "Publisher-provided video metadata only; no market or learning-quality assessment.",
    link: `https://www.youtube.com/channel/${SUPER_SIMPLE_CHANNEL_ID}`, items };
}
