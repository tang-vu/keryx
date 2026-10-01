/** Explicit, bounded read-only provider acceptance. Never invokes a model, DB or payment gateway. */
import { tavilyProvider } from "../lib/web-research/tavily-provider.ts";
import { readArticle } from "../lib/web-research/article-reader.ts";
import { digest, publisherGroup } from "../lib/web-research/url-identity.ts";

if (!process.argv.includes("--live")) {
  console.log("Dry run: --live performs 3 fixed basic Tavily searches and at most 6 original public reads; no model, database or payment work.");
  process.exit(0);
}
const provider = tavilyProvider(process.env.TAVILY_API_KEY ?? "");
const topics = process.argv.includes("--targeted") ? [
  { id: "sqlite-wal-targeted", query: "site:sqlite.org/wal.html write ahead logging WAL concurrent readers writer", domains: ["sqlite.org"] },
  { id: "youtube-kids-targeted", query: "site:support.google.com/youtubekids content settings preschool younger older", domains: ["google.com"] },
  { id: "greenhouse-targeted", query: "site:noaa.gov education greenhouse effect carbon dioxide explanation", domains: ["noaa.gov"] },
] : [
  { id: "sqlite-wal", query: "SQLite official documentation WAL concurrent readers writer", domains: ["sqlite.org"] },
  { id: "youtube-kids", query: "YouTube Kids official support age content settings younger older preschool", domains: ["google.com"] },
  { id: "greenhouse", query: "NASA NOAA official greenhouse effect explanation carbon dioxide", domains: ["nasa.gov", "noaa.gov"] },
];
let searchCalls = 0;
for (const topic of topics) {
  const result: Record<string, unknown> = { topic: topic.id, searchDepth: "basic", maxOriginalReads: 2 };
  try {
    searchCalls++;
    const hits = await provider.search(topic.query, AbortSignal.timeout(6000));
    result.resultCount = hits.length;
    result.hits = hits.map(hit => ({ url: hit.url, title: hit.title }));
    result.selection = "First two results in the stated official domain groups; this is provenance filtering, not verified topical evidence.";
    const selected = hits.filter(hit => topic.domains.includes(publisherGroup(hit.url))).slice(0, 2);
    const reads: Record<string, unknown>[] = [];
    for (const hit of selected) {
      try {
        const article = await readArticle(hit.url, AbortSignal.timeout(14000));
        reads.push({ url: article.finalUrl, kind: article.kind, characters: article.text.length,
          bodyHash: digest(article.text), truncated: article.truncated, status: "read" });
      } catch { reads.push({ url: hit.url, status: "unavailable-within-caps" }); }
    }
    result.reads = reads;
    result.status = reads.some(read => read.status === "read") ? "original-read" : "original-unavailable";
  } catch { result.status = "search-unavailable"; }
  console.log(JSON.stringify(result));
}
console.log(JSON.stringify({ searchCalls, maxSearchCalls: 3, maxOriginalReads: 6, sourceUsdcSpent: 0, modelCalls: 0, databaseWrites: 0 }));
