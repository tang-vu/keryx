import type { ScholarlyMetadata } from "@/lib/types";

export function ScholarlyMetadataDetails({ metadata }: { metadata: ScholarlyMetadata }) {
  return <div className="mt-2 space-y-1 text-xs text-ink-3 [overflow-wrap:anywhere]" data-testid="scholarly-metadata">
    <p>{metadata.workType === "preprint" ? "Preprint" : metadata.workType === "journal-article" ? "Journal article metadata" : "Scholarly record"} · peer review unknown</p>
    <p>Read: {metadata.evidenceScope === "paper-text" ? "paper PDF text within extraction limits" : metadata.evidenceScope === "abstract-page" ? "abstract page only; full paper unavailable" : "publisher page; full paper not established"}</p>
    <p>Authors ({metadata.provider}): {metadata.authors.length ? metadata.authors.join(", ") : "not supplied"}</p>
    {metadata.authorCount !== undefined && metadata.authors.length < metadata.authorCount && <p>Incomplete contributor list: {metadata.authors.length} names recorded from {metadata.authorCount} provider entries{metadata.authorsTruncated ? "; capped at 50" : ""}.</p>}
    {metadata.journal && <p>Journal: {metadata.journal}</p>}
    {metadata.publishedDate && <p>Publication date: {metadata.publishedDate}</p>}
    {metadata.doi && <p>DOI: {metadata.doi}</p>}
    {metadata.arxivId && <p>arXiv: {metadata.arxivId}</p>}
    <p>Metadata observed {metadata.retrievedAt}; author distribution rights are not verified.</p>
  </div>;
}
