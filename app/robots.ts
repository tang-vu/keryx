import type { MetadataRoute } from "next";

const BASE = process.env.BASE_URL || "https://keryx.cc";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
