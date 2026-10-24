import type { EvidenceRecord } from "../types";
import { observedHtmlSectionScope } from "../web-research/html-section-scope";
import { observedPdfTextScope, pdfTextScopeTruncated } from "../web-research/pdf-text-scope";

/** Append-only CSV fields; Markdown uses the same values and fixed labels. */
export const evidenceReadScopeColumns = [
  ["read_scope", "Recorded read scope"],
  ["extraction", "Extraction method"],
  ["retrieved_at", "Retrieved at"],
  ["extracted_text_truncated", "Extracted text clipped by page/character limits"],
  ["normalized_body_sha256", "Extracted text SHA-256"],
  ["pdf_text_scope", "PDF text scope (recorded JSON)"],
  ["html_section_scope", "HTML heading scope (recorded JSON; UTF-16 HTML offsets)"],
] as const;

type ScopeFields = Record<typeof evidenceReadScopeColumns[number][0], string>;

/** Observe only the excerpt's own metadata. Never borrow a citation's scope or
 * infer full reading from an unclipped body, a digest, or an absent old field. */
export function evidenceReadScope(item: Pick<EvidenceRecord, "webProvenance">): ScopeFields {
  const missing: ScopeFields = { read_scope: "Not recorded", extraction: "", retrieved_at: "",
    extracted_text_truncated: "", normalized_body_sha256: "", pdf_text_scope: "", html_section_scope: "" };
  try {
    const provenance = item.webProvenance;
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return missing;
    const fields = Object.getOwnPropertyDescriptors(provenance);
    if (Object.values(fields).some(field => !("value" in field))) return missing;
    const value = (key: string): unknown => fields[key]?.value;
    const extraction = value("extraction"), retrievedAt = value("retrievedAt"), hash = value("normalizedBodyHash"), truncated = value("truncated");
    if ((extraction !== "html" && extraction !== "text" && extraction !== "pdf") ||
      typeof retrievedAt !== "string" || !retrievedAt.length || retrievedAt.length > 80 ||
      typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash) || typeof truncated !== "boolean") return missing;
    const result: ScopeFields = { ...missing, read_scope: "Extracted text only; detailed read scope not recorded",
      extraction, retrieved_at: retrievedAt, extracted_text_truncated: String(truncated), normalized_body_sha256: hash };
    // Match the existing public receipt projection: unsupported optional detail
    // remains unknown, PDF scope belongs to PDF, and heading reads are partial.
    const pdf = extraction === "pdf" ? observedPdfTextScope(value("pdfTextScope")) : undefined;
    const html = extraction === "html" && truncated ? observedHtmlSectionScope(value("htmlSectionScope")) : undefined;
    if (pdf) return { ...result, read_scope: pdfTextScopeTruncated(pdf) !== truncated
      ? "Conflicting PDF clipping metadata; text extraction only, images and OCR not established"
      : "PDF text extraction only; images and OCR not established", pdf_text_scope: JSON.stringify(pdf) };
    if (html) return { ...result, read_scope: "HTML heading section only; whole-document coverage not established", html_section_scope: JSON.stringify(html) };
    return result;
  } catch { return missing; }
}
