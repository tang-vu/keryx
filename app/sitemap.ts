import type { MetadataRoute } from "next";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { buildTopics } from "@/lib/answers-topics";
import { answersPagePath, paginateArchive } from "@/lib/answers-pagination";
import { loadWantedBoard, WANTED_DETAIL_LIMIT } from "@/lib/wanted-board";

const BASE = process.env.BASE_URL || "https://keryx.cc";

// Regenerate hourly so newly-settled dispatches enter the sitemap without a redeploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/answers`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/sources`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/wanted`, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/dashboard`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/proof`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/register`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/dev`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/integrations/mcp`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/status`, changeFrequency: "daily", priority: 0.5 },
    { url: `${BASE}/connect`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/privacy`, changeFrequency: "monthly", priority: 0.3 },
  ];

  // The archive, built once and shared with the pages it describes (lib/answers-archive-cache) —
  // so the sitemap can never advertise a dispatch the index has already dropped, or miss one it
  // still links to. Entries are already deduped to one canonical dispatch per question, so this
  // never offers a crawler two URLs for the same answer.
  let answerRoutes: MetadataRoute.Sitemap = [];
  // Topic hubs: the corpus's own structure, derived from the questions, so they enter the sitemap
  // as the archive grows a new beat — no hand-maintained category list to fall behind.
  let topicRoutes: MetadataRoute.Sitemap = [];
  // The paginated index. Older answers are only reachable through these, so a crawler that never
  // gets past page 1 still finds every page listed here.
  let pageRoutes: MetadataRoute.Sitemap = [];
  let wantedRoutes: MetadataRoute.Sitemap = [];

  const archive = await getArchiveCached();
  if (archive.length > 0) {
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
    const { totalPages } = paginateArchive(archive, 1);
    for (let p = 2; p <= totalPages; p++) {
      pageRoutes.push({
        url: `${BASE}${answersPagePath(p)}`,
        changeFrequency: "weekly" as const,
        // Below the index, above an individual answer: these exist to be crawled through.
        priority: 0.7,
      });
    }
  }

  try {
    const wanted = await loadWantedBoard(WANTED_DETAIL_LIMIT);
    wantedRoutes = [...wanted.open, ...wanted.filled].map((gap) => ({
      url: `${BASE}/wanted/${gap.id}`,
      lastModified: new Date(gap.filledBy?.createdAt ?? gap.createdAt),
      changeFrequency: gap.filledBy ? ("monthly" as const) : ("daily" as const),
      priority: gap.filledBy ? 0.5 : 0.7,
    }));
  } catch {
    // The static sitemap remains valid if the live demand projection is briefly unavailable.
  }

  return [...staticRoutes, ...pageRoutes, ...topicRoutes, ...wantedRoutes, ...answerRoutes];
}
