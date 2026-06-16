import type { MetadataRoute } from "next";

const BASE = process.env.BASE_URL || "https://keryx.cc";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/dashboard`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/register`, changeFrequency: "weekly", priority: 0.7 },
  ];
}
