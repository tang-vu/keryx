import type { MetadataRoute } from "next";

const BASE = process.env.BASE_URL || "https://keryx.cc";

/**
 * Crawl policy.
 *
 * The whole public site is open — the archive and the registry exist to be indexed, and AI
 * crawlers are explicitly welcome: Keryx's argument is that a machine reading a writer should pay
 * them, and blocking the machines would make that argument in the wrong direction.
 *
 * What's closed is everything with nothing to rank: JSON endpoints, the signed-in dashboards, and
 * the widget's iframe target, which is the ask box stripped of the page around it — indexed, it
 * would compete with the real pages for the same terms. /api/agent/ask stays open on purpose:
 * it's the documented door for agents, advertised from llms.txt, and a longer Allow rule wins
 * over the shorter Disallow.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/agent/ask"],
        disallow: ["/api/", "/me/", "/embed"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
