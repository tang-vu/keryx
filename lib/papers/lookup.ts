import { z } from "zod";
import { normalizeDoi } from "../scholarly/doi";
import { normalizePaperQuery, paperLookupIntent } from "./intent";
import { paperMatches } from "./filters";
import { parsePaperRequest } from "./request";
import { paperSearchResultSchema, type PaperRecord, type PaperSearchResult } from "./types";
import { groupPaperWorks } from "./work-groups";

function assertExactLinks(record: PaperRecord) {
  if ([record.url, record.metadataUrl, ...(record.links ?? []).map(link => link.url)]
    .some(url => /[\s\u0000-\u001f\u007f-\u009f]/u.test(url))) throw new Error("Invalid exact bibliography link");
}

export const paperLookupToolOptions = {
  title: "Look up paper bibliography",
  description: "Find paper titles, recorded contributors, DOI and exact repository versions without research or payment. " +
    "Default: retained catalog metadata with observation times. Set searchRepositories=true only to explicitly send the query to arXiv/Crossref " +
    "(at most two requests, no paper-body reading). Missing DOI, peer review and withdrawal/replacement status remain unknown. " +
    "Use this for bibliographic questions before requesting paid research.",
  inputSchema: {
    query: z.string().trim().min(1).max(200).describe("Title/topic (up to 120 characters), exact DOI (up to 200), or versioned arXiv ID/official URL."),
    searchRepositories: z.boolean().optional().describe("Explicit external metadata lookup; false by default. Sends the query to official scholarly providers."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};
export interface PaperLookupInput { query: string; searchRepositories?: boolean }

/** Normalizes only an entire supported identity; arbitrary URLs remain literal query text. */
export function paperLookupParameters(input: PaperLookupInput) {
  const query = z.string().trim().min(1).max(200).parse(input.query);
  const doi = normalizeDoi(query);
  const q = normalizePaperQuery(query);
  const params = new URLSearchParams(doi ? { doi } : { q });
  if (input.searchRepositories === true) params.set("search", "1");
  const parsed = parsePaperRequest(params);
  paperLookupIntent(doi ?? q); // Never silently omit an oversized exact-identifier list.
  return { params, ...parsed };
}

/** Validate an untrusted hosted response without erasing legitimate alternate snapshots. */
export function validatePaperLookupResult(input: PaperLookupInput, value: unknown): PaperSearchResult {
  const { filters, live } = paperLookupParameters(input);
  const result = paperSearchResultSchema.parse(value);
  if (result.groups.reduce((count, group) => count + group.records.length, 0) > 112)
    throw new Error("Bibliography exceeds the total snapshot bound");
  if (new Set(result.groups.map(group => group.id)).size !== result.groups.length)
    throw new Error("Duplicate bibliography work groups");
  const combined = groupPaperWorks(result.groups.flatMap(group => group.records));
  if (combined.length !== result.groups.length || combined.some(group => !result.groups.some(supplied => supplied.id === group.id)))
    throw new Error("Incoherent combined bibliography work groups");
  const intent = paperLookupIntent(filters.doi ?? filters.q);
  const exact = intent.dois.length > 0 || intent.arxivIds.length > 0;
  for (const { id, record, records } of result.groups) {
    records.forEach(assertExactLinks);
    if (!records.some(snapshot => JSON.stringify(snapshot) === JSON.stringify(record)))
      throw new Error("Selected bibliography snapshot is not retained");
    const grouped = groupPaperWorks(records);
    if (grouped.length !== 1 || grouped[0].id !== id) throw new Error("Incoherent bibliography work group");
    const sameWorkVersions = intent.arxivIds.filter(id => id.replace(/v\d+$/, "") === record.arxivId?.replace(/v\d+$/, ""));
    if (!live && !paperMatches(record, filters)
      || exact && !intent.dois.includes(record.doi ?? "") && !intent.arxivIds.includes(record.arxivId ?? "")
      || sameWorkVersions.length > 0 && !sameWorkVersions.includes(record.arxivId!))
      throw new Error("Bibliography identity does not match the query");
  }
  return result;
}

/** Text-only clients get a bounded summary; structured data keeps the existing v1 contract. */
export function paperLookupText(result: PaperSearchResult): string {
  const field = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/gu, " ").trim();
  const lines = ["Paper bibliography only; no paper read, model call, citation or creator payment.",
    `${result.totalWorks} matching works. Records retain their individual observation times; provider availability does not refresh catalog snapshots.`];
  for (const provider of result.providers) lines.push(`${provider.name}: ${provider.status === "unavailable"
    ? "unavailable; no empty result inferred" : provider.status === "empty" ? "no matching records accepted" : `${provider.records} metadata records returned`}.`);
  for (const { record } of result.groups.slice(0, 8)) {
    assertExactLinks(record);
    const complete = record.authors.length > 0 && !record.authorsTruncated && record.authorCount === record.authors.length;
    lines.push("", field(record.title),
      complete ? `First listed author in the recorded complete list: ${field(record.authors[0])}.`
        : "First listed author: not established from the incomplete or absent recorded names.",
      `Recorded contributors (${record.authors.length}/${record.authorCount} names retained): ${record.authors.slice(0, 12).map(field).join("; ") || "unavailable"}.` +
        (record.authors.length > 12 ? " Text shows the first 12 names; the structured record retains the remaining names." : ""),
      `DOI: ${record.doi ?? "not recorded; existence not established"}.`,
      `Version: ${record.arxivId ?? "no repository version recorded"}. Year: ${record.publishedYear ?? "not recorded"}. Venue: ${record.venue ? field(record.venue) : "not recorded"}.`,
      "Peer review and withdrawal/replacement status: unknown in this metadata.",
      `Landing page: ${record.url}`,
      `Metadata: ${record.metadataUrl} (observed ${record.metadataObservedAt}).`);
  }
  if (result.totalWorks > 8) lines.push(`Text shows 8/${result.totalWorks} works; the bounded structured result contains the remaining records.`);
  return lines.join("\n");
}

export function createPaperLookupHandler(read: (input: PaperLookupInput) => Promise<PaperSearchResult>) {
  return async (input: PaperLookupInput) => {
    try {
      paperLookupParameters(input);
    } catch {
      return { isError: true, content: [{ type: "text" as const, text:
        "Invalid bibliography query. Use up to 120 characters for a title/topic, 200 for an exact DOI, and at most two exact identifiers. No lookup started." }] };
    }
    try {
      const result = validatePaperLookupResult(input, await read(input));
      return { structuredContent: result, content: [{ type: "text" as const, text: paperLookupText(result) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text:
        "Bibliography temporarily unavailable or unsupported. No empty result, paper read or payment is inferred. Try later or browse /sources?kind=paper." }] };
    }
  };
}
