/**
 * "Does this answer still stand?" — metadata-only freshness under an archived dispatch.
 *
 * A changed exact content version is stronger than a new-post signal, but neither is a correctness
 * verdict. This component never reads replacement bodies and never initiates spend: the reader
 * chooses whether to run a fresh paid dispatch.
 */

import Link from "next/link";
import type { Freshness } from "@/lib/answers-freshness";

interface Props {
  freshness: Freshness;
  dispatchId: string;
  question: string;
}

function publisherPhrase(moved: number, cited: number): string {
  if (moved === cited) {
    return cited === 1 ? "the one source this answer cited" : `all ${cited} sources this answer cited`;
  }
  return `${moved} of the ${cited} sources this answer cited`;
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
        aria-label="Answer freshness"
        className="mt-8 max-w-[860px] border-2 border-ink bg-paper p-[5px]"
      >
        <div className="border border-ink px-5 py-4">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
            Exact citation version moved
          </p>
          <p className="mt-2 font-serif text-[15px] leading-[1.6] text-ink">
            {supersededVersions} of {versionedCitations} versioned citation
            {versionedCitations !== 1 ? "s" : ""} no longer match the article asset Keryx
            currently indexes. The archived quotes and payments remain bound to the exact version
            bought for this dispatch; Keryx has not bought or judged the replacement.
          </p>
          <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {drifted.map((item) => (
              <li key={`${item.sourceId}:${item.itemId}:${item.marker}`}>
                <Link
                  href={`/creator/${item.sourceId}`}
                  className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-seal hover:text-seal"
                >
                  {item.itemTitle ?? item.sourceName} · changed
                </Link>
              </li>
            ))}
          </ul>
          {newItems > 0 ? (
            <p className="mt-3 font-mono text-[10px] leading-[1.5] text-ink-3">
              The cited feeds also contain {newItems} newly published post
              {newItems !== 1 ? "s" : ""} since this dispatch.
            </p>
          ) : null}
          {unavailableVersions > 0 || unavailableSourceChecks > 0 || publicationCheck === "unavailable" ? (
            <p className="mt-2 font-mono text-[10px] leading-[1.5] text-seal">
              This audit is partial: some current source, version, or publication metadata was
              unavailable.
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
          aria-label="Answer freshness"
          className="mt-8 max-w-[860px] border-l-2 border-seal pl-4"
        >
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
            Version check incomplete
          </p>
          <p className="mt-1.5 font-serif text-[14.5px] leading-[1.6] text-ink-2">
            Keryx could not complete every current source, exact-version, and publication-date
            check. The archived evidence remains intact, but silence here is not proof that the
            source is unchanged.
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
            ? "The source cited here has"
            : `All ${citedCount} sources cited here have`
          : watchedCount === 1
            ? "The one cited source Keryx follows a feed for has"
            : `The ${watchedCount} of ${citedCount} cited sources Keryx follows a feed for have`;

    return (
      <section
        aria-label="Answer freshness"
        className="mt-8 max-w-[860px] border-l-2 border-line pl-4"
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Exact receipt still current
        </p>
        <p className="mt-1.5 font-serif text-[14.5px] leading-[1.6] text-ink-2">
          {versionedCitations > 0
            ? `${currentVersions} exact cited article version${currentVersions !== 1 ? "s" : ""} still match Keryx's current index.`
            : null}{" "}
          {subject ? `${subject} published nothing new since this dispatch settled.` : null}
        </p>
        <AuditLink href={auditPath} />
      </section>
    );
  }

  return (
    <section
      aria-label="Answer freshness"
      className="mt-8 max-w-[860px] border-2 border-ink bg-paper p-[5px]"
    >
      <div className="border border-ink px-5 py-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
          New material since this dispatch
        </p>
        <p className="mt-2 font-serif text-[15px] leading-[1.6] text-ink">
          {newItems} new post{newItems !== 1 ? "s" : ""} {newItems !== 1 ? "have" : "has"} been
          published by {publisherPhrase(sources.length, citedCount)}. This dispatch never read{" "}
          {newItems !== 1 ? "them" : "it"} — it settled before{" "}
          {newItems !== 1 ? "they" : "it"} existed.
        </p>
        {versionedCitations > 0 ? (
          <p className="mt-2 font-mono text-[10px] leading-[1.5] text-ink-3">
            {currentVersions}/{versionedCitations} exact cited article versions still match the
            current Keryx index; new posts are separate assets this dispatch never read.
          </p>
        ) : null}
        {unavailableVersions > 0 || unavailableSourceChecks > 0 || publicationCheck === "unavailable" ? (
          <p className="mt-2 font-mono text-[10px] leading-[1.5] text-seal">
            Audit partial — unavailable checks are not counted as current.
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
        Inspect machine-readable audit
      </a>
    </p>
  );
}

function FreshnessActions({ reAsk, auditPath }: { reAsk: string; auditPath: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-[46ch] font-mono text-[10px] leading-[1.5] text-ink-3">
        Re-asking buys current material and pays its creators again. The archived receipt never
        changes. {" "}
        <a href={auditPath} className="underline decoration-line underline-offset-2 hover:text-ink">
          JSON audit
        </a>
      </p>
      <Link
        href={reAsk}
        className="border border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream transition-opacity hover:opacity-85"
      >
        Re-ask on current sources
      </Link>
    </div>
  );
}
