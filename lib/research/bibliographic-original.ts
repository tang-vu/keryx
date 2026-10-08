import { createHash } from "node:crypto";
import { bibliographicOriginalUrl } from "./bibliographic-original-url";
export { bibliographicOriginalUrl } from "./bibliographic-original-url";
import { completeMetadataText } from "../scholarly/provider";
import { crossrefContributor, crossrefPublishedDate } from "../scholarly/crossref";
import { normalizeDoi } from "../scholarly/doi";
import { normalizeVersionedArxivId } from "../scholarly/arxiv-identity";
import { paperRecordSchema, type PaperRecord } from "../papers/types";
import { observeArxivBibliographicPage, type ArxivBibliographicUnit } from "./arxiv-bibliography-page";
import {
  BibliographicOriginalError, bibliographicOriginalReadSchema, bibliographicOriginalRequestSchema,
  missingBibliographicField, type BibliographicField, type BibliographicFieldProvenance,
  type BibliographicOriginalRead, type BibliographicOriginalRecord, type BibliographicOriginalRequest,
} from "./bibliographic-original-types";

/** Reader must supply the bounded, original transport body and final URL. No
 * default transport, question classifier, full-text evidence or payment adapter. */
export type BibliographicOriginalReader = (url: string, signal?: AbortSignal) => Promise<BibliographicOriginalRead>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const observed = (value: string, provenance: BibliographicFieldProvenance[]): BibliographicField => ({ state: "observed", value, provenance });
const paths = (path: string) => [{ path }];
const completePlainText = (value: string, limit: number) => {
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  return text && text.length <= limit ? text : undefined;
};
const provenance = (unit: ArxivBibliographicUnit): BibliographicFieldProvenance => ({ path: unit.path, start: unit.start, end: unit.end,
  ...(unit.rawExcerpt !== undefined ? { rawExcerpt: unit.rawExcerpt } : {}) });

function emptyRecord(request: BibliographicOriginalRequest): BibliographicOriginalRecord {
  return { scope: "metadata-only", requested: request, fields: { title: missingBibliographicField(), firstAuthor: missingBibliographicField(),
    identifier: missingBibliographicField(), year: missingBibliographicField(), journal: missingBibliographicField(), doi: missingBibliographicField(),
    status: missingBibliographicField() }, authors: [], authorCount: 0, authorsIncomplete: true, peerReview: "unknown" };
}

function originalRead(request: BibliographicOriginalRequest, input: unknown) {
  const parsed = bibliographicOriginalReadSchema.safeParse(input);
  if (!parsed.success) throw new BibliographicOriginalError("invalid-metadata-read");
  const read = parsed.data, expected = bibliographicOriginalUrl(request);
  if (read.requestedUrl !== expected || read.finalUrl !== expected) throw new BibliographicOriginalError("document-identity-changed");
  if (read.mediaType !== (request.target.kind === "arxiv" ? "text/html" : "application/json")) throw new BibliographicOriginalError("invalid-metadata-read");
  return read;
}

function attachSource(record: BibliographicOriginalRecord, read: BibliographicOriginalRead) {
  record.source = { requestedUrl: read.requestedUrl, url: read.finalUrl, observedAt: read.observedAt, mediaType: read.mediaType,
    bodySha256: createHash("sha256").update(read.body).digest("hex") };
}

/** Missing positions stay explicit in the staged record. Conventional exports can
 * express an author sequence only through its intact prefix, never shift a later
 * slot into a missing one; the provider count discloses the incomplete list. */
function exportAuthors(record: BibliographicOriginalRecord) {
  const authors: string[] = [];
  for (const author of record.authors) { if (author.position !== authors.length + 1) break; authors.push(author.name); }
  return authors;
}
function attachExport(record: BibliographicOriginalRecord, extra: Pick<PaperRecord, "repository" | "url" | "publicationKind">) {
  const title = record.fields.title;
  if (title.state !== "observed" || !record.source) return;
  const authors = exportAuthors(record), year = record.fields.year, journal = record.fields.journal, doi = record.fields.doi;
  record.paper = paperRecordSchema.parse({ ...extra, title: title.value, authors, authorCount: record.authorCount,
    authorsTruncated: record.authorCount > authors.length, metadataUrl: record.source.url, metadataObservedAt: record.source.observedAt,
    ...(year.state === "observed" ? { publishedYear: Number(year.value) } : {}),
    ...(journal.state === "observed" ? { venue: journal.value } : {}), ...(doi.state === "observed" ? { doi: doi.value } : {}),
    ...(record.requested.target.kind === "arxiv" ? { arxivId: record.requested.target.id } : {}), peerReview: "unknown" });
}

function htmlField(units: ArxivBibliographicUnit[], limit: number, normalize: (value: string) => string | undefined = value => completePlainText(value, limit)): BibliographicField {
  const present = units.filter(unit => unit.unavailable || unit.overBound || unit.value?.trim());
  if (!present.length) return missingBibliographicField();
  const values = present.map(unit => unit.value !== undefined && completePlainText(unit.value, limit) ? normalize(unit.value) : undefined), source = present.map(provenance);
  if (values.some(value => !value)) return { state: "missing", reason: present.some(unit => unit.unavailable) ? "not-visible"
    : present.some(unit => unit.overBound || (unit.value?.length ?? 0) > limit) ? "over-bound" : "not-explicit", provenance: source };
  if (new Set(values).size > 1) return { state: "conflict", reason: "inconsistent", provenance: source };
  return observed(values[0]!, source);
}

async function arxivOriginal(request: BibliographicOriginalRequest & { target: { kind: "arxiv"; id: string } }, read: BibliographicOriginalRead, signal?: AbortSignal) {
  const page = await observeArxivBibliographicPage(read.body, signal), record = emptyRecord(request);
  // URL/request identity alone is insufficient: a visible exact version must
  // identify the page, and every recognized version marker must agree.
  const version = htmlField(page.versions, 1200, value => normalizeVersionedArxivId(value.replace(/^arXiv:\s*/iu, "").trim()));
  if (version.state !== "observed" || version.value !== request.target.id) throw new BibliographicOriginalError("document-identity-changed");
  const declaredIds = page.metadata.citation_arxiv_id ?? [], bareId = request.target.id.replace(/v[1-9]\d*$/u, "");
  if (declaredIds.some(unit => unit.overBound || !unit.value?.trim() || ![request.target.id, bareId].includes(unit.value.replace(/^arXiv:\s*/iu, "").trim())))
    throw new BibliographicOriginalError("document-identity-changed");
  attachSource(record, read);
  record.fields.identifier = observed(version.value, [...version.provenance, ...declaredIds.map(provenance)]);
  record.fields.title = htmlField([...(page.metadata.citation_title ?? []), ...page.titles], 1000);
  const authors = page.metadata.citation_author ?? [];
  record.authorCount = authors.length;
  record.authors = authors.slice(0, 50).flatMap((unit, index) => {
    const name = unit.value && completePlainText(unit.value, 300);
    return name ? [{ position: index + 1, name, provenance: provenance(unit) }] : [];
  });
  record.authorsIncomplete = !authors.length || record.authors.length !== authors.length;
  record.fields.firstAuthor = authors.length ? htmlField([authors[0]], 300) : missingBibliographicField();
  record.fields.year = htmlField(page.metadata.citation_date ?? [], 20, value => {
    const date = /^(\d{4})(?:[/-](\d{2})(?:[/-](\d{2}))?)?$/u.exec(value.trim());
    return date && crossrefPublishedDate({ "date-parts": [date.slice(1).filter(Boolean).map(Number)] }) ? date[1] : undefined;
  });
  record.fields.journal = htmlField(page.metadata.citation_journal_title ?? [], 300);
  record.fields.doi = htmlField(page.metadata.citation_doi ?? [], 300, normalizeDoi);
  // Only a dedicated status, literal dateline or withdrawal notice. Abstract,
  // comments, repository type and journal metadata never establish peer review.
  record.fields.status = htmlField([...(page.metadata.citation_publication_status ?? []), ...page.statuses], 1200);
  attachExport(record, { repository: "arxiv", url: read.finalUrl, publicationKind: "unknown" });
  return record;
}

function jsonField(value: unknown, path: string, limit: number): BibliographicField {
  if (typeof value !== "string" || !value.trim()) return missingBibliographicField();
  const text = completeMetadataText(value, limit);
  return text ? observed(text, paths(path)) : { state: "missing", reason: completeMetadataText(value, 250000) ? "over-bound" : "not-explicit", provenance: paths(path) };
}
function crossrefOriginal(request: BibliographicOriginalRequest & { target: { kind: "doi"; doi: string } }, read: BibliographicOriginalRead) {
  let envelope: Record<string, unknown>;
  try { envelope = object(JSON.parse(read.body)); } catch { throw new BibliographicOriginalError("invalid-metadata-read"); }
  const work = object(envelope.message);
  if (envelope.status !== "ok" || envelope["message-type"] !== "work") throw new BibliographicOriginalError("invalid-metadata-read");
  const doi = normalizeDoi(typeof work.DOI === "string" ? work.DOI : "");
  if (!doi || doi !== request.target.doi) throw new BibliographicOriginalError("document-identity-changed");
  const record = emptyRecord(request); attachSource(record, read);
  record.fields.identifier = record.fields.doi = observed(doi, paths("message.DOI"));
  record.fields.title = jsonField(Array.isArray(work.title) ? work.title[0] : undefined, "message.title[0]", 1000);
  const authors = Array.isArray(work.author) ? work.author : [];
  record.authorCount = authors.length;
  record.authors = authors.slice(0, 50).flatMap((author, index) => {
    const contributor = crossrefContributor(author), name = contributor?.literal ?? (contributor ? [contributor.given, contributor.family].filter(Boolean).join(" ") : undefined);
    const person = object(author), path = `message.author[${index}]${typeof person.name === "string" && person.name.trim() ? ".name" : ".{given,family}"}`;
    return name ? [{ position: index + 1, name, provenance: { path } }] : [];
  });
  record.authorsIncomplete = !authors.length || record.authors.length !== authors.length;
  const first = record.authors.find(author => author.position === 1);
  const firstRaw = object(authors[0]), firstText = typeof firstRaw.name === "string" && firstRaw.name.trim() ? firstRaw.name
    : [firstRaw.given, firstRaw.family].filter(part => typeof part === "string").join(" ");
  record.fields.firstAuthor = first ? observed(first.name, [first.provenance]) : completeMetadataText(firstText, 250000) && !completeMetadataText(firstText, 300)
    ? { state: "missing", reason: "over-bound", provenance: paths("message.author[0]") } : missingBibliographicField();
  const date = crossrefPublishedDate(work.published);
  record.fields.year = date ? observed(date.slice(0, 4), paths("message.published.date-parts[0]")) : missingBibliographicField();
  record.fields.journal = jsonField(Array.isArray(work["container-title"]) ? work["container-title"][0] : undefined, "message.container-title[0]", 300);
  // Crossref's work type is retained solely for reference format. It does not
  // attest page status, peer review, withdrawal or full-paper access.
  attachExport(record, { repository: "crossref", url: `https://doi.org/${doi}`, publicationKind: work.type === "journal-article" ? "journal-article" : "unknown" });
  return record;
}

/** Staged, explicitly typed route. Absent/false scope is rejected before any read.
 * Failed reads keep precise gaps and zero exports; cancellation propagates. */
export async function readBibliographicOriginal(input: unknown, reader: BibliographicOriginalReader, signal?: AbortSignal): Promise<BibliographicOriginalRecord> {
  const request = bibliographicOriginalRequestSchema.parse(input);
  if (signal?.aborted) throw new DOMException("Metadata read cancelled", "AbortError");
  try {
    const read = originalRead(request, await reader(bibliographicOriginalUrl(request), signal));
    if (signal?.aborted) throw new DOMException("Metadata read cancelled", "AbortError");
    return request.target.kind === "arxiv" ? await arxivOriginal(request as BibliographicOriginalRequest & { target: { kind: "arxiv"; id: string } }, read, signal)
      : crossrefOriginal(request as BibliographicOriginalRequest & { target: { kind: "doi"; doi: string } }, read);
  } catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === "AbortError") throw new DOMException("Metadata read cancelled", "AbortError");
    const record = emptyRecord(request);
    for (const key of Object.keys(record.fields) as Array<keyof typeof record.fields>) record.fields[key] = missingBibliographicField("read-unavailable");
    record.failure = error instanceof BibliographicOriginalError ? error.code : "read-unavailable";
    return record;
  }
}
