import { describe, expect, it } from "vitest";
import { APPROVED_PUBLIC_REFERENCES } from "./approved-catalog";
import { EXPLORE_SOURCES } from "./explore-catalog";

describe("audited public feed scopes", () => {
  it("keeps arXiv paper abstracts distinct from platform news and full paper evidence", () => {
    const news = APPROVED_PUBLIC_REFERENCES.find(reference => reference.id === "public:arxiv")!;
    const papers = APPROVED_PUBLIC_REFERENCES.find(reference => reference.id === "public:arxiv-cs-ai")!;
    expect(papers.rssUrl).toBe("https://rss.arxiv.org/rss/cs.AI");
    expect(papers.url).toBe("https://arxiv.org/list/cs.AI/recent");
    expect(papers.rssUrl).not.toBe(news.rssUrl);
    expect(papers.description).toMatch(/abstracts only, not full papers/);
    expect(papers.description).toMatch(/not evidence of peer review/);
    expect(news.rssUrl).toBe("https://blog.arxiv.org/feed/");
  });

  it("uses the working official Chrome endpoint and withholds feeds with no usable bodies or failed transport", () => {
    const chrome = APPROVED_PUBLIC_REFERENCES.find(reference => reference.id === "public:chrome-developers")!;
    expect(chrome.rssUrl).toBe("https://developer.chrome.com/static/blog/feed.xml");
    expect(APPROVED_PUBLIC_REFERENCES.some(reference => reference.rssUrl === "https://developer.chrome.com/feeds/blog.xml")).toBe(false);
    for (const id of ["hugging-face", "bair", "acm-queue", "jmlr"]) {
      expect(APPROVED_PUBLIC_REFERENCES.some(reference => reference.id === `public:${id}`)).toBe(false);
    }
    expect(EXPLORE_SOURCES.some(source => source.id === "explore:hugging-face")).toBe(true);
  });

  it("ships feed configuration without collected evidence or financial authority", () => {
    for (const reference of APPROVED_PUBLIC_REFERENCES) {
      expect(Object.keys(reference).sort()).toEqual([
        "active", "description", "id", "items", "name", "rssUrl", "tags", "url",
      ]);
      expect(reference.items).toEqual([]);
    }
  });
});
