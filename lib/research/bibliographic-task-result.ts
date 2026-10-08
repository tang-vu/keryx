import { z } from "zod";
import { paperRecordSchema } from "../papers/types";
import { bibliographicOriginalRequestSchema } from "./bibliographic-original-types";
import { bibliographicOriginalUrl } from "./bibliographic-original-url";
import { bibliographicOriginalDeliverable } from "./bibliographic-original-text";
import { boundedPortableCopy } from "./bounded-portable-json";
import { normalizeDoi } from "../scholarly/doi";
import type { BibliographicTaskResult } from "./bibliographic-task";

const provenance = z.object({ path: z.string().max(4096), rawExcerpt: z.string().max(8192).optional(),
  start: z.number().int().min(0).max(250000).optional(), end: z.number().int().min(0).max(250000).optional() }).strict()
  .refine(value => (value.start === undefined) === (value.end === undefined) &&
    (value.start === undefined || value.end! > value.start) &&
    (value.rawExcerpt === undefined || value.start !== undefined && value.rawExcerpt.length === value.end! - value.start));
const field = (limit: number) => z.union([
  z.object({ state: z.literal("observed"), value: z.string().min(1).max(limit), provenance: z.array(provenance).min(1).max(32) }).strict(),
  z.object({ state: z.enum(["missing", "conflict"]), reason: z.enum(["not-explicit", "not-visible", "over-bound", "inconsistent", "read-unavailable"]), provenance: z.array(provenance).max(32).optional() }).strict(),
]);
const record = z.object({ scope: z.literal("metadata-only"), requested: bibliographicOriginalRequestSchema,
  source: z.object({ requestedUrl: z.string().max(2048), url: z.string().max(2048), observedAt: z.string().datetime(),
    bodySha256: z.string().regex(/^[a-f0-9]{64}$/u), mediaType: z.enum(["text/html", "application/json"]) }).strict().optional(),
  fields: z.object({ title: field(1000), firstAuthor: field(300), identifier: field(300), year: field(4), journal: field(300), doi: field(300), status: field(1200) }).strict(),
  authors: z.array(z.object({ position: z.number().int().min(1).max(10000), name: z.string().min(1).max(300), provenance }).strict()).max(50),
  authorCount: z.number().int().nonnegative().max(10000), authorsIncomplete: z.boolean(), peerReview: z.literal("unknown"),
  failure: z.enum(["read-unavailable", "invalid-metadata-read", "document-identity-changed"]).optional(), paper: paperRecordSchema.optional(),
}).strict();
const requestFields = z.array(z.enum(["title", "firstAuthor", "identifier", "year", "journal", "doi", "status"])).min(3).max(7);
const referenceExport = z.object({ count: z.number().int().min(0).max(1), content: z.string().max(98304) }).strict();

/** Redundant export metadata must agree with the accepted original fields and
 * original author positions. Repository/version authority never comes from paper. */
function originalRecordBound(value: z.infer<typeof record>): boolean {
  const { fields, authors, paper, source, requested } = value;
  if (value.failure) return !source && !paper && !authors.length && value.authorCount === 0 && value.authorsIncomplete &&
    Object.values(fields).every(item => item.state === "missing" && item.reason === "read-unavailable" && !item.provenance?.length);
  if (!source || source.url !== bibliographicOriginalUrl(requested) || source.requestedUrl !== source.url ||
      source.mediaType !== (requested.target.kind === "arxiv" ? "text/html" : "application/json")) return false;
  const target = requested.target.kind === "arxiv" ? requested.target.id : requested.target.doi;
  if (fields.identifier.state !== "observed" || fields.identifier.value !== target ||
      requested.target.kind === "doi" && (fields.doi.state !== "observed" || fields.doi.value !== target)) return false;
  if (Object.values(fields).some(item => item.state === "observed" && (item.value !== item.value.trim() || /\p{Cc}/u.test(item.value))) ||
      authors.some(author => author.name !== author.name.trim() || /\p{Cc}/u.test(author.name)) ||
      fields.doi.state === "observed" && normalizeDoi(fields.doi.value) !== fields.doi.value) return false;
  if (authors.some((author, index) => author.position > value.authorCount || index > 0 && author.position <= authors[index - 1].position) ||
      value.authorsIncomplete !== (!value.authorCount || authors.length !== value.authorCount)) return false;
  const first = authors.find(author => author.position === 1);
  if (first ? fields.firstAuthor.state !== "observed" || fields.firstAuthor.value !== first.name : fields.firstAuthor.state === "observed") return false;
  if (fields.year.state === "observed" && !/^[12]\d{3}$/u.test(fields.year.value)) return false;
  if (!paper) return true;
  const prefix: string[] = [];
  for (const author of authors) { if (author.position !== prefix.length + 1) break; prefix.push(author.name); }
  return fields.title.state === "observed" && paper.title === fields.title.value &&
    paper.authors.length === prefix.length && paper.authors.every((author, index) => author === prefix[index]) &&
    paper.authorCount === value.authorCount && paper.authorsTruncated === (value.authorCount > prefix.length) &&
    paper.metadataUrl === source.url && paper.metadataObservedAt === source.observedAt && !paper.links &&
    paper.publishedYear === (fields.year.state === "observed" ? Number(fields.year.value) : undefined) &&
    paper.venue === (fields.journal.state === "observed" ? fields.journal.value : undefined) &&
    paper.doi === (fields.doi.state === "observed" ? fields.doi.value : undefined) &&
    (requested.target.kind === "arxiv" ? paper.repository === "arxiv" && paper.arxivId === target && paper.url === source.url && paper.publicationKind === "unknown"
      : paper.repository === "crossref" && paper.arxivId === undefined && paper.url === `https://doi.org/${target}` && ["unknown", "journal-article"].includes(paper.publicationKind));
}

/** Validate a persisted/portable optional metadata role independently. Recompute
 * its reference exports from the bounded record; never promote it into citations. */
export function projectBibliographicTask(value: unknown): BibliographicTaskResult | undefined {
  try {
    const parsed = z.object({ kind: z.literal("bibliography"), scope: z.literal("metadata-only"),
      originalQuestionSha256: z.string().regex(/^[a-f0-9]{64}$/u), requestedFields: requestFields, requestedAuthorCount: z.union([z.literal(1), z.literal(3)]),
      record, text: z.string().max(98304), bibliographyExports: z.object({ bibtex: referenceExport, ris: referenceExport }).strict(),
    }).strict().safeParse(boundedPortableCopy(value));
    if (!parsed.success) return;
    const result = parsed.data;
    if (new Set(result.requestedFields).size !== result.requestedFields.length ||
      !["title", "firstAuthor", "identifier"].every(name => result.requestedFields.includes(name as typeof result.requestedFields[number])) ||
      !originalRecordBound(result.record)) return;
    return { ...result, ...bibliographicOriginalDeliverable(result.record) };
  } catch { return; }
}

/** Call only after verifying receipt integrity and its original dispatch binding. */
export function bibliographyFromCheckedReceipt(receipt: unknown) {
  try {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return;
    const payload = Object.getOwnPropertyDescriptor(receipt, "payload");
    if (!payload || !("value" in payload) || !payload.value || typeof payload.value !== "object" || Array.isArray(payload.value)) return;
    const bibliography = Object.getOwnPropertyDescriptor(payload.value, "bibliography");
    return bibliography && "value" in bibliography ? projectBibliographicTask(bibliography.value) : undefined;
  } catch { return; }
}
