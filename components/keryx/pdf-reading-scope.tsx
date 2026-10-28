"use client";

import { Fragment, useContext } from "react";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { UiCopyContext, englishUiCopy } from "@/lib/i18n/ui-copy-context";
import { pdfReadingCopy } from "@/locales/en/pdf-reading";
import { pdfReadingNoticeParts } from "@/lib/research/pdf-reading";
import type { SourceItemIdentity } from "@/lib/types";

export function PdfReadingScope({ provenance }: { provenance: Pick<NonNullable<SourceItemIdentity["webProvenance"]>, "extraction" | "pdfTextScope"> | undefined }) {
  const copy = useUiCopy("pdf-reading", pdfReadingCopy);
  const { locale } = useContext(UiCopyContext) ?? englishUiCopy;
  const parts = provenance?.extraction === "pdf" ? pdfReadingNoticeParts(provenance.pdfTextScope, false, copy) : [];
  return parts.length ? <span className="mt-2 block break-words font-serif text-sm leading-relaxed text-ink-2">{parts.map((part, index) =>
    <Fragment key={index}>{index > 0 ? " " : ""}<span lang={part.text === part.english ? "en" : locale}>{part.text}</span></Fragment>)}</span> : null;
}
