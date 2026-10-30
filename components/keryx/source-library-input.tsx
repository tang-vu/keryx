"use client";

import { useUiMessages } from "@/lib/i18n/ui-copy";

/** Localize the authored template before interpolation; retain native GET values. */
export function SourceLibraryInput({ kind, defaultValue, className }: {
  kind: "query" | "author" | "doi"; defaultValue: string; className: string;
}) {
  const copy = useUiMessages();
  const fields = {
    query: { type: "search", name: "q", maxLength: 120, placeholder: copy("sourceFilter.placeholder", { database: "PostgreSQL", domain: "circle.com" }) },
    author: { name: "author", maxLength: 120, placeholder: copy("sourceFilter.authorPlaceholder") },
    doi: { name: "doi", maxLength: 200, placeholder: copy("sourceFilter.doiPlaceholder", { identifier: "10.…", url: "https://doi.org/…" }) },
  };
  return <input {...fields[kind]} lang="und" dir="auto" defaultValue={defaultValue} className={className} />;
}
