import { z } from "zod";

export const EVIDENCE_PAGE_SIZE = 20;
export const EVIDENCE_SOURCE_LIMIT = 100;

const sourceSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(1000),
  description: z.string().max(10_000),
  tags: z.array(z.string().max(1000)).max(100),
  verified: z.boolean().optional(),
  evidenceProvenance: z.literal("synthetic-demo").optional(),
});
export type EvidenceSource = z.infer<typeof sourceSchema>;
export const evidencePageSchema = z.object({
  sources: z.array(sourceSchema).max(EVIDENCE_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).max(2048).optional(),
});
export const evidencePreviewSchema = z.object({
  id: z.string().min(1).max(256),
  previewDepth: z.enum(["full", "excerpt", "locked"]),
  preview: z.array(z.object({
    itemId: z.string().min(1).max(256),
    title: z.string().max(10_000),
    summary: z.string().max(100_000).optional(),
    itemPublishedAt: z.string().max(100).optional(),
    evidenceProvenance: z.literal("synthetic-demo").optional(),
  })).max(5),
});
export type EvidencePreview = z.infer<typeof evidencePreviewSchema>;

/** Local catalogue matching, never a research relevance or answerability verdict. */
export function filterEvidenceSources(sources: EvidenceSource[], query: string): EvidenceSource[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return sources.filter((source) => {
    const text = [source.name, source.description, ...source.tags].join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function mergeEvidenceSources(previous: EvidenceSource[], next: EvidenceSource[]): EvidenceSource[] {
  return [...new Map([...previous, ...next].map((source) => [source.id, source])).values()].slice(0, EVIDENCE_SOURCE_LIMIT);
}
