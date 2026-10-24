import { z } from "zod";

/** UTF-16 offsets into the fetched HTML, not offsets into the extracted text.
 * Records one bounded heading section; no whole-document coverage is implied. */
export const htmlSectionScopeSchema = z.object({
  format: z.literal("keryx-html-section-scope-v1"),
  fragment: z.string().min(1).max(200).regex(/^[^\u0000-\u0020\u007f]+$/u),
  headingLevel: z.number().int().min(1).max(6),
  htmlStart: z.number().int().min(0).max(2 * 1024 * 1024),
  htmlEnd: z.number().int().min(1).max(2 * 1024 * 1024),
  documentCharacters: z.number().int().min(1).max(2 * 1024 * 1024),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().refine(value => value.htmlStart < value.htmlEnd && value.htmlEnd <= value.documentCharacters);
export type HtmlSectionScope = z.infer<typeof htmlSectionScopeSchema>;

export function observedHtmlSectionScope(value: unknown): HtmlSectionScope | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.values(fields).some(field => !("value" in field))) return;
    const parsed = htmlSectionScopeSchema.safeParse(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}
