import { createMessages } from "@/lib/i18n/messages";
import type { ScholarlyMetadata } from "@/lib/types";

const copy = createMessages("en");

export function ScholarlyMetadataDetails({ metadata }: { metadata: ScholarlyMetadata }) {
  return <div className="mt-2 space-y-1 text-xs text-ink-3 [overflow-wrap:anywhere]" data-testid="scholarly-metadata">
    <p>{copy(metadata.workType === "preprint" ? "scholarlyMetadata.preprint" : metadata.workType === "journal-article" ? "scholarlyMetadata.journalArticle" : "scholarlyMetadata.record")}</p>
    <p>{copy(metadata.evidenceScope === "paper-text" ? "scholarlyMetadata.paperText" : metadata.evidenceScope === "abstract-page" ? "scholarlyMetadata.abstractOnly" : "scholarlyMetadata.publisherPage")}</p>
    <p>{metadata.authors.length ? copy("scholarlyMetadata.authors", { provider: metadata.provider, authors: metadata.authors.join(", ") }) : copy("scholarlyMetadata.authorsNotSupplied", { provider: metadata.provider })}</p>
    {metadata.authorCount !== undefined && metadata.authors.length < metadata.authorCount && <p>{copy(metadata.authorsTruncated ? metadata.authorCount === 1 ? "scholarlyMetadata.contributors.truncated.one" : "scholarlyMetadata.contributors.truncated.other" : metadata.authorCount === 1 ? "scholarlyMetadata.contributors.one" : "scholarlyMetadata.contributors.other", { recorded: metadata.authors.length, count: metadata.authorCount })}</p>}
    {metadata.journal && <p>{copy("scholarlyMetadata.journal", { value: metadata.journal })}</p>}
    {metadata.publishedDate && <p>{copy("scholarlyMetadata.published", { value: metadata.publishedDate })}</p>}
    {metadata.doi && <p>{copy("scholarlyMetadata.doi", { value: metadata.doi })}</p>}
    {metadata.arxivId && <p>{copy("scholarlyMetadata.arxiv", { value: metadata.arxivId })}</p>}
    <p>{copy("scholarlyMetadata.observed", { retrievedAt: metadata.retrievedAt })}</p>
  </div>;
}
