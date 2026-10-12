import { describe, it, expect } from "vitest";
import { buildAnswersFeedXml, xmlEscape, FEED_ENTRY_LIMIT } from "./answers-feed";
import type { ArchiveEntry } from "./answers-archive";

const BASE = "https://keryx.cc";

function entry(over: Partial<ArchiveEntry>): ArchiveEntry {
  return {
    id: "abc123",
    question: "What is x402?",
    answerSnippet: "x402 is an HTTP payment scheme…",
    citationCount: 2,
    toCreators: 0.0053,
    totalSpent: 0.01,
    sourceNames: ["Latent Space", "Stripe Blog"],
    createdAt: "2026-07-10T00:00:00.000Z",
    confidence: { level: "High", reason: "two sources corroborate" },
    ...over,
  };
}

describe("xmlEscape", () => {
  it("escapes the five XML special characters", () => {
    expect(xmlEscape(`<a & "b" 'c'>`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
  });
});

describe("buildAnswersFeedXml", () => {
  it("declares recorded answer language on answer content independently of the English wrapper", () => {
    const xml = buildAnswersFeedXml([entry({ id: "vi", answerLanguage: "vi", answerSnippet: "Tiếng Việt" }),
      entry({ id: "zh", answerLanguage: "zh-Hans", answerSnippet: "中文" }), entry({ id: "unknown" })], BASE);
    expect(xml).toContain('<content type="text" xml:lang="vi">Tiếng Việt</content>');
    expect(xml).toContain('<content type="text" xml:lang="zh-Hans">中文</content>');
    expect(xml).toContain('<content type="text" xml:lang="und">');
    expect(xml).toContain('hreflang="vi" href="https://keryx.cc/dispatch/vi"');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
    expect(xml).not.toContain('hreflang="und"');
  });

  it("binds a language subscription self link to the same filtered feed", () => {
    const xml = buildAnswersFeedXml([], BASE, "vi");
    expect(xml).toContain('<id>https://keryx.cc/answers?language=vi</id>');
    expect(xml).toContain('rel="self" type="application/atom+xml" href="https://keryx.cc/answers/feed.xml?language=vi"');
  });
  it("labels historical testnet amounts without attributing them to mainnet", () => {
    const xml = buildAnswersFeedXml([entry({ archivedNetwork: "eip155:5042002" })], BASE);
    expect(xml).toContain("0.0053 test USDC in recorded creator rewards (Arc testnet history)");
    expect(xml).not.toContain("$0.0053");
  });
  it("renders a valid Atom skeleton with self + alternate links", () => {
    const xml = buildAnswersFeedXml([entry({})], BASE);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
    expect(xml).toContain(`<id>${BASE}/answers</id>`);
    expect(xml).toContain(`href="${BASE}/answers/feed.xml"`);
    expect(xml).toContain(`<link rel="alternate" type="text/html" href="${BASE}/dispatch/abc123"/>`);
    expect(xml).toContain(`<link rel="alternate" type="text/html" hreflang="en" href="${BASE}/answers"/>`);
    expect(xml).toContain('<entry xml:lang="">');
    expect(xml).not.toContain('hreflang="vi"');
    expect(xml).not.toContain('hreflang="x-default"');
    expect(xml).toContain("<title>What is x402?</title>");
    expect(xml).toContain("$0.0053 in recorded creator rewards; inspect dispatch for settlement state");
  });

  it("escapes markup in questions and snippets", () => {
    const xml = buildAnswersFeedXml(
      [entry({ question: `Is <script> & "safe"?`, answerSnippet: "a < b & c" })],
      BASE,
    );
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("Is &lt;script&gt; &amp; &quot;safe&quot;?");
    expect(xml).toContain("a &lt; b &amp; c");
  });

  it("uses the newest entry's timestamp as the feed updated time", () => {
    const xml = buildAnswersFeedXml(
      [
        entry({ id: "new", createdAt: "2026-07-20T12:00:00.000Z" }),
        entry({ id: "old", question: "Older?", createdAt: "2026-07-01T00:00:00.000Z" }),
      ],
      BASE,
    );
    const feedUpdated = xml.slice(0, xml.indexOf("<entry "));
    expect(feedUpdated).toContain("<updated>2026-07-20T12:00:00.000Z</updated>");
  });

  it("caps entries at the feed limit and survives an empty archive", () => {
    const many = Array.from({ length: FEED_ENTRY_LIMIT + 20 }, (_, i) =>
      entry({ id: `e${i}`, question: `Q${i}?` }),
    );
    const xml = buildAnswersFeedXml(many, BASE);
    expect(xml.match(/<entry /g)?.length).toBe(FEED_ENTRY_LIMIT);

    const empty = buildAnswersFeedXml([], BASE);
    expect(empty).toContain("</feed>");
    expect(empty).not.toContain("<entry ");
  });

  it("normalizes a bad stored timestamp instead of emitting Invalid Date", () => {
    const xml = buildAnswersFeedXml([entry({ createdAt: "not-a-date" })], BASE);
    expect(xml).not.toContain("Invalid");
    expect(xml).toContain("<updated>1970-01-01T00:00:00.000Z</updated>");
  });
});
