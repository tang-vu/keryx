import type { ArticleRead } from "../web-research/article-reader";
import type { PdfExtraction } from "../web-research/pdf-reader";

/** Retain the same observed scope as production PDF reads; never infer OCR. */
export function workloadPdfArticle(result: PdfExtraction, title: string, finalUrl: string): ArticleRead {
  return { text: result.text, title, finalUrl, kind: "pdf", truncated: result.truncated,
    pdfTextScope: { format: "keryx-pdf-text-scope-v1", pagesRead: result.pagesRead, totalPages: result.totalPages,
      pagesWithoutText: [...result.pagesWithoutText], textLimitReached: result.textLimitReached } };
}
