/** Inert publisher bibliography parsing; no network, database, document body or payment. */
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import { normalizeVersionedArxivId } from "../scholarly/arxiv-identity";
import { normalizeDoi } from "../scholarly/doi";
import { cleanText } from "../scholarly/provider";
import { paperHttpsUrlSchema, paperRecordSchema } from "./types";

type Repository = "arxiv" | "openreview" | "pmlr" | "acl-anthology";
export interface CollectedPaper {
  title: string;
  authors: string[];
  authorCount: number;
  authorsTruncated: boolean;
  publishedYear?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  repository: Repository;
  url: string;
  metadataUrl: string;
  metadataObservedAt: string;
  publicationKind: "preprint" | "conference-paper" | "journal-article" | "unknown";
  peerReview: "unknown";
  links?: Array<{ label: "PDF" | "Repository" | "Reviews"; url: string }>;
}

const targetSchema = z.discriminatedUnion("repository", [
  z.object({ repository: z.literal("arxiv"), id: z.string().refine(value => !!normalizeVersionedArxivId(value)), title: z.string().min(1).max(1000) }).strict(),
  z.object({ repository: z.literal("openreview"), id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), venueId: z.string().regex(/^ICLR\.cc\/\d{4}\/Conference$/), title: z.string().min(1).max(1000) }).strict(),
  z.object({ repository: z.literal("pmlr"), id: z.string().regex(/^v\d+\/[a-z0-9]+$/), title: z.string().min(1).max(1000) }).strict(),
  z.object({ repository: z.literal("acl-anthology"), id: z.string().regex(/^(?:[A-Z]\d{2}-\d{4}|\d{4}\.[a-z0-9]+-[a-z0-9]+\.\d+)$/), title: z.string().min(1).max(1000) }).strict(),
]);
export type PaperTarget = z.infer<typeof targetSchema>;
export const targetListSchema = z.array(targetSchema).min(1).max(50).superRefine((items, ctx) => {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = `${item.repository}:${item.id}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Duplicate paper target" });
    seen.add(key);
  }
});

export function paperMetadataUrl(target: PaperTarget): string {
  if (target.repository === "arxiv") {
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("id_list", target.id);
    url.searchParams.set("max_results", "1");
    return url.href;
  }
  if (target.repository === "openreview") {
    // Public title search is available anonymously; /notes?id can be refused.
    // The response still must contain this exact top-level note ID and venue ID.
    const url = new URL("https://api2.openreview.net/notes/search");
    for (const [key, value] of Object.entries({ term: target.title, content: "title", type: "exact", source: "forum", venueid: target.venueId, limit: "3" })) url.searchParams.set(key, value);
    return url.href;
  }
  if (target.repository === "pmlr") return `https://proceedings.mlr.press/${target.id}.html`;
  return `https://aclanthology.org/${target.id}/`;
}

export function httpsUrl(raw: unknown, base?: string): string | undefined {
  if (typeof raw !== "string" || raw.length > 4096) return;
  try {
    const parsed = paperHttpsUrlSchema.safeParse(new URL(raw, base).href);
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}

export function year(raw: unknown): number | undefined {
  const match = typeof raw === "string" ? raw.match(/^(\d{4})(?:$|[-/])/): null;
  const value = match ? Number(match[1]) : undefined;
  return value && value >= 1000 && value <= 2999 ? value : undefined;
}
function titleMatches(actual: string, expected: string) {
  const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalize(actual) === normalize(expected);
}
function contributors(raw: unknown): Pick<CollectedPaper, "authors" | "authorCount" | "authorsTruncated"> {
  if (!Array.isArray(raw) || !raw.length || raw.some(value => typeof value !== "string" || !cleanText(value))) throw new Error("Missing or invalid public contributor names");
  return { authors: raw.slice(0, 50).map(value => cleanText(value)!), authorCount: raw.length, authorsTruncated: raw.length > 50 };
}
export function verifyRecord(record: CollectedPaper, target: PaperTarget): CollectedPaper {
  if (!record.title || record.title.length > 1000 || !titleMatches(record.title, target.title)) throw new Error(`Expected title did not match ${target.repository}:${target.id}`);
  if (!record.authors.length || record.authors.length > 50 || record.authorCount < record.authors.length || record.authorsTruncated !== (record.authorCount > 50)) throw new Error("Invalid contributor accounting");
  if (!httpsUrl(record.url) || !httpsUrl(record.metadataUrl) || !Number.isFinite(Date.parse(record.metadataObservedAt))) throw new Error("Invalid metadata provenance");
  if (record.doi && normalizeDoi(record.doi) !== record.doi) throw new Error("Invalid normalized DOI");
  if (record.publishedYear !== undefined && (!Number.isInteger(record.publishedYear) || record.publishedYear < 1000 || record.publishedYear > 2999)) throw new Error("Invalid publication year");
  if ((record.links?.length ?? 0) > 4 || record.links?.some(link => !httpsUrl(link.url))) throw new Error("Invalid paper links");
  if (record.peerReview !== "unknown") throw new Error("Metadata cannot certify peer review");
  paperRecordSchema.parse(record);
  return record;
}

export function publisherMetadata(html: string): Map<string, string[]> {
  if (Buffer.byteLength(html) > 250000) throw new Error("Publisher metadata too large");
  const values = new Map<string, string[]>();
  const walk = (node: DefaultTreeAdapterTypes.Node) => {
    if ("tagName" in node && node.tagName === "meta") {
      const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
      const key = attrs.name ?? attrs.property;
      if (key && attrs.content) values.set(key, [...(values.get(key) ?? []), attrs.content]);
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  // parse5 constructs an inert tree: it executes no page script and loads no resources.
  walk(parse(html));
  return values;
}

export function parsePublisherPaper(html: string, target: Extract<PaperTarget, { repository: "pmlr" | "acl-anthology" }>, metadataUrl: string, metadataObservedAt: string): CollectedPaper {
  const fields = publisherMetadata(html);
  const first = (key: string) => fields.get(key)?.[0];
  const url = target.repository === "pmlr" ? first("citation_abstract_html_url") : first("og:url");
  if (url !== paperMetadataUrl(target) || metadataUrl !== paperMetadataUrl(target)) throw new Error("Publisher canonical URL did not match the requested paper");
  const venue = first("citation_conference_title") ?? first("citation_journal_title");
  const doiRaw = first("citation_doi");
  const doi = doiRaw ? normalizeDoi(doiRaw) : undefined;
  if (doiRaw && !doi) throw new Error("Malformed publisher DOI");
  const pdfLocation = httpsUrl(first("citation_pdf_url"));
  const pdf = pdfLocation && new URL(pdfLocation).hostname === new URL(metadataUrl).hostname ? pdfLocation : undefined;
  return verifyRecord({
    title: cleanText(first("citation_title"), 1000) ?? "",
    ...contributors(fields.get("citation_author")),
    publishedYear: year(first("citation_publication_date")),
    venue: venue ? cleanText(venue, 1000) : undefined,
    doi, repository: target.repository, url, metadataUrl, metadataObservedAt,
    publicationKind: first("citation_conference_title") ? "conference-paper" : first("citation_journal_title") ? "journal-article" : "unknown",
    peerReview: "unknown",
    links: pdf ? [{ label: "PDF", url: pdf }] : undefined,
  }, target);
}

export function parseOpenReviewPaper(text: string, target: Extract<PaperTarget, { repository: "openreview" }>, metadataUrl: string, metadataObservedAt: string): CollectedPaper {
  if (Buffer.byteLength(text) > 250000) throw new Error("OpenReview metadata too large");
  const data: unknown = JSON.parse(text);
  const fieldSchema = z.object({ value: z.unknown(), readers: z.array(z.string()).optional() }).passthrough();
  const noteSchema = z.object({ id: z.string(), forum: z.string(), readers: z.array(z.string()), pdate: z.number().int().optional(), content: z.record(fieldSchema) }).passthrough();
  const response = z.object({ notes: z.array(noteSchema).max(3) }).passthrough().parse(data);
  const matches = response.notes.filter(note => note.id === target.id && note.forum === target.id);
  if (matches.length !== 1 || !matches[0].readers.includes("everyone")) throw new Error("Requested public submission was not returned");
  const note = matches[0];
  const field = (key: string) => {
    const value = note.content[key];
    return value && (!value.readers || value.readers.includes("everyone")) ? value.value : undefined;
  };
  if (field("venueid") !== target.venueId || metadataUrl !== paperMetadataUrl(target)) throw new Error("OpenReview venue or metadata URL did not match");
  const url = `https://openreview.net/forum?id=${target.id}`;
  const pdfLocation = httpsUrl(field("pdf"), "https://openreview.net");
  const pdf = pdfLocation && new URL(pdfLocation).hostname === "openreview.net" ? pdfLocation : undefined;
  const doi = typeof field("doi") === "string" ? normalizeDoi(field("doi") as string) : undefined;
  const publishedYear = note.pdate ? new Date(note.pdate).getUTCFullYear() : undefined;
  const venue = cleanText(field("venue"), 1000) || undefined;
  return verifyRecord({
    title: cleanText(field("title"), 1000) ?? "", ...contributors(field("authors")),
    publishedYear, venue, doi,
    repository: "openreview", url, metadataUrl, metadataObservedAt,
    publicationKind: venue && /^ICLR \d{4} (poster|oral|spotlight)$/i.test(venue) ? "conference-paper" : "unknown", peerReview: "unknown",
    links: [...(pdf ? [{ label: "PDF" as const, url: pdf }] : []), { label: "Reviews", url }],
  }, target);
}
