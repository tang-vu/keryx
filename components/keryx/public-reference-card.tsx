import { formatDate, formatCalendarDate, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import Link from "next/link";
import type { PublicReference } from "@/lib/public-references/catalog";
import { librarySearchMatches } from "@/lib/sources/library-browse";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

const CONTENT_LABELS: Record<PublicReference["items"][number]["deliveryKind"], string> = {
  full_text: copy("sourceFeed.fullText"),
  excerpt: copy("sourceFeed.excerpt"),
  abstract: copy("sourceFeed.abstract"),
  metadata_only: copy("sourceFeed.metadata"),
};

function displayDate(value?: string, includeTime = false) {
  return value ? (!includeTime ? formatCalendarDate(value) : null) ?? formatDate(value, "en", "UTC", includeTime ? {} : { timeStyle: undefined }) : null;
}

function FeedItem({ item }: { item: PublicReference["items"][number] }) {
  const published = displayDate(item.publishedAt);
  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="block break-words font-serif text-[14px] leading-snug text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
        {item.title || copy("sourceFeed.untitled")} ↗
      </a>
      <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] leading-relaxed text-ink-3">
        {published ? <span>{richCopy("sourceFeed.published", { date: <DisplayTime value={item.publishedAt!} dateOnly /> })}</span> : <span>{copy("sourceFeed.dateUnavailable")}</span>}
        <span>· {CONTENT_LABELS[item.deliveryKind]}</span>
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
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-paid">{copy("sourceFeed.kicker")}</p>
      <h3 className="mt-2 font-display text-[21px] font-medium leading-snug text-ink">
        <a href={reference.url} target="_blank" rel="noopener noreferrer" className="break-words transition-colors hover:text-seal">
          {reference.name} ↗
        </a>
      </h3>
      <p className="mt-1 break-words font-mono text-[11px] text-ink-3">{domain}</p>
      {reference.description && <p className={`mt-3 font-serif text-[14px] leading-relaxed text-ink-2 ${compact ? "line-clamp-2" : ""}`}>{reference.description}</p>}
      {reference.tags.length > 0 && (
        <ul aria-label={copy("sourceFeed.topics")} className="mt-3 flex flex-wrap gap-1.5">
          {reference.tags.slice(0, compact ? 3 : 5).map((tag) => <li key={tag} className="rounded border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{tag}</li>)}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {compact ? copy("sourceFeed.compactItems") : matchingItems.length ? copy(selectPlural(items.length) === "one" ? "sourceFeed.matching.one" : "sourceFeed.matching.other", { count: items.length, total: recentItems.length }) : copy(selectPlural(items.length) === "one" ? "sourceFeed.latest.one" : "sourceFeed.latest.other", { count: items.length })}
        </p>
        {items.length > 0 ? (
          <>
            <ul className="mt-1">{items.slice(0, shownCount).map((item) => <FeedItem key={item.id} item={item} />)}</ul>
            {!compact && remaining.length > 0 && (
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer py-3 font-mono text-[11px] text-seal underline underline-offset-4">{copy(selectPlural(remaining.length) === "one" ? "sourceFeed.more.one" : "sourceFeed.more.other", { count: remaining.length })}</summary>
                <ul>{remaining.map((item) => <FeedItem key={item.id} item={item} />)}</ul>
              </details>
            )}
          </>
        ) : <p className="mt-2 font-serif text-sm text-ink-3">{copy("sourceFeed.empty")}</p>}
      </div>

      <div className="mt-auto border-t border-line pt-3">
        {!compact && reference.archivedItemCount !== undefined && <Link href={`/sources?publisher=${encodeURIComponent(reference.id)}#article-library`}
          className="mb-2 inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4">
          {copy("sourceArchive.browse", { count: reference.archivedItemCount })} →
        </Link>}
        <p className="font-mono text-[11px] leading-relaxed text-ink-3">
          {refreshed ? <>{richCopy("sourceFeed.collected", { date: <DisplayTime value={reference.refreshedAt!} /> })}</> : copy("sourceFeed.collectedUnavailable")}
        </p>
        <p className="mt-1 font-serif text-xs leading-relaxed text-ink-3">{copy("sourceFeed.paymentNotice")}</p>
        {supportsClaim && !compact && (
          <Link href={`/claim-source?referenceId=${encodeURIComponent(reference.id)}`} className="mt-1 inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4">{copy("sourceFeed.claim")}</Link>
        )}
      </div>
    </article>
  );
}
