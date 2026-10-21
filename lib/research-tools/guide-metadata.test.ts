import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/answers-archive-cache", () => ({ getArchiveCached: async () => [] }));
vi.mock("@/lib/wanted-board", () => ({ WANTED_DETAIL_LIMIT: 100, loadWantedBoard: async () => ({ open: [], filled: [] }) }));
vi.mock("@/lib/profiles/public-profile-loader", () => ({ publicProfileSitemap: async () => [] }));
vi.hoisted(() => { vi.stubEnv("BASE_URL", "https://keryx.cc"); });
afterAll(() => vi.unstubAllEnvs());

import sitemap from "@/app/sitemap";
import { findResearchGuide, GUIDE_PATHS, guideBreadcrumbs, researchGuideJsonLd, researchPageMetadata } from "./guide-metadata";
import { researchGuidesCopy as copy } from "@/locales/en/research-guides";

describe("public research guide discovery", () => {
  it("lists only shipped canonical guide/tool URLs in the sitemap with honest English alternates", async () => {
    const routes = await sitemap();
    for (const path of GUIDE_PATHS) {
      const route = routes.find(route => route.url === `https://keryx.cc${path}`)!;
      expect(route).toBeDefined();
      expect(route.alternates?.languages).toEqual({ en: route.url, "x-default": route.url });
    }
    expect(findResearchGuide("does-not-exist")).toBeUndefined();
    expect(new Set(GUIDE_PATHS).size).toBe(GUIDE_PATHS.length);
  });

  it("uses the visible article text and linked sources without fabricated reviews or updates", () => {
    for (const guide of copy.guides) {
      const schema = researchGuideJsonLd(guide);
      expect(schema.headline).toBe(guide.title);
      expect(schema.articleBody).toContain(guide.summary);
      for (const section of guide.sections) {
        expect(schema.articleBody).toContain(section.title);
        for (const paragraph of section.paragraphs) expect(schema.articleBody).toContain(paragraph);
      }
      expect(schema.citation.every(url => url?.startsWith("https://"))).toBe(true);
      expect(schema).not.toHaveProperty("dateModified");
      expect(schema).not.toHaveProperty("aggregateRating");
      const metadata = researchPageMetadata(`/guides/${guide.slug}`, guide.title, guide.description);
      expect(metadata.alternates?.canonical).toBe(`/guides/${guide.slug}`);
    }
    expect(guideBreadcrumbs(copy.tool.title).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Keryx", item: "https://keryx.cc/" },
      { "@type": "ListItem", position: 2, name: copy.navigation, item: "https://keryx.cc/guides" },
      { "@type": "ListItem", position: 3, name: copy.tool.title },
    ]);
  });
});
