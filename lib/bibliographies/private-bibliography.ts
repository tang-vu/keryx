import { z } from "zod";
import { paperRecordSchema } from "../papers/types";
import type { KeryxDB } from "../db/keryx-db";

export const MAX_PRIVATE_BIBLIOGRAPHIES = 20;
export const MAX_BIBLIOGRAPHY_BODY_BYTES = 262_144;
export const MAX_BIBLIOGRAPHY_CONTENT_BYTES = 524_288;
export const bibliographyIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const bibliographyRevisionSchema = z.number().int().min(1).max(2_147_483_647);
export const bibliographyTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const bibliographyTitleSchema = z.string().trim().min(1).max(120).refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
export const bibliographyInputSchema = z.object({
  title: bibliographyTitleSchema,
  papers: paperRecordSchema.array().max(50),
}).strict().refine(value => new Set(value.papers.map(paper => paper.url)).size === value.papers.length, "Duplicate exact paper links");
export const bibliographyMetadataSchema = z.object({
  id: bibliographyIdSchema, title: bibliographyTitleSchema,
  count: z.number().int().min(0).max(50), revision: bibliographyRevisionSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type BibliographyInput = z.infer<typeof bibliographyInputSchema>;
export type BibliographyMetadata = z.infer<typeof bibliographyMetadataSchema>;
export type BibliographyErrorCode = "bibliography_unavailable" | "bibliography_not_found" | "bibliography_conflict" | "bibliography_limit";
export class PrivateBibliographyError extends Error {
  constructor(readonly code: BibliographyErrorCode) { super(code); }
}
export interface PrivateBibliographiesStore {
  list(owner: string): Promise<BibliographyMetadata[]>;
  create(owner: string, input: BibliographyInput): Promise<{ bibliography: BibliographyMetadata; token: string }>;
  replace(owner: string, id: string, input: BibliographyInput, revision: number): Promise<BibliographyMetadata>;
  revoke(owner: string, id: string, revision: number): Promise<void>;
  read(token: string): Promise<{ content: string } | null>;
}
export function bibliographyOwner(owner: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new PrivateBibliographyError("bibliography_unavailable");
  return owner.toLowerCase();
}
export function requirePrivateBibliographies(db: KeryxDB): PrivateBibliographiesStore {
  const port = db.privateBibliographies;
  if (!port) throw new PrivateBibliographyError("bibliography_unavailable");
  return port;
}
