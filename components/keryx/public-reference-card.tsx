import { originalTechnicalText } from "@/shared/i18n/original-technical-text";
import { formatDate, formatCalendarDate, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import type { PublicReference } from "@/lib/public-references/catalog";
import { librarySearchMatches } from "@/lib/sources/library-browse";
import { UiElement, UiMessage, UiRichMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");


const CONTENT_LABELS = {
  full_text: "sourceFeed.fullText",
  excerpt: "sourceFeed.excerpt",
  abstract: "sourceFeed.abstract",
  metadata_only: "sourceFeed.metadata",
} as const;

function displayDate(value?: string, includeTime = false) {
  return value ? (!includeTime ? formatCalendarDate(value) : null) ?? formatDate(value, "en", "UTC", includeTime ? {} : { timeStyle: undefined }) : null;
}

function FeedItem({ item }: { item: PublicReference["items"][number] }) {
  const published = displayDate(item.publishedAt);
  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <a lang="und" dir="auto" href={item.link} target="_blank" rel="noopener noreferrer" className="block break-words font-serif text-[14px] leading-snug text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
        {item.title ? originalTechnicalText(item.title) : <UiMessage messageKey="sourceFeed.untitled" />} ↗
      </a>
      <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] leading-relaxed text-ink-3">
        {published ? <span><UiRichMessage messageKey={"sourceFeed.published"} values={{ date: <DisplayTime value={item.publishedAt!} dateOnly /> }} /></span> : <span><UiMessage messageKey={"sourceFeed.dateUnavailable"} /></span>}
        <span>· <UiMessage messageKey={CONTENT_LABELS[item.deliveryKind]} /></span>
      </p>
    </li>
  );
}

/** Feed metadata only; this record carries neither publisher-control nor payment authority. */
export function PublicReferenceCard({ reference, compact = false, matchingQuery = "" }: { reference: PublicReference; compact?: boolean; matchingQuery?: string }) {
  const domain = new URL(reference.url).hostname.replace(/^www\./, "");
  const supportsClaim = !/^(?:www\.)?(?:youtube\.com|youtu\.be)$/.test(new URL(reference.url).hostname);
  const refreshed = displayDate(reference.refreshedAt, true);
  const recentItems = [...reference.items].sort((a, b) =>
    (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  const metadata = { id: reference.id, name: reference.name, url: reference.url, description: reference.description, tags: reference.tags, kind: "feed" as const };
  const matchingItems = matchingQuery && !librarySearchMatches(metadata, matchingQuery)
    ? recentItems.filter(item => librarySearchMatches({ ...metadata, itemTitles: [item.title] }, matchingQuery)) : [];
  const items = matchingItems.length ? matchingItems : recentItems;
  const shownCount = compact ? 1 : 3;
  const remaining = items.slice(shownCount);

  return (
    <article className="flex min-w-0 flex-col border border-line bg-paper p-5 sm:p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-paid"><UiMessage messageKey={"sourceFeed.kicker"} /></p>
      <h3 lang="und" dir="auto" className="mt-2 font-display text-[21px] font-medium leading-snug text-ink">
        <a href={reference.url} target="_blank" rel="noopener noreferrer" className="break-words transition-colors hover:text-seal">
          {originalTechnicalText(reference.name)} ↗
        </a>
      </h3>
      <p lang="und" dir="auto" className="mt-1 break-words font-mono text-[11px] text-ink-3">{domain}</p>
      {reference.description && <p lang="und" dir="auto" className={`mt-3 font-serif text-[14px] leading-relaxed text-ink-2 ${compact ? "line-clamp-2" : ""}`}>{originalTechnicalText(reference.description)}</p>}
      {reference.tags.length > 0 && (
        <UiElement as="ul" namespaces={["source-directory"]} names={["aria-label"]} attributes={{ "aria-label": copy("sourceFeed.topics"), "className": "mt-3 flex flex-wrap gap-1.5" }}>
          {reference.tags.slice(0, compact ? 3 : 5).map((tag) => <li key={tag} lang="und" dir="auto" className="rounded border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{originalTechnicalText(tag)}</li>)}
        </UiElement>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {compact ? <UiMessage messageKey={"sourceFeed.compactItems"} /> : matchingItems.length ? <UiMessage messageKey={selectPlural(items.length) === "one" ? "sourceFeed.matching.one" : "sourceFeed.matching.other"} values={{ count: items.length, total: recentItems.length }} /> : <UiMessage messageKey={selectPlural(items.length) === "one" ? "sourceFeed.latest.one" : "sourceFeed.latest.other"} values={{ count: items.length }} />}
        </p>
        {items.length > 0 ? (
          <>
            <ul className="mt-1">{items.slice(0, shownCount).map((item) => <FeedItem key={item.id} item={item} />)}</ul>
            {!compact && remaining.length > 0 && (
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer py-3 font-mono text-[11px] text-seal underline underline-offset-4"><UiMessage messageKey={selectPlural(remaining.length) === "one" ? "sourceFeed.more.one" : "sourceFeed.more.other"} values={{ count: remaining.length }} /></summary>
                <ul>{remaining.map((item) => <FeedItem key={item.id} item={item} />)}</ul>
              </details>
            )}
          </>
        ) : <p className="mt-2 font-serif text-sm text-ink-3"><UiMessage messageKey={"sourceFeed.empty"} /></p>}
      </div>

      <div className="mt-auto border-t border-line pt-3">
        {!compact && reference.archivedItemCount !== undefined && <Link href={`/sources?publisher=${encodeURIComponent(reference.id)}#article-library`}
          className="mb-2 inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4">
          <UiMessage messageKey={"sourceArchive.browse"} values={{ count: reference.archivedItemCount }} /> →
        </Link>}
        <p className="font-mono text-[11px] leading-relaxed text-ink-3">
          {refreshed ? <><UiRichMessage messageKey={"sourceFeed.collected"} values={{ date: <DisplayTime value={reference.refreshedAt!} /> }} /></> : <UiMessage messageKey="sourceFeed.collectedUnavailable" />}
        </p>
        <p className="mt-1 font-serif text-xs leading-relaxed text-ink-3"><UiMessage messageKey={"sourceFeed.paymentNotice"} /></p>
        {supportsClaim && !compact && (
          <Link href={`/claim-source?referenceId=${encodeURIComponent(reference.id)}`} className="mt-1 inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4"><UiMessage messageKey={"sourceFeed.claim"} /></Link>
        )}
      </div>
    </article>
  );
}
