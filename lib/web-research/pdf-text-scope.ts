import { z } from "zod";

/** Observed text extraction only. It does not establish OCR or image coverage. */
export const pdfTextScopeSchema = z.object({
  format: z.literal("keryx-pdf-text-scope-v1"),
  pagesRead: z.number().int().min(1).max(100),
  totalPages: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  pagesWithoutText: z.array(z.number().int().min(1).max(100)).max(100),
  textLimitReached: z.boolean(),
}).strict().refine(value => value.totalPages >= value.pagesRead && value.pagesWithoutText.length < value.pagesRead &&
  value.pagesWithoutText.every((page, index) => page <= value.pagesRead && (index === 0 || page > value.pagesWithoutText[index - 1])));

export type PdfTextScope = z.infer<typeof pdfTextScopeSchema>;

export function pdfTextScopeLimited(scope: PdfTextScope): boolean {
  return pdfTextScopeTruncated(scope) || scope.pagesWithoutText.length > 0;
}

/** Text clipping and textless pages are different observations. Preserve the
 * existing quote-boundary meaning of webProvenance.truncated. */
export function pdfTextScopeTruncated(scope: PdfTextScope): boolean {
  return scope.pagesRead < scope.totalPages || scope.textLimitReached;
}

/** Historical/optional metadata can be absent or malformed; never invent coverage.
 * Refuse accessors before observing in-process objects used by presentation callers. */
export function observedPdfTextScope(value: unknown): PdfTextScope | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.values(fields).some(field => !("value" in field)) ||
      Object.keys(fields).sort().join(",") !== "format,pagesRead,pagesWithoutText,textLimitReached,totalPages") return;
    const pages = fields.pagesWithoutText.value;
    if (!Array.isArray(pages) || pages.length > 100) return;
    const pageFields = Object.getOwnPropertyDescriptors(pages);
    if (Object.keys(pageFields).length !== pages.length + 1 || Object.values(pageFields).some(field => !("value" in field))) return;
    const parsed = pdfTextScopeSchema.safeParse(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}
