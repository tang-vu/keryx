import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { buildArchive } from "@/lib/answers-archive";
import { buildTopics } from "@/lib/answers-topics";

const BASE = process.env.BASE_URL || "https://keryx.cc";

// Regenerate hourly so newly-settled dispatches enter the sitemap without a redeploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/answers`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/sources`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/dashboard`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/register`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/dev`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/status`, changeFrequency: "daily", priority: 0.5 },
    { url: `${BASE}/connect`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/privacy`, changeFrequency: "monthly", priority: 0.3 },
  ];

  // Enumerate only the canonical dispatch per question — buildArchive already
  // dedupes, so the sitemap never advertises near-duplicate answer pages.
  let answerRoutes: MetadataRoute.Sitemap = [];
  // Topic hubs: the corpus's own structure, derived from the questions, so they enter the sitemap
  // as the archive grows a new beat — no hand-maintained category list to fall behind.
  let topicRoutes: MetadataRoute.Sitemap = [];
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(600);
    const archive = buildArchive(runs);
    answerRoutes = archive.map((e) => ({
      url: `${BASE}/dispatch/${e.id}`,
      lastModified: new Date(e.createdAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));
    topicRoutes = buildTopics(archive).map((t) => ({
      url: `${BASE}/answers/topic/${t.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    // DB unreachable (e.g. at build with no local db) — ship the static routes.
  }

  return [...staticRoutes, ...topicRoutes, ...answerRoutes];
}
