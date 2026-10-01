/** Bounded live, read-only smoke: two official API requests, at most two original reads. */
import { crossrefLookup } from "../lib/scholarly/crossref";
import { arxivSearch } from "../lib/scholarly/arxiv";
import { articleFailureCode, readArticle } from "../lib/web-research/article-reader";
import { doiUrl } from "../lib/scholarly/doi";

const signal = AbortSignal.timeout(45000);
let metadataRequests = 0, readAttempts = 0;
const results: Array<Record<string, unknown>> = [];
let crossrefUrl: string | undefined, arxivUrl: string | undefined;
try {
  metadataRequests++;
  const records = await crossrefLookup("", "10.1038/nature14539", signal);
  results.push({ provider: "crossref", status: "observed", records: records.map(record => ({ title: record.title, doi: record.doi, authors: record.authors.length, workType: record.workType })) });
  if (records[0]?.doi) crossrefUrl = doiUrl(records[0].doi);
} catch { results.push({ provider: "crossref", status: "unavailable" }); }
try {
  metadataRequests++;
  const records = await arxivSearch("attention transformer", signal);
  results.push({ provider: "arxiv", status: "observed", records: records.map(record => ({ title: record.title, arxivId: record.arxivId, authors: record.authors.length, workType: record.workType })) });
  if (records[0]?.arxivId) arxivUrl = `https://arxiv.org/pdf/${records[0].arxivId}`;
} catch { results.push({ provider: "arxiv", status: "unavailable" }); }
// Optional fixed reader fixtures reproduce bounded PDF and abstract-page availability.
const readUrls = process.argv.includes("--reader-fixtures") ? ["https://arxiv.org/pdf/1512.03385v1", "https://arxiv.org/abs/1706.03762v7"] : [arxivUrl, crossrefUrl];
for (const url of readUrls.filter((value): value is string => !!value)) {
  if (signal.aborted || readAttempts >= 2) break;
  readAttempts++;
  try { const article = await readArticle(url, signal);
    results.push({ url, status: "read", finalUrl: article.finalUrl, extraction: article.kind, chars: article.text.length, truncated: article.truncated });
  } catch (error) { results.push({ url, status: "unavailable", code: articleFailureCode(error) }); }
}
console.log(JSON.stringify({ metadataRequests, readAttempts, results, limitations: "No model synthesis, database writes, payments or user-accuracy claim. Extracted text may be bounded." }, null, 2));
