import { z } from "zod";
import { normalizeDoi } from "../scholarly/doi";
import { normalizeVersionedArxivId } from "../scholarly/arxiv-identity";

export const paperHttpsUrlSchema = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port;
});
export const PAPER_REPOSITORIES = {
  arxiv: "arXiv", openreview: "OpenReview", pmlr: "PMLR",
  "acl-anthology": "ACL Anthology", crossref: "Crossref",
} as const;
const metadataHosts = {
  arxiv: ["arxiv.org", "export.arxiv.org"], openreview: ["openreview.net", "api2.openreview.net"],
  pmlr: ["proceedings.mlr.press"], "acl-anthology": ["aclanthology.org"], crossref: ["api.crossref.org"],
};
const linkHosts = ["arxiv.org", "openreview.net", "proceedings.mlr.press", "aclanthology.org", "doi.org"];
export const paperRecordSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  authors: z.array(z.string().trim().min(1).max(300)).max(50),
  authorCount: z.number().int().nonnegative(), authorsTruncated: z.boolean(),
  publishedYear: z.number().int().min(1000).max(2999).optional(),
  venue: z.string().trim().min(1).max(300).optional(),
  doi: z.string().refine(value => normalizeDoi(value) === value).optional(),
  arxivId: z.string().refine(value => normalizeVersionedArxivId(value) === value).optional(),
  repository: z.enum(["arxiv", "openreview", "pmlr", "acl-anthology", "crossref"]),
  url: paperHttpsUrlSchema, metadataUrl: paperHttpsUrlSchema, metadataObservedAt: z.string().datetime(),
  publicationKind: z.enum(["preprint", "conference-paper", "journal-article", "unknown"]),
  peerReview: z.literal("unknown"),
  links: z.array(z.object({ label: z.enum(["PDF", "Repository", "Reviews"]), url: paperHttpsUrlSchema }).strict()).max(4).optional(),
}).strict().superRefine((record, ctx) => {
  if (record.authorCount < record.authors.length || record.authorsTruncated !== (record.authorCount > record.authors.length))
    ctx.addIssue({ code: "custom", message: "Contributor count must disclose incomplete names" });
  if (!metadataHosts[record.repository].includes(new URL(record.metadataUrl).hostname))
    ctx.addIssue({ code: "custom", message: "Metadata must come from the declared official repository" });
  if (![record.url, ...(record.links ?? []).map(link => link.url)].every(url => linkHosts.includes(new URL(url).hostname)))
    ctx.addIssue({ code: "custom", message: "Paper links must use supported official hosts" });
  const expected = record.repository === "crossref" ? "doi.org" : metadataHosts[record.repository][0];
  if (new URL(record.url).hostname !== expected)
    ctx.addIssue({ code: "custom", message: "Landing page must match its declared repository" });
  const landing = new URL(record.url);
  if (record.repository === "arxiv" && (!record.arxivId || landing.pathname !== `/abs/${record.arxivId}` || landing.search || landing.hash))
    ctx.addIssue({ code: "custom", message: "arXiv landing page must retain its exact observed version" });
  if (record.repository === "crossref" && (!record.doi || normalizeDoi(record.url) !== record.doi))
    ctx.addIssue({ code: "custom", message: "DOI landing page must match the observed DOI" });
  if (record.repository === "openreview" && (landing.pathname !== "/forum" || !/^[a-zA-Z0-9_-]{1,120}$/.test(landing.searchParams.get("id") ?? "")
    || [...landing.searchParams.keys()].some(key => key !== "id") || landing.searchParams.getAll("id").length !== 1 || landing.hash))
    ctx.addIssue({ code: "custom", message: "OpenReview landing page must identify one original forum" });
});

/** Bibliography only. This type has no document body, citation or payout authority. */
export type PaperRecord = z.infer<typeof paperRecordSchema>;
export interface PaperGroup { id: string; record: PaperRecord; records: PaperRecord[] }
export interface PaperFilters { q: string; author?: string; year?: string; doi?: string }
export const paperSearchResultSchema = z.object({
  version: z.literal(1), scope: z.literal("bibliography-only"),
  groups: z.array(z.object({
    id: z.string().regex(/^paper:[a-f0-9]{64}$/), record: paperRecordSchema,
    records: z.array(paperRecordSchema).min(1).max(112),
  }).strict()).max(112),
  totalWorks: z.number().int().min(0).max(112), catalogRecords: z.number().int().min(0).max(100),
  providers: z.array(z.object({
    name: z.enum(["arxiv", "crossref"]), status: z.enum(["available", "empty", "unavailable"]),
    records: z.number().int().min(0).max(6),
  }).strict()).max(2),
}).strict().refine(result => result.totalWorks === result.groups.length, "Work count must match the bounded result");
export type PaperSearchResult = z.infer<typeof paperSearchResultSchema>;
