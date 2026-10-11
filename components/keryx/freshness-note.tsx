/**
 * "Does this answer still stand?" — metadata-only freshness under an archived dispatch.
 *
 * A changed exact content version is stronger than a new-post signal, but neither is a correctness
 * verdict. This component never reads replacement bodies and never initiates spend: the reader
 * chooses whether to run a fresh paid dispatch.
 */

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import Link from "next/link";
import type { Freshness } from "@/lib/answers-freshness";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

interface Props {
  freshness: Freshness;
  dispatchId: string;
  question: string;
}

function newPublicationNotice(count: number, moved: number, cited: number): string {
  const values = { count, moved, cited };
  if (moved === cited) {
    if (cited === 1) return copy(count === 1 ? "reportFreshness.newFromOne.one" : "reportFreshness.newFromOne.other", values);
    return copy(count === 1 ? "reportFreshness.newFromAll.one" : "reportFreshness.newFromAll.other", values);
  }
  return copy(count === 1 ? "reportFreshness.newFromSubset.one" : "reportFreshness.newFromSubset.other", values);
}

export function FreshnessNote({ freshness, dispatchId, question }: Props) {
  if (freshness.citedCount === 0 && freshness.unavailableSourceChecks === 0) return null;

  const {
    newItems,
    sources,
    citedCount,
    watchedCount,
    versionedCitations,
    currentVersions,
    supersededVersions,
    unavailableVersions,
    versions,
    unavailableSourceChecks,
    publicationCheck,
  } = freshness;
  const reAsk = `/?q=${encodeURIComponent(question)}&parent=${dispatchId}&run=1`;
  const auditPath = `/api/dispatch/${dispatchId}/freshness`;
  const drifted = versions.filter((item) => item.status === "superseded");

  if (supersededVersions > 0) {
    return (
      <section
        aria-label={copy("reportFreshness.label")}
        className="mt-8 max-w-[860px] border-2 border-ink bg-paper p-[5px]"
      >
        <div className="border border-ink px-5 py-4">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
            {copy("reportFreshness.moved")}
          </p>
          <p className="mt-2 font-serif text-[15px] leading-[1.6] text-ink">
            {copy(versionedCitations === 1 ? "reportFreshness.superseded.one" : "reportFreshness.superseded.other", { changed: supersededVersions, count: versionedCitations })}
          </p>
          <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {drifted.map((item) => (
              <li key={`${item.sourceId}:${item.itemId}:${item.marker}`}>
                <Link
                  href={`/creator/${item.sourceId}`}
                  className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-seal hover:text-seal"
                >
                  {copy("reportFreshness.changedAsset", { title: item.itemTitle ?? item.sourceName })}
                </Link>
              </li>
            ))}
          </ul>
          {newItems > 0 ? (
            <p className="mt-3 font-mono text-[10px] leading-[1.5] text-ink-3">
              {copy(newItems === 1 ? "reportFreshness.newFeedItems.one" : "reportFreshness.newFeedItems.other", { count: newItems })}
            </p>
          ) : null}
          {unavailableVersions > 0 || unavailableSourceChecks > 0 || publicationCheck === "unavailable" ? (
            <p className="mt-2 font-mono text-[10px] leading-[1.5] text-seal">
              {copy("reportFreshness.partial")}
            </p>
          ) : null}
          <FreshnessActions reAsk={reAsk} auditPath={auditPath} />
        </div>
      </section>
    );
  }

  if (newItems === 0) {
    if (
      unavailableVersions > 0 ||
      unavailableSourceChecks > 0 ||
      publicationCheck === "unavailable"
    ) {
      return (
        <section
          aria-label={copy("reportFreshness.label")}
          className="mt-8 max-w-[860px] border-l-2 border-seal pl-4"
        >
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
            {copy("reportFreshness.incomplete")}
          </p>
          <p className="mt-1.5 font-serif text-[14.5px] leading-[1.6] text-ink-2">
            {copy("reportFreshness.incompleteNotice")}
          </p>
          <AuditLink href={auditPath} />
        </section>
      );
    }

    if (watchedCount === 0 && versionedCitations === 0) return null;

    const subject =
      watchedCount === 0
        ? null
        : watchedCount === citedCount
          ? citedCount === 1
            ? copy("reportFreshness.quietAll.one")
            : copy("reportFreshness.quietAll.other", { count: citedCount })
          : watchedCount === 1
            ? copy("reportFreshness.quietWatched.one")
            : copy("reportFreshness.quietWatched.other", { watched: watchedCount, count: citedCount });

    return (
      <section
        aria-label={copy("reportFreshness.label")}
        className="mt-8 max-w-[860px] border-l-2 border-line pl-4"
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          {copy("reportFreshness.current")}
        </p>
        <p className="mt-1.5 font-serif text-[14.5px] leading-[1.6] text-ink-2">
          {versionedCitations > 0
            ? copy(currentVersions === 1 ? "reportFreshness.currentVersions.one" : "reportFreshness.currentVersions.other", { count: currentVersions })
            : null}{" "}
          {subject}
        </p>
        <AuditLink href={auditPath} />
      </section>
    );
  }

  return (
    <section
      aria-label={copy("reportFreshness.label")}
      className="mt-8 max-w-[860px] border-2 border-ink bg-paper p-[5px]"
    >
      <div className="border border-ink px-5 py-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
          {copy("reportFreshness.new")}
        </p>
        <p className="mt-2 font-serif text-[15px] leading-[1.6] text-ink">
          {newPublicationNotice(newItems, sources.length, citedCount)}
        </p>
        {versionedCitations > 0 ? (
          <p className="mt-2 font-mono text-[10px] leading-[1.5] text-ink-3">
            {copy(versionedCitations === 1 ? "reportFreshness.versionSummary.one" : "reportFreshness.versionSummary.other", { current: currentVersions, count: versionedCitations })}
          </p>
        ) : null}
        {unavailableVersions > 0 || unavailableSourceChecks > 0 || publicationCheck === "unavailable" ? (
          <p className="mt-2 font-mono text-[10px] leading-[1.5] text-seal">
            {copy("reportFreshness.partialCurrent")}
          </p>
        ) : null}
        <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {sources.map((source) => (
            <li key={source.sourceId}>
              <Link
                href={`/creator/${source.sourceId}`}
                className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-seal hover:text-seal"
              >
                {source.name} · +{source.newItems}
              </Link>
            </li>
          ))}
        </ul>
        <FreshnessActions reAsk={reAsk} auditPath={auditPath} />
      </div>
    </section>
  );
}

function AuditLink({ href }: { href: string }) {
  return (
    <p className="mt-2 font-mono text-[10px] text-ink-3">
      <a href={href} className="underline decoration-line underline-offset-2 hover:text-ink">
        {copy("reportFreshness.audit")}
      </a>
    </p>
  );
}

function FreshnessActions({ reAsk, auditPath }: { reAsk: string; auditPath: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-[46ch] font-mono text-[10px] leading-[1.5] text-ink-3">
        {richCopy("reportFreshness.reaskNotice", { audit: <a href={auditPath} className="underline decoration-line underline-offset-2 hover:text-ink">{copy("reportFreshness.jsonAudit")}</a> })}
      </p>
      <Link
        href={reAsk}
        className="border border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream transition-opacity hover:opacity-85"
      >
        {copy("reportFreshness.reask")}
      </Link>
    </div>
  );
}
