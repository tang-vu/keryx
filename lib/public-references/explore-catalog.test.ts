import { describe, expect, it } from "vitest";
import { APPROVED_PUBLIC_REFERENCES } from "./approved-catalog";
import { publicReferenceSchema } from "./catalog";
import { EXPLORE_SOURCES, EXPLORE_SOURCE_TOPICS } from "./explore-catalog";

function expectPublicHttps(raw: string) {
  const url = new URL(raw);
  expect(url.protocol).toBe("https:");
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  expect(url.hostname).not.toMatch(/^(localhost|127\.|0\.|10\.|192\.168\.|\[)/);
}

describe("publisher directory and approved feed boundaries", () => {
  it("keeps directory links unique, credential-free and separate from retained evidence", () => {
    expect(new Set(EXPLORE_SOURCES.map((entry) => entry.id)).size).toBe(EXPLORE_SOURCES.length);
    expect(new Set(EXPLORE_SOURCES.map((entry) => new URL(entry.url).href)).size).toBe(EXPLORE_SOURCES.length);
    expect(new Set(EXPLORE_SOURCES.map((entry) => entry.topic))).toEqual(new Set(Object.keys(EXPLORE_SOURCE_TOPICS)));
    for (const entry of EXPLORE_SOURCES) {
      expect(entry.id).toMatch(/^explore:[a-z0-9-]+$/);
      expectPublicHttps(entry.url);
      expect(entry.name.trim()).not.toBe("");
      expect(entry.description.trim()).not.toBe("");
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(Object.keys(entry).sort()).toEqual(["description", "id", "name", "tags", "topic", "url"]);
      // A browsable publisher link cannot be supplied as retained public evidence.
      expect(publicReferenceSchema.safeParse(entry).success).toBe(false);
    }
  });

  it("admits only explicit feeds and preserves the previously approved source identities", () => {
    expect(APPROVED_PUBLIC_REFERENCES.slice(0, 5).map((entry) => entry.id)).toEqual([
      "public:super-simple-songs", "public:cloudflare-workers", "public:chip-huyen",
      "public:lilian-weng", "public:vicki-boykis",
    ]);
    expect(new Set(APPROVED_PUBLIC_REFERENCES.map((entry) => entry.id)).size).toBe(APPROVED_PUBLIC_REFERENCES.length);
    expect(new Set(APPROVED_PUBLIC_REFERENCES.map((entry) => new URL(entry.rssUrl).href)).size).toBe(APPROVED_PUBLIC_REFERENCES.length);
    for (const reference of APPROVED_PUBLIC_REFERENCES) {
      expectPublicHttps(reference.rssUrl);
      expect(publicReferenceSchema.safeParse(reference).success).toBe(true);
      expect(reference.active).toBe(true);
      expect(reference.items).toEqual([]);
      expect(reference.refreshedAt).toBeUndefined();
      expect(EXPLORE_SOURCES.find((entry) => entry.id === reference.id.replace(/^public:/, "explore:"))?.url).toBe(reference.url);
    }
    // These feeds failed the observed transport/content gate; their directory links stay browse-only.
    for (const id of ["hugging-face", "nodejs", "simon-willison", "kubernetes", "github", "vercel", "crossref", "hamel-husain"])
      expect(APPROVED_PUBLIC_REFERENCES.some((entry) => entry.id === `public:${id}`)).toBe(false);
  });
});
