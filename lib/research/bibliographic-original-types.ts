import { z } from "zod";
import { normalizeDoi } from "../scholarly/doi";
import { normalizeVersionedArxivId } from "../scholarly/arxiv-identity";
import type { PaperRecord } from "../papers/types";

/** Explicit scoped primitive only. It is not a natural-language intent classifier,
 * public request flag, ordinary evidence record or payment capability. */
export const bibliographicOriginalRequestSchema = z.object({
  scope: z.literal("metadata-only"), language: z.enum(["en", "fr", "vi"]),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("arxiv"), id: z.string().max(120).refine(value => normalizeVersionedArxivId(value) === value) }).strict(),
    z.object({ kind: z.literal("doi"), doi: z.string().max(300).refine(value => normalizeDoi(value) === value) }).strict(),
  ]),
}).strict();
export type BibliographicOriginalRequest = z.infer<typeof bibliographicOriginalRequestSchema>;

export const bibliographicOriginalReadSchema = z.object({
  requestedUrl: z.string().max(2048), finalUrl: z.string().max(2048),
  observedAt: z.string().datetime(), mediaType: z.enum(["text/html", "application/json"]),
  body: z.string(), truncated: z.literal(false),
}).strict().refine(read => Buffer.byteLength(read.body, "utf8") <= 250000, "Metadata read exceeds its byte bound");
export type BibliographicOriginalRead = z.infer<typeof bibliographicOriginalReadSchema>;

export type BibliographicFieldName = "title" | "firstAuthor" | "identifier" | "year" | "journal" | "doi" | "status";
export interface BibliographicFieldProvenance {
  path: string;
  /** Exact raw HTML unit, never a rewritten passage or scientific evidence quote. */
  rawExcerpt?: string;
  start?: number;
  end?: number;
}
export type BibliographicField = { state: "observed"; value: string; provenance: BibliographicFieldProvenance[] }
  | { state: "missing" | "conflict"; reason: "not-explicit" | "over-bound" | "inconsistent" | "read-unavailable"; provenance?: BibliographicFieldProvenance[] };
export interface BibliographicAuthor {
  /** Original 1-based provider slot; missing names never shift later contributors. */
  position: number;
  name: string;
  provenance: BibliographicFieldProvenance;
}
export interface BibliographicOriginalRecord {
  scope: "metadata-only";
  requested: BibliographicOriginalRequest;
  source?: { requestedUrl: string; url: string; observedAt: string; bodySha256: string; mediaType: "text/html" | "application/json" };
  fields: Record<BibliographicFieldName, BibliographicField>;
  authors: BibliographicAuthor[];
  authorCount: number;
  /** Includes missing slots and bounded truncation; source absence does not imply no authors. */
  authorsIncomplete: boolean;
  peerReview: "unknown";
  failure?: "read-unavailable" | "invalid-metadata-read" | "document-identity-changed";
  /** Bibliography export input only. This must never be converted to a Citation. */
  paper?: PaperRecord;
}

export class BibliographicOriginalError extends Error {
  constructor(readonly code: "document-identity-changed" | "invalid-metadata-read") { super(code); }
}

export function missingBibliographicField(reason: Extract<BibliographicField, { state: "missing" | "conflict" }> ["reason"] = "not-explicit"): BibliographicField {
  return { state: "missing", reason };
}
