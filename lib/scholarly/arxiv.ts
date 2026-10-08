import Parser from "rss-parser";
import type { ScholarlyMetadata } from "../types";
import { completeMetadataText as cleanText, fetchMetadata, type MetadataFetch } from "./provider";
import { normalizeDoi } from "./doi";
import { normalizeVersionedArxivId, questionArxivIds } from "./arxiv-identity";
export { questionArxivIds } from "./arxiv-identity";

const parser = new Parser<Record<string, never>, { id?: string; paperAuthors?: Array<{ name?: string[] }>; paperDoi?: string; paperPublished?: string }>({
  customFields: { item: [["author", "paperAuthors", { keepArray: true }], ["arxiv:doi", "paperDoi"], ["published", "paperPublished"]] },
});
export async function parseArxiv(xml: string, retrievedAt: string): Promise<ScholarlyMetadata[]> {
  if (Buffer.byteLength(xml) > 250000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Invalid arXiv XML");
  const root = xml.match(/<feed\b[^>]*>/)?.[0];
  if (!root || !/\bxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/.test(root)
    || [...xml.matchAll(/\bxmlns\s*=\s*["']([^"']+)["']/g)].some(match => match[1] !== "http://www.w3.org/2005/Atom")
    || [...xml.matchAll(/\bxmlns:arxiv\s*=\s*["']([^"']+)["']/g)].some(match => match[1] !== "http://arxiv.org/schemas/atom")) throw new Error("Invalid arXiv namespaces");
  const feed = await parser.parseString(xml);
  return feed.items.slice(0, 6).flatMap(item => {
    const match = typeof item.id === "string" ? item.id.match(/^https?:\/\/arxiv\.org\/abs\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})v\d+)$/) : null;
    const title = cleanText(item.title, 1000);
    if (!match || !title) return [];
    const arxivId = match[1], url = new URL("https://export.arxiv.org/api/query"); url.searchParams.set("id_list", arxivId);
    const contributors = Array.isArray(item.paperAuthors) ? item.paperAuthors : [];
    const authors = contributors.slice(0, 50).flatMap(author => {
      const name = cleanText(author && typeof author === "object" && Array.isArray(author.name) ? author.name[0] : undefined); return name ? [name] : [];
    });
    // rss-parser falls back to updated when published is absent. That update
    // timestamp cannot establish a publication year in the bibliography.
    const published = item.paperPublished;
    const date = published && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(published)
      && Number.isFinite(Date.parse(published)) && new Date(published).toISOString().slice(0, 10) === published.slice(0, 10)
      ? published.slice(0, 10) : undefined;
    return [{ provider: "arxiv" as const, recordUrl: url.href, retrievedAt, title, authors, authorCount: contributors.length,
      authorsTruncated: contributors.length > 50, arxivId,
      doi: normalizeDoi(item.paperDoi ?? ""), workType: "preprint" as const, publishedDate: date, peerReview: "unknown" as const }];
  });
}

export async function arxivSearch(question: string, signal?: AbortSignal, fetcher: MetadataFetch = fetchMetadata) {
  const ids = questionArxivIds(question);
  if (ids.length) {
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("id_list", ids.join(","));
    url.searchParams.set("max_results", "2");
    const records = await parseArxiv(await fetcher(url.href, signal), new Date().toISOString());
    // A provider response cannot replace a requested version with latest or another work.
    return records.filter(record => ids.includes(normalizeVersionedArxivId(record.arxivId ?? "") ?? ""));
  }
  // Literal quoted words: question text cannot add API operators or URL parameters.
  const ignored = new Set("a an the how what why when where which who does do did is are was were can could should would will of to in on for and or with from about show explain compare describe evidence research paper papers study studies effect effects approach approaches system systems use using reduce".split(" "));
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(word => word.length > 2 && !ignored.has(word)).slice(0, 8);
  if (!words.length) return [];
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", words.map(word => `all:"${word.slice(0, 40)}"`).join(" OR "));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("start", "0"); url.searchParams.set("max_results", "6");
  return parseArxiv(await fetcher(url.href, signal), new Date().toISOString());
}
