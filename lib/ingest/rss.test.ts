/**
 * The channel description is the obvious place for a creator to paste their ownership token, and
 * it is also the string we show on their public page. It must not carry the token there.
 */

import { describe, it, expect } from "vitest";
import { ingestRssXml, stripVerificationToken } from "./rss";

const WALLET = "0x72cf0d122dcda3fcc44bcab6cfea176c262bc157";

describe("stripVerificationToken", () => {
  it("removes the token and the gap it leaves", () => {
    expect(stripVerificationToken(`A curated collection. keryx-verify:${WALLET}`)).toBe(
      "A curated collection.",
    );
  });

  it("removes it from the middle of a sentence", () => {
    expect(stripVerificationToken(`Notes on keryx-verify:${WALLET} payments`)).toBe(
      "Notes on payments",
    );
  });

  it("matches regardless of the case the creator pasted", () => {
    expect(stripVerificationToken(`x KERYX-VERIFY:${WALLET.toUpperCase()}`)).toBe("x");
  });

  it("leaves an ordinary description untouched", () => {
    expect(stripVerificationToken("A blog about payments")).toBe("A blog about payments");
  });
});

describe("RSS paid-body disclosure", () => {
  it("does not advertise an ordinary RSS description as full text", async () => {
    const feed = await ingestRssXml(
      `<rss version="2.0"><channel><title>Notes</title><link>https://example.test</link><description>Feed</description><item><title>Short</title><link>https://example.test/short</link><description>A small preview only.</description></item></channel></rss>`,
      "https://example.test/rss.xml",
    );
    expect(feed.items[0]?.deliveryKind).toBe("abstract");
  });

  it("labels a substantial content:encoded body as full text", async () => {
    const body = "Complete publisher article sentence. ".repeat(30);
    const feed = await ingestRssXml(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Notes</title><link>https://example.test</link><description>Feed</description><item><title>Full</title><link>https://example.test/full</link><description>Preview.</description><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`,
      "https://example.test/rss.xml",
    );
    expect(feed.items[0]?.deliveryKind).toBe("full_text");
    expect(feed.items[0]?.content.length).toBeGreaterThan(800);
  });
});
