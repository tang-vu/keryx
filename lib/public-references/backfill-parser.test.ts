import { describe, expect, it } from "vitest";
import { DISCOVERY_MAX_BYTES, parseArchiveHtml, parseDiscoveryXml, parseRobots, robotsAllows } from "./backfill-parser";

describe("publisher backfill discovery parsers", () => {
  it("combines matching crawler groups and prefers longest matches and allow ties", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /\nUser-agent: Keryx-FeedCheck\nDisallow: /private\nAllow: /private/public\nUser-agent: KERYX-FEEDCHECK\nDisallow: /download/*?secret=$\nAllow: /equal\nDisallow: /equal\nCrawl-delay: 3.5\nSitemap: https://publisher.test/maps.xml");
    expect(robotsAllows(robots, "https://publisher.test/story")).toBe(true);
    expect(robotsAllows(robots, "https://publisher.test/private/story")).toBe(false);
    expect(robotsAllows(robots, "https://publisher.test/private/public/story")).toBe(true);
    expect(robotsAllows(robots, "https://publisher.test/equal")).toBe(true);
    expect(robotsAllows(robots, "https://publisher.test/download/a?secret=")).toBe(false);
    expect(robotsAllows(robots, "https://publisher.test/download/a?secret=x")).toBe(true);
    expect(robots.delayMs).toBe(3500);
    expect(robots.sitemaps).toEqual(["https://publisher.test/maps.xml"]);
  });
  it("uses wildcard groups, normalizes UTF-8/unreserved octets, and keeps reserved octets distinct", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /caf%C3%A9\nDisallow: /~private\nDisallow: /encoded%2Fpath\nDisallow:");
    expect(robotsAllows(robots, "https://publisher.test/café")).toBe(false);
    expect(robotsAllows(robots, "https://publisher.test/%7Eprivate")).toBe(false);
    expect(robotsAllows(robots, "https://publisher.test/encoded/path")).toBe(true);
    expect(robotsAllows(robots, "https://publisher.test/encoded%2fpath")).toBe(false);
    expect(robotsAllows(robots, "https://publisher.test/robots.txt")).toBe(true);
  });
  it("reads actual Atom pagination and RFC5005 archive links without guessing URLs", () => {
    const result = parseDiscoveryXml(`<feed xmlns="http://www.w3.org/2005/Atom"><link rel="next" href="?page=2"/><link rel="prev-archive" href="/history.xml"/><entry><title>Old &amp; useful</title><link href="/old"/><published>2020-01-01T00:00:00Z</published><summary>Short</summary><content type="html">&lt;p&gt;An older article&lt;/p&gt;</content></entry></feed>`, "https://publisher.test/feed.xml");
    expect(result.pages).toEqual([{ url: "https://publisher.test/feed.xml?page=2", kind: "feed" }, { url: "https://publisher.test/history.xml", kind: "feed" }]);
    expect(result.articles[0]).toMatchObject({ url: "https://publisher.test/old", title: "Old & useful", content: "An older article", publishedAt: "2020-01-01T00:00:00.000Z" });
    expect(result.historical).toBe(true);
  });
  it("reads RSS CDATA without executing embedded markup", () => {
    const result = parseDiscoveryXml(`<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Archive</title><link>https://publisher.test/a</link><pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Public body</p><script>fetch('private')</script>]]></content:encoded></item></channel></rss>`, "https://publisher.test/rss.xml");
    expect(result.articles[0]).toMatchObject({ content: "Public body", publishedAt: "2020-01-01T00:00:00.000Z" });
    expect(result.historical).toBe(false);
  });
  it("reads sitemap indices and urlsets", () => {
    expect(parseDiscoveryXml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://publisher.test/old.xml</loc></sitemap></sitemapindex>`, "https://publisher.test/index.xml").pages).toEqual([{ kind: "sitemap", url: "https://publisher.test/old.xml" }]);
    expect(parseDiscoveryXml(`<urlset><url><loc>https://publisher.test/2012/article?a=1&amp;b=2</loc></url></urlset>`, "https://publisher.test/old.xml").articles).toEqual([{ url: "https://publisher.test/2012/article?a=1&b=2" }]);
  });
  it("refuses malformed XML, DTD/entities, unrelated XML, excessive depth and bytes", () => {
    for (const xml of ["<feed><entry></feed>", '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///secret">]><feed>&x;</feed>', "<not-a-feed/>", `<feed>${"<nest>".repeat(65)}${"</nest>".repeat(65)}</feed>`]) expect(() => parseDiscoveryXml(xml, "https://publisher.test/feed")).toThrow();
    expect(() => parseDiscoveryXml(" ".repeat(DISCOVERY_MAX_BYTES + 1), "https://publisher.test/feed")).toThrow("discovery-byte-limit");
  });
  it("discovers declared HTML archive links, then articles and next pages within main", () => {
    const landing = parseArchiveHtml(`<main><a href="/archive"><span>Article archive</span></a><a href="/new">Latest</a></main><script>fetch('/private')</script>`, "https://publisher.test/", true);
    expect(landing.pages).toEqual([{ kind: "page", url: "https://publisher.test/archive" }]);
    expect(landing.articles).toEqual([]);
    const archive = parseArchiveHtml(`<nav><a href="/account">Login</a></nav><main><article><a href="/2010/story"><span>Old story</span></a></article><a rel="next" href="/archive?page=2">Older</a></main>`, "https://publisher.test/archive", false);
    expect(archive.articles).toEqual([{ url: "https://publisher.test/2010/story", title: "Old story" }]);
    expect(archive.pages).toEqual([{ kind: "page", url: "https://publisher.test/archive?page=2" }]);
    expect(parseArchiveHtml('<div role="main"><div role="article"><a href="/2009/story">Oldest story</a></div></div>', "https://publisher.test/archive", false).articles).toEqual([{ url: "https://publisher.test/2009/story", title: "Oldest story" }]);
  });
  it("admits declared editorial landing indexes and rejects details/account/newsletter/off-origin links", () => {
    const discovery = parseArchiveHtml(`<nav>
      <a href="/articles/">Articles</a><a href="/en/weblog/index.html">Blog posts</a>
      <a href="/news">News</a><a href="/posts/">Posts</a>
      <a href="/articles/a-specific-article">Article detail</a><a href="/account/blog">Blog account</a>
      <a href="/newsletter">News</a><a href="/blog/">Newsletter</a>
      <a href="https://other.test/articles/">Articles</a>
    </nav>`, "https://publisher.test/", true);
    expect(discovery.pages).toEqual([
      { kind: "page", url: "https://publisher.test/articles/" },
      { kind: "page", url: "https://publisher.test/en/weblog/index.html" },
      { kind: "page", url: "https://publisher.test/news" },
      { kind: "page", url: "https://publisher.test/posts/" },
    ]);
    expect(discovery.articles).toEqual([]);
  });
});
