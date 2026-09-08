import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ingestRssXml } from "../lib/ingest/rss.ts";

const directory = new URL("../docs/engineering/", import.meta.url);
const feedUrl = "https://raw.githubusercontent.com/tang-vu/keryx/main/docs/engineering/feed.xml";
const description = "First-party Keryx engineering documentation. Public full articles; not independent reporting or external customer traction.";
const articles = [
  { file: "2026-09-08-citation-rewards.md", title: "How Keryx pays cited creators", summary: "Keryx access tolls, citation rewards, exact-quote evidence checks, contribution weights and settlement limits." },
  { file: "2026-09-08-buyer-recovery.md", title: "Recovering a Keryx paid research job", summary: "How Keryx buyers quote, journal a purchase and resume the original job without signing a second payment." },
].map((article) => ({ ...article, body: readFileSync(new URL(article.file, directory), "utf8").replace(/\r\n/g, "\n") }));
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const cdata = (value: string) => `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>Keryx Engineering (first-party)</title>
<link>https://github.com/tang-vu/keryx/tree/main/docs/engineering</link>
<description>${escapeXml(description)}</description>
${articles.map((article) => {
  const link = `https://github.com/tang-vu/keryx/blob/main/docs/engineering/${article.file}`;
  return `<item><title>${escapeXml(article.title)}</title><link>${escapeXml(link)}</link>
<guid isPermaLink="true">${escapeXml(link)}</guid><pubDate>Tue, 08 Sep 2026 00:00:00 GMT</pubDate>
<description>${escapeXml(article.summary)}</description><content:encoded>${cdata(article.body)}</content:encoded></item>`;
}).join("\n")}
</channel></rss>
`;

const ingested = await ingestRssXml(xml, feedUrl);
assert.equal(ingested.items.length, articles.length);
for (const [index, article] of articles.entries()) {
  assert.equal(ingested.items[index].deliveryKind, "full_text");
  assert.equal(ingested.items[index].content, article.body.replace(/\s+/g, " ").trim());
  assert.equal(ingested.items[index].summary, article.summary);
}
const output = new URL("feed.xml", directory);
if (process.argv.includes("--check")) {
  assert.equal(readFileSync(output, "utf8").replace(/\r\n/g, "\n"), xml, "Regenerate the engineering feed before publishing.");
} else {
  writeFileSync(output, xml, "utf8");
}
console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} ${articles.length} complete first-party articles: ${fileURLToPath(output)}`);
