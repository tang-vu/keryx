import { describe, it, expect } from "vitest";
import { parseFeedList, sanitizeFeedUrls, MAX_BULK_FEEDS } from "./feed-list";

describe("parseFeedList", () => {
  it("splits a newline/comma list and trims each entry", () => {
    expect(parseFeedList("https://a.com/feed\n https://b.com/rss ,https://c.com/x")).toEqual([
      "https://a.com/feed",
      "https://b.com/rss",
      "https://c.com/x",
    ]);
  });

  it("returns [] for empty or whitespace input", () => {
    expect(parseFeedList("   \n  ")).toEqual([]);
  });

  it("extracts every xmlUrl from an OPML export", () => {
    const opml = `<?xml version="1.0"?><opml version="2.0"><body>
      <outline text="One" type="rss" xmlUrl="https://one.com/feed.xml"/>
      <outline text="Two" type="rss" xmlUrl='https://two.com/rss'/>
    </body></opml>`;
    expect(parseFeedList(opml)).toEqual([
      "https://one.com/feed.xml",
      "https://two.com/rss",
    ]);
  });

  it("does not mistake a plain URL containing < for OPML", () => {
    expect(parseFeedList("https://blog.com/feed")).toEqual(["https://blog.com/feed"]);
  });
});

describe("sanitizeFeedUrls", () => {
  it("keeps only http(s) URLs", () => {
    expect(
      sanitizeFeedUrls(["https://a.com", "ftp://b.com", "not-a-url", "http://c.com"]),
    ).toEqual(["https://a.com", "http://c.com"]);
  });

  it("dedupes case-insensitively, preserving first-seen order", () => {
    expect(sanitizeFeedUrls(["https://A.com/Feed", "https://a.com/feed", "https://b.com"])).toEqual([
      "https://A.com/Feed",
      "https://b.com",
    ]);
  });

  it("caps at the max", () => {
    const many = Array.from({ length: MAX_BULK_FEEDS + 5 }, (_, i) => `https://s${i}.com`);
    expect(sanitizeFeedUrls(many)).toHaveLength(MAX_BULK_FEEDS);
  });

  it("returns [] for a non-array or non-string entries", () => {
    expect(sanitizeFeedUrls("https://a.com")).toEqual([]);
    expect(sanitizeFeedUrls([1, null, {}])).toEqual([]);
  });
});
