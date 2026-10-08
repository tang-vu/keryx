import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sourceRecencyPublicationDate } from "./source-recency-feed-date";
import { parseSourceRecencyFeed, SOURCE_RECENCY_FEED_LIMITS } from "./source-recency-feed-parser";
import { recencyAtomEntry, recencyAtomFeed, recencyRssFeed, recencyRssItem } from "./source-recency-feed-fixtures";

describe("native feed membership and provenance", () => {
  it("preserves all entries, native identifiers, date roles, raw dates and exact entry hashes", async () => {
    const entry = recencyAtomEntry("new", " 2026-10-07T12:00:00+01:00 ", "<updated>2026-10-08T10:00:00Z</updated>");
    const parsed = await parseSourceRecencyFeed(recencyAtomFeed(recencyAtomEntry("old", "2026-09-01T00:00:00Z") + entry));
    expect(parsed).toMatchObject({ format: "atom", nativeFeedId: "urn:feed:releases", membership: "complete-document", filteredCount: 0, truncated: false });
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[1]).toMatchObject({ position: 1, nativeId: { field: "atom:id", rawValue: "urn:release:new" },
      publication: { field: "atom:published", rawValues: [" 2026-10-07T12:00:00+01:00 "], status: "valid", publishedAt: "2026-10-07T11:00:00.000Z" },
      updatedRawValues: ["2026-10-08T10:00:00Z"],
      entryMetadataVersion: `sha256:${createHash("sha256").update(entry).digest("hex")}` });
    expect(Object.isFrozen(parsed.entries[1].publication.rawValues)).toBe(true);
  });
  it("preserves missing, invalid and multiple dates without filtering or updated fallback", async () => {
    const parsed = await parseSourceRecencyFeed(recencyAtomFeed(recencyAtomEntry("edited", "", "<updated>2026-10-07T00:00:00Z</updated>") +
      recencyAtomEntry("invalid", "2026-02-30T00:00:00Z") + recencyAtomEntry("ambiguous", undefined, "<published>2026-10-06T00:00:00Z</published>")));
    expect(parsed.entries.map(e => e.publication.status)).toEqual(["missing", "invalid", "ambiguous"]);
    expect(parsed.entries[0].publication.publishedAt).toBeUndefined();
    expect(parsed.entries[0].updatedRawValues).toEqual(["2026-10-07T00:00:00Z"]);
  });
  it("keeps exact entry hashes with Unicode, CDATA and XML entity text across parse chunks", async () => {
    const entry = recencyAtomEntry("unicode").replace("Release unicode", "<![CDATA[Bản phát hành 🇻🇳 😀]]> &amp; résumé");
    const parsed = await parseSourceRecencyFeed(recencyAtomFeed("<!--" + "😀".repeat(2100) + "-->" + entry));
    expect(parsed.entries[0].title).toBe("Bản phát hành 🇻🇳 😀 & résumé");
    expect(parsed.entries[0].entryMetadataVersion).toBe(`sha256:${createHash("sha256").update(entry).digest("hex")}`);
  });
  it("accepts exactly 1000 complete members without filtering an empty member", async () => {
    const entries = Array.from({ length: 999 }, (_, i) => recencyRssItem(String(i))).join("") + "<item/>";
    const parsed = await parseSourceRecencyFeed(recencyRssFeed(entries));
    expect(parsed.entries).toHaveLength(1000);
    expect(parsed.entries[999]).toMatchObject({ position: 999, publication: { status: "missing" } });
    expect(parsed.entries[999].issues).toContain("entry-link-unqualified");
    expect(parsed.filteredCount).toBe(0);
  });
  it("retains RSS pubDate rather than extension dates", async () => {
    const parsed = await parseSourceRecencyFeed(recencyRssFeed(recencyRssItem("new", undefined, '<dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">2026-10-08</dc:date>')));
    expect(parsed.entries[0]).toMatchObject({ nativeId: { field: "rss:guid", rawValue: "release:new" },
      publication: { field: "rss:pubDate", rawValues: ["Wed, 07 Oct 2026 12:00:00 GMT"], status: "valid" } });
  });
  it("binds Atom namespace identity rather than lexical prefixes", async () => {
    const xml = '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:id>urn:a</a:id><a:title>A</a:title><a:link href="https://example.test/a"/><a:published>2026-10-07T12:00:00Z</a:published></a:entry></a:feed>';
    expect((await parseSourceRecencyFeed(xml)).entries[0].publication.status).toBe("valid");
    const forged = await parseSourceRecencyFeed(recencyAtomFeed(recencyAtomEntry("x", "").replace("</entry>", '<fake:published xmlns:fake="urn:forged">2026-10-07T12:00:00Z</fake:published></entry>')));
    expect(forged.entries[0].publication.status).toBe("missing");
  });
  it.each([
    '<!DOCTYPE feed [<!ENTITY x "boom">]><feed xmlns="http://www.w3.org/2005/Atom"/>',
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry></feed>',
    '<feed xmlns="urn:forged"><entry/></feed>',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>',
    '<?xml version="1.0" encoding="UTF-16"?><rss version="2.0"><channel/></rss>',
    recencyAtomFeed(recencyAtomEntry("x"), '<link rel="next" href="https://example.test/page2"/>'),
    recencyAtomFeed(recencyAtomEntry("x"), '<link rel="http://www.iana.org/assignments/relation/next" href="https://example.test/page2"/>'),
    recencyAtomFeed(recencyAtomEntry("x"), '<link rel="http://www.iana.org/assignments/relation/previous" href="https://example.test/page0"/>'),
    recencyAtomFeed(recencyAtomEntry("x"), '<link rel="next-archive" href="https://example.test/archive"/>'),
    recencyAtomFeed(recencyAtomEntry("x"), '<archive xmlns="http://purl.org/syndication/history/1.0"/>'),
    recencyAtomFeed(recencyAtomEntry("x"), '<link rel="https://www.iana.org/assignments/relation/next" href="https://example.test/page2"/>'),
    recencyAtomFeed(recencyAtomEntry("x").replace('link href=', 'link rel="" href=')),
    recencyAtomFeed(recencyAtomEntry("x"), '<deleted-entry xmlns="http://purl.org/atompub/tombstones/1.0" ref="urn:gone"/>'),
    recencyAtomFeed(recencyAtomEntry("x")).replace('<feed ', '<feed xml:base="https://example.test/" '),
    recencyAtomFeed(`<extension>${recencyAtomEntry("hidden")}</extension>`),
    recencyRssFeed("") .replace('</rss>', '<channel/></rss>'),
    recencyRssFeed("").replace('</rss>', `<x:channel xmlns:x="urn:foreign">${recencyRssItem("forged-new")}</x:channel></rss>`),
    recencyAtomFeed(recencyAtomEntry("x").replace("Release x", "<b>Release x</b>")),
  ])("refuses unqualified structures instead of claiming complete membership: %s", async xml => {
    await expect(parseSourceRecencyFeed(xml)).rejects.toThrow();
  });
  it("refuses the 1001st member instead of returning a newest-first prefix", async () => {
    await expect(parseSourceRecencyFeed(recencyAtomFeed(Array.from({ length: 1001 }, (_, i) => recencyAtomEntry(String(i))).join("")))).rejects.toThrow("feed-item-limit");
  });
  it("binds normative full-form alternate and self relation IRIs", async () => {
    const parsed = await parseSourceRecencyFeed(recencyAtomFeed(recencyAtomEntry("x").replace('link href=', 'link rel="http://www.iana.org/assignments/relation/alternate" href='))
      .replace('rel="self"', 'rel="http://www.iana.org/assignments/relation/self"'));
    expect(parsed.entries[0].itemUrl).toBe("https://publisher.example.test/x");
    expect(parsed.declaredSelfUrls).toEqual(["https://feeds.example.test/releases.xml"]);
  });
  it("enforces byte, depth, node and field limits", async () => {
    await expect(parseSourceRecencyFeed(" ".repeat(SOURCE_RECENCY_FEED_LIMITS.maxBytes + 1))).rejects.toThrow("feed-byte-limit");
    await expect(parseSourceRecencyFeed(recencyAtomFeed("<x>".repeat(33) + "</x>".repeat(33)))).rejects.toThrow("feed-structure-limit");
    await expect(parseSourceRecencyFeed(recencyAtomFeed("<x/>".repeat(20_001)))).rejects.toThrow("feed-node-limit");
    await expect(parseSourceRecencyFeed(recencyAtomFeed(recencyAtomEntry("x").replace("Release x", "x".repeat(2001))))).rejects.toThrow("feed-field-limit");
  });
  it("cancels between bounded parse chunks", async () => {
    const ctrl = new AbortController();
    const pending = parseSourceRecencyFeed(recencyAtomFeed("<x/>".repeat(10_000)), ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("native publication date qualification", () => {
  it.each(["2026-02-30T12:00:00Z", "2026-01-01", "2026-01-01T25:00:00Z", "1969-01-01T00:00:00Z", "2026-01-01T00:00:00", "2026-01-01T00:00:00.1234Z"])("refuses invalid/uncertain Atom date %s", raw => {
    expect(sourceRecencyPublicationDate("atom:published", raw)).toBeNull();
  });
  it.each(["Mon, 07 Oct 2026 12:00:00 GMT", "30 Feb 2026 12:00:00 GMT", "07 Oct 2026 12:00:00", "07 Oct 2026 12:00:00 EST"])("refuses invalid/uncertain RSS date %s", raw => {
    expect(sourceRecencyPublicationDate("rss:pubDate", raw)).toBeNull();
  });
  it("normalizes RSS numeric offsets and Atom offsets without discarding their native role", () => {
    expect(sourceRecencyPublicationDate("rss:pubDate", "Wed, 07 Oct 2026 12:00:00 +0100")).toBe("2026-10-07T11:00:00.000Z");
    expect(sourceRecencyPublicationDate("atom:published", "2026-10-07T12:00:00+01:00")).toBe("2026-10-07T11:00:00.000Z");
  });
});
