import { createMessages } from "@/lib/i18n/messages";
import type { ScholarlyMetadata } from "@/lib/types";
import { UiMessage, UiText } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

export function ScholarlyMetadataDetails({ metadata }: { metadata: ScholarlyMetadata }) {
  return <div className="mt-2 space-y-1 text-xs text-ink-3 [overflow-wrap:anywhere]" data-testid="scholarly-metadata">
    <p><UiMessage messageKey={metadata.workType === "preprint" ? "scholarlyMetadata.preprint" : metadata.workType === "journal-article" ? "scholarlyMetadata.journalArticle" : "scholarlyMetadata.record"} /></p>
    <p><UiMessage messageKey={metadata.evidenceScope === "paper-text" ? "scholarlyMetadata.paperText" : metadata.evidenceScope === "abstract-page" ? "scholarlyMetadata.abstractOnly" : "scholarlyMetadata.publisherPage"} /></p>
    <p><UiText source={metadata.authors.length ? copy("scholarlyMetadata.authors", { provider: metadata.provider, authors: metadata.authors.join(", ") }) : copy("scholarlyMetadata.authorsNotSupplied", { provider: metadata.provider })} /></p>
    {metadata.authorCount !== undefined && metadata.authors.length < metadata.authorCount && <p><UiMessage messageKey={metadata.authorsTruncated ? metadata.authorCount === 1 ? "scholarlyMetadata.contributors.truncated.one" : "scholarlyMetadata.contributors.truncated.other" : metadata.authorCount === 1 ? "scholarlyMetadata.contributors.one" : "scholarlyMetadata.contributors.other"} values={{ recorded: metadata.authors.length, count: metadata.authorCount }} /></p>}
    {metadata.journal && <p><UiMessage messageKey={"scholarlyMetadata.journal"} values={{ value: metadata.journal }} /></p>}
    {metadata.publishedDate && <p><UiMessage messageKey={"scholarlyMetadata.published"} values={{ value: metadata.publishedDate }} /></p>}
    {metadata.doi && <p><UiMessage messageKey={"scholarlyMetadata.doi"} values={{ value: metadata.doi }} /></p>}
    {metadata.arxivId && <p><UiMessage messageKey={"scholarlyMetadata.arxiv"} values={{ value: metadata.arxivId }} /></p>}
    <p><UiMessage messageKey={"scholarlyMetadata.observed"} values={{ retrievedAt: metadata.retrievedAt }} /></p>
  </div>;
}
