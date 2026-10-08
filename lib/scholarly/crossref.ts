import type { ScholarlyMetadata } from "../types";
import { completeMetadataText as cleanText, fetchMetadata, type MetadataFetch } from "./provider";
import { normalizeDoi } from "./doi";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function first(value: unknown) { return Array.isArray(value) ? value[0] : undefined; }

/** Preserve only complete provider name parts; no guessed surname or shifted position. */
export function crossrefContributor(value: unknown): NonNullable<ScholarlyMetadata["authorNames"]>[number] | undefined {
  const person = object(value), literal = cleanText(person.name), given = cleanText(person.given), family = cleanText(person.family);
  if (typeof person.name === "string" && person.name.trim()) return literal ? { literal } : undefined;
  const full = cleanText([person.given, person.family].filter(part => typeof part === "string").join(" "));
  return full && (given || family) ? { given, family } : undefined;
}

export function crossrefPublishedDate(value: unknown): string | undefined {
  const parts = first(object(value)["date-parts"]);
  let publishedDate: string | undefined;
  if (Array.isArray(parts) && parts.length >= 1 && parts.length <= 3 && parts.every(Number.isInteger)) {
    const [year, month, day] = parts as number[];
    if (year >= 1000 && year <= 2999 && (month === undefined || month >= 1 && month <= 12)
      && (day === undefined || day >= 1 && day <= 31)) {
      const date = [String(year), ...(month ? [String(month).padStart(2, "0")] : []), ...(day ? [String(day).padStart(2, "0")] : [])].join("-");
      if (day === undefined || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date) publishedDate = date;
    }
  }
  return publishedDate;
}

export function crossrefRecord(value: unknown, retrievedAt: string): ScholarlyMetadata | undefined {
  const work = object(value), doi = normalizeDoi(typeof work.DOI === "string" ? work.DOI : ""), title = cleanText(first(work.title), 1000);
  if (!doi || !title) return;
  const publishedDate = crossrefPublishedDate(work.published);
  const contributors = Array.isArray(work.author) ? work.author : [];
  const authorNames = contributors.slice(0, 50).flatMap<NonNullable<ScholarlyMetadata["authorNames"]>[number]>(author => {
    const name = crossrefContributor(author); return name ? [name] : [];
  });
  const authors = authorNames.map(name => name.literal ?? [name.given, name.family].filter(Boolean).join(" "));
  return { provider: "crossref", recordUrl: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    retrievedAt, title, authors, authorNames, authorCount: contributors.length, authorsTruncated: contributors.length > 50,
    doi, workType: work.type === "journal-article" ? "journal-article" : work.type === "posted-content" && work.subtype === "preprint" ? "preprint" : "other",
    journal: cleanText(first(work["container-title"])), publishedDate, volume: cleanText(work.volume, 40),
    issue: cleanText(work.issue, 40), pages: cleanText(work.page, 80), peerReview: "unknown" };
}

export async function crossrefLookup(question: string, doi?: string, signal?: AbortSignal, fetcher: MetadataFetch = fetchMetadata) {
  const url = doi ? new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`) : new URL("https://api.crossref.org/works");
  if (!doi) { url.searchParams.set("query.bibliographic", question.slice(0, 500)); url.searchParams.set("rows", "6"); }
  const json: unknown = JSON.parse(await fetcher(url.href, signal));
  const message = object(json).message, retrievedAt = new Date().toISOString();
  if (doi) { const record = crossrefRecord(message, retrievedAt); if (!record) throw new Error("Invalid Crossref record"); return record.doi === doi ? [record] : []; }
  const items = object(message).items;
  if (!Array.isArray(items)) throw new Error("Invalid Crossref list");
  return items.slice(0, 6).flatMap(item => { const record = crossrefRecord(item, retrievedAt); return record ? [record] : []; });
}
