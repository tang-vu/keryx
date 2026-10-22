"use client";

import { useUiCopy } from "@/lib/i18n/ui-copy";
import { pdfReadingCopy } from "@/locales/en/pdf-reading";
import { pdfReadingNotice } from "@/lib/research/pdf-reading";
import type { SourceItemIdentity } from "@/lib/types";

export function PdfReadingScope({ provenance }: { provenance: Pick<NonNullable<SourceItemIdentity["webProvenance"]>, "extraction" | "pdfTextScope"> | undefined }) {
  const copy = useUiCopy("pdf-reading", pdfReadingCopy);
  const notice = provenance?.extraction === "pdf" ? pdfReadingNotice(provenance.pdfTextScope, false, copy) : "";
  return notice ? <span className="mt-2 block break-words font-serif text-sm leading-relaxed text-ink-2">{notice}</span> : null;
}
