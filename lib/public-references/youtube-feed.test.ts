import { readFileSync } from "node:fs";
import Parser from "rss-parser";
import { describe, expect, it } from "vitest";
import { ingestYoutubeMetadata, SUPER_SIMPLE_FEED_URL } from "./youtube-feed";

const xml = readFileSync(new URL("./fixtures/youtube-super-simple.xml", import.meta.url), "utf8");
const ingest = (body = xml) => ingestYoutubeMetadata(body, SUPER_SIMPLE_FEED_URL);
describe("approved YouTube publisher metadata", () => {
  it("demonstrates the existing parser gap and reads the sanitized actual response without stats", async () => {
    const old = await new Parser().parseString(xml);
    expect(old.items[0].content).toBeUndefined();
    expect(old.items[0].contentSnippet).toBeUndefined();
    const feed = await ingest();
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ link: "https://www.youtube.com/watch?v=LuJe0ad1Ygk",
      publishedAt: "2026-09-24T14:00:32.000Z", deliveryKind: "metadata_only" });
    expect(feed.items[0].content).toContain("Publisher description: Get the Super Simple App!");
    expect(JSON.stringify(feed)).not.toMatch(/236208|statistics|community/);
  });
  it("rejects unapproved feeds and namespace/channel substitution", async () => {
    await expect(ingestYoutubeMetadata(xml, `${SUPER_SIMPLE_FEED_URL}&other=1`)).rejects.toThrow("Unapproved");
    await expect(ingest(xml.replace("http://search.yahoo.com/mrss/", "https://evil.test/"))).rejects.toThrow("namespace");
    await expect(ingest(xml.replace("xmlns:yt=", "xmlns:alias="))).rejects.toThrow("namespace");
    await expect(ingest(xml.replace("<entry>", '<entry xmlns:yt="http://www.youtube.com/xml/schemas/2015">'))).rejects.toThrow("namespace");
    await expect(ingest(xml.replace('xmlns:yt="http://www.youtube.com/xml/schemas/2015"', 'note=\'xmlns:yt="http://www.youtube.com/xml/schemas/2015"\''))).rejects.toThrow("namespace");
    await expect(ingest(xml.replace("<media:group>", '<media:group xmlns:media="https://evil.test/">'))).rejects.toThrow("namespace");
    await expect(ingest(xml.replace("<entry>", '<!DOCTYPE feed [<!ENTITY test "bad">]><entry>'))).rejects.toThrow("declaration");
    await expect(ingest(xml.replace("<yt:channelId>LsooMJoIpl_7ux2jvdPB-Q", "<yt:channelId>wrong"))).rejects.toThrow("channel mismatch");
  });
  it("rejects namespace-like attribute names even when rss-parser accepts their lexical prefixes", async () => {
    const spoof = xml.replaceAll("xmlns", "notxmlns");
    expect((await new Parser().parseString(spoof)).items).toHaveLength(1);
    await expect(ingest(spoof)).rejects.toThrow("namespace");
    const quoted = xml.replace(/<feed\s[^>]*>/,
      `<feed foo=" xmlns='http://www.w3.org/2005/Atom' xmlns:yt='http://www.youtube.com/xml/schemas/2015' xmlns:media='http://search.yahoo.com/mrss/'">`);
    expect((await new Parser().parseString(quoted)).items).toHaveLength(1);
    await expect(ingest(quoted)).rejects.toThrow("namespace");
  });
  it("drops mismatched entry identity, unsafe links and noncanonical video URLs", async () => {
    for (const [before, after] of [["<yt:channelId>UCLsooMJoIpl_7ux2jvdPB-Q", "<yt:channelId>wrong"],
      ["<yt:videoId>LuJe0ad1Ygk", "<yt:videoId>bad"], ["yt:video:LuJe0ad1Ygk", "yt:video:wrong"],
      ["https://www.youtube.com/watch?v=LuJe0ad1Ygk", "javascript:alert(1)"],
      ["https://www.youtube.com/watch?v=LuJe0ad1Ygk", "https://www.youtube.com/watch?v=LuJe0ad1Ygk&amp;x=1"]])
      expect((await ingest(xml.replace(before, after))).items).toEqual([]);
  });
  it("keeps honest missing-description metadata, rejects invalid dates and bounds descriptions", async () => {
    const missing = await ingest(xml.replace(/<media:description>.*?<\/media:description>/, ""));
    expect(missing.items[0].content).toContain("not supplied");
    expect(missing.items[0].deliveryKind).toBe("metadata_only");
    await expect(ingest(xml.replace("2026-09-24T14:00:32+00:00", "invalid"))).rejects.toThrow("Malformed");
    const missingDate = await ingest(xml.replace(/<published>.*?<\/published>/, ""));
    expect(missingDate.items[0].publishedAt).toBeUndefined();
    const large = await ingest(xml.replace("Get the Super Simple App!", "a".repeat(20_000)));
    expect(large.items[0].content.split("Publisher description: ")[1]).toHaveLength(10_000);
    await expect(ingest(xml + " ".repeat(500_000))).rejects.toThrow("oversized");
  });
  it("deduplicates identity and caps valid entries at ten", async () => {
    const entry = xml.match(/<entry>[\s\S]*?<\/entry>/)![0];
    expect((await ingest(xml.replace(entry, entry.repeat(15)))).items).toHaveLength(1);
    const entries = Array.from({ length: 15 }, (_, i) => entry.replaceAll("LuJe0ad1Ygk", `video${String(i).padStart(6, "0")}`)).join("");
    expect((await ingest(xml.replace(entry, entries))).items).toHaveLength(10);
  });
});
