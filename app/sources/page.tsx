/** The retained source directory: public reading material and creator listings. */

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SourceRegistryRow } from "@/components/keryx/source-registry-row";
import { PublicReferenceCard } from "@/components/keryx/public-reference-card";
import { CitedSourceCard } from "@/components/keryx/cited-source-card";
import { ExploreSourceCard } from "@/components/keryx/explore-source-card";
import { SourceLibraryFilters } from "@/components/keryx/source-library-filters";
import { PaperCard } from "@/components/keryx/paper-card";
import { PaperSearchPanel } from "@/components/keryx/paper-search-panel";
import { PAPER_CATALOG } from "@/lib/papers/catalog";
import { groupPaperWorks } from "@/lib/papers/work-groups";
import { paperMatches } from "@/lib/papers/filters";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { fmtUsdc } from "@/components/keryx/phase-style";
import { safeInlineJson } from "@/lib/safe-json";
import { loadSourceDirectory, unavailableSourceDirectory } from "@/lib/sources/source-directory";
import { EXPLORE_SOURCES } from "@/lib/public-references/explore-catalog";
import { browseLibrary, libraryBrowseHref, libraryPublisherGroups, parseLibraryFilters, spreadLibraryTopics, type LibraryRecord } from "@/lib/sources/library-browse";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

export const dynamic = "force-dynamic";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = copy("sourceLibrary.title");
const DESCRIPTION =
  copy("sourceLibrary.description");

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/sources" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/sources`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function SourcesPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const filters = parseLibraryFilters(await searchParams ?? {});
  let directory;
  try {
    directory = await loadSourceDirectory(await getDb());
  } catch {
    directory = unavailableSourceDirectory();
  }
  const { registry, publicReferences, citedSources, earningsStatus } = directory;
  const entries = registry.entries;
  const references = publicReferences.entries;
  const countsReady = registry.status === "ready" && publicReferences.status === "ready" && citedSources.status === "ready";
  const hasSources = entries.length + references.length + citedSources.entries.length > 0;
  const onchainCount = entries.filter((entry) => entry.source.onchainId).length;
  const totalPaid = entries.reduce((sum, entry) => sum + (entry.totalEarnedUsdc ?? 0), 0);
  const retainedItemCount = references.reduce((sum, reference) => sum + reference.items.length, 0);
  const exploreRecords = spreadLibraryTopics(EXPLORE_SOURCES.map(source => ({ ...source, kind: "explore" as const, data: source })));
  const citedRecords = citedSources.entries.map(entry => ({ id: entry.url, name: entry.title, url: entry.url,
    kind: "cited" as const, observedAt: entry.citedAt, data: entry }));
  const feedRecords = references.map(reference => ({ ...reference, kind: "feed" as const,
    itemTitles: reference.items.map(item => item.title), observedAt: reference.refreshedAt, data: reference }));
  const creatorRecords = entries.map(entry => ({ ...entry.source, kind: "creator" as const,
    observedAt: entry.source.createdAt, data: entry }));
  const paperGroups = groupPaperWorks(PAPER_CATALOG);
  // Interleave repositories so the first screen includes more than one archive.
  const repositories = [...new Set(paperGroups.map(group => group.record.repository))];
  const grouped = repositories.map(repository => paperGroups.filter(group => group.record.repository === repository));
  const balancedPapers = Array.from({ length: Math.max(0, ...grouped.map(group => group.length)) }, (_, index) => grouped.flatMap(group => group[index] ? [group[index]] : [])).flat();
  const paperRecords = balancedPapers.map(group => ({ id: group.id, name: group.record.title, url: group.record.url,
    kind: "paper" as const, tags: ["scholarly", ...group.records.flatMap(record => [...record.authors, record.doi ?? "", record.arxivId ?? "", record.venue ?? ""])],
    itemTitles: group.records.map(record => record.title), observedAt: group.record.metadataObservedAt, papers: group.records, data: group }));
  const allRecords: LibraryRecord[] = [...paperRecords, ...exploreRecords, ...citedRecords, ...feedRecords, ...creatorRecords];
  const visibleExplore = browseLibrary(exploreRecords, filters);
  const visibleCited = browseLibrary(citedRecords, filters);
  const visibleFeeds = browseLibrary(feedRecords, filters);
  const visibleCreators = browseLibrary(creatorRecords, filters);
  const visiblePapers = browseLibrary(paperRecords, filters).map(({ data }) => ({ ...data,
    record: data.records.find(record => paperMatches(record, filters)) ?? data.record }));
  const matches = browseLibrary(allRecords, filters);
  const showCollection = (kind: LibraryRecord["kind"]) => filters.kind === "all" || filters.kind === kind;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: copy("sourceLibrary.name"),
      description: DESCRIPTION,
      url: `${BASE}/sources`,
      mainEntity: {
        "@type": "ItemList",
        ...(countsReady ? { numberOfItems: allRecords.length } : {}),
        itemListElement: [
          ...paperGroups.map(group => ({ url: group.record.url, name: group.record.title })),
          ...EXPLORE_SOURCES.map(source => ({ url: source.url, name: source.name })),
          ...citedSources.entries.map(entry => ({ url: entry.url, name: entry.title })),
          ...references.map((reference) => ({ url: reference.url, name: reference.name })),
          ...entries.map((entry) => ({ url: `${BASE}/creator/${encodeURIComponent(entry.source.id)}`, name: entry.source.name })),
        ].slice(0, 100).map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          ...entry,
        })),
      },
    },
    breadcrumbJsonLd(BASE, [{ name: "Keryx", path: "/" }, { name: copy("sourceLibrary.crumb") }]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeInlineJson(jsonLd) }} />

      <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          {copy("sourceLibrary.kicker")}
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
          {richCopy("sourceLibrary.heading", { emphasis: <em className="italic text-paid">{copy("sourceLibrary.emphasis")}</em> })}
        </h1>
        <p className="mt-4 max-w-[65ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          {copy("sourceLibrary.intro")}
        </p>

        <div className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <Link href={libraryBrowseHref(filters, { kind: "paper" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">{copy("sourceLibrary.papers")}</p>
            <p className="mt-1 font-display text-3xl text-ink">{paperGroups.length}</p>
            <p className="mt-1 font-serif text-sm text-ink-2">{copy(PAPER_CATALOG.length === 1 ? "sourceLibrary.paperRecords.one" : "sourceLibrary.paperRecords.other", { count: PAPER_CATALOG.length })}</p>
          </Link>
          <Link href={libraryBrowseHref(filters, { kind: "explore" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">{copy("sourceLibrary.publisherDirectory")}</p>
            <p className="mt-1 font-display text-3xl text-ink">{EXPLORE_SOURCES.length}</p>
            <p className="mt-1 font-serif text-sm text-ink-2">{copy("sourceLibrary.publisherLinks")}</p>
          </Link>
          {(citedSources.status === "unavailable" || citedSources.entries.length > 0) && <Link href={libraryBrowseHref(filters, { kind: "cited" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">{copy("sourceLibrary.citedDocuments")}</p>
            <p className="mt-1 font-display text-3xl text-ink">{citedSources.status === "ready" ? citedSources.entries.length : copy("sourceLibrary.unavailable")}</p>
            <p className="mt-1 font-serif text-sm text-ink-2">{copy("sourceLibrary.publicHistory")}</p>
          </Link>}
          {(publicReferences.status === "unavailable" || references.length > 0 || !hasSources) && <Link href={libraryBrowseHref(filters, { kind: "feed" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{copy("sourceLibrary.publicReferences")}</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {publicReferences.status === "ready" ? references.length : copy("sourceLibrary.unavailable")}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">{publicReferences.status === "ready" ? copy(retainedItemCount === 1 ? "sourceLibrary.feedItems.one" : "sourceLibrary.feedItems.other", { count: retainedItemCount }) : copy("sourceLibrary.feedItemsUnavailable")}</p>
          </Link>}
          {(registry.status === "unavailable" || entries.length > 0 || !hasSources) && <Link href={libraryBrowseHref(filters, { kind: "creator" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{copy("sourceLibrary.creatorListings")}</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {registry.status === "ready" ? entries.length : copy("sourceLibrary.unavailable")}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">{copy("sourceLibrary.registrationPolicies")}</p>
          </Link>}
        </div>
        {!countsReady && (
          <p className="mt-3 font-serif text-sm text-ink-2">
            {copy("sourceLibrary.directoryUnavailable")}
          </p>
        )}

        <SourceLibraryFilters filters={filters} total={allRecords.length} matched={matches.length} publishers={libraryPublisherGroups(matches)} />

        <Link prefetch={false} href="/literature" className="mt-5 flex min-h-11 flex-wrap items-center justify-between gap-3 border border-line bg-panel p-5 text-ink">
          <span><span className="block font-display text-xl">{copy("sourceLibrary.reviewQuestion")}</span><span className="mt-1 block font-serif text-sm text-ink-2">{copy("sourceLibrary.reviewNotice")}</span></span>
          <span className="font-mono text-xs text-seal underline">{copy("sourceLibrary.openWorkspace")}</span>
        </Link>

        {showCollection("paper") && <section id="research-papers" className="mt-10 scroll-mt-6" aria-labelledby="research-papers-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="research-papers-title" className="font-display text-2xl text-ink">{copy("sourceLibrary.papers")}</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{copy("sourceLibrary.freeDiscovery")}</span>
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">{copy("sourceLibrary.bibliographyNotice")}</p>
          <p className="mt-2 font-mono text-[11px] text-ink-3">{copy(visiblePapers.length === 1 ? "sourceLibrary.paperMatches.one" : "sourceLibrary.paperMatches.other", { count: visiblePapers.length, total: PAPER_CATALOG.length })}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">{visiblePapers.slice(0, 8).map(group => <PaperCard key={group.id} group={group} />)}</div>
          {visiblePapers.length > 8 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">{copy(visiblePapers.length - 8 === 1 ? "sourceLibrary.morePapers.one" : "sourceLibrary.morePapers.other", { count: visiblePapers.length - 8 })}</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visiblePapers.slice(8).map(group => <PaperCard key={group.id} group={group} />)}</div></details>}
          {visiblePapers.length === 0 && <p className="mt-4 font-serif text-sm text-ink-2">{copy("sourceLibrary.papersEmpty")}</p>}
          <PaperSearchPanel key={JSON.stringify(filters)} initialQuery={filters.doi ?? filters.q} author={filters.author} year={filters.year} />
          <p className="mt-4 font-serif text-sm text-ink-2">{richCopy("sourceLibrary.externalIndexes", { openAlex: <a href="https://openalex.org/" target="_blank" rel="noopener noreferrer" className="text-seal underline">OpenAlex ↗</a>, doaj: <a href="https://doaj.org/" target="_blank" rel="noopener noreferrer" className="text-seal underline">DOAJ ↗</a> })}</p>
        </section>}
        {matches.length === 0 && <div className="mt-5 border border-line bg-paper p-5">
          <h2 className="font-display text-xl text-ink">{copy("sourceLibrary.emptyTitle")}</h2>
          <p className="mt-2 font-serif text-sm text-ink-2">{richCopy("sourceLibrary.emptyNotice", { clear: <Link href="/sources#browse-sources" className="text-seal underline">{copy("sourceLibrary.clear")}</Link> })}</p>
        </div>}

        {showCollection("explore") && visibleExplore.length > 0 && <section id="publisher-directory" className="mt-10 scroll-mt-6" aria-labelledby="publisher-directory-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="publisher-directory-title" className="font-display text-2xl text-ink">{copy("sourceLibrary.publisherDirectory")}</h2>
            <span className="font-mono text-[11px] text-ink-3">{copy(visibleExplore.length === 1 ? "sourceLibrary.publisherCount.one" : "sourceLibrary.publisherCount.other", { count: visibleExplore.length })}</span>
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">{copy("sourceLibrary.publisherNotice")}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">{visibleExplore.slice(0, 12).map(({ data }) => <ExploreSourceCard key={data.id} source={data} />)}</div>
          {visibleExplore.length > 12 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">{copy(visibleExplore.length - 12 === 1 ? "sourceLibrary.morePublishers.one" : "sourceLibrary.morePublishers.other", { count: visibleExplore.length - 12 })}</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visibleExplore.slice(12).map(({ data }) => <ExploreSourceCard key={data.id} source={data} />)}</div></details>}
        </section>}

        {showCollection("cited") && (citedSources.status === "unavailable" || visibleCited.length > 0) && <section id="cited-sources" className="mt-10 scroll-mt-6" aria-labelledby="cited-sources-title">
          <h2 id="cited-sources-title" className="border-b border-ink pb-3 font-display text-2xl text-ink">{copy("sourceLibrary.citedTitle")}</h2>
          {citedSources.status === "ready" ? <>
            <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">{copy(citedSources.runCount === 1 ? "sourceLibrary.citedNotice.one" : "sourceLibrary.citedNotice.other", { count: citedSources.runCount })}</p>
            <p className="mt-2 font-mono text-[11px] text-ink-3">{copy(visibleCited.length === 1 ? "sourceLibrary.documentsMatched.one" : "sourceLibrary.documentsMatched.other", { count: visibleCited.length })}</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">{visibleCited.slice(0, 12).map(({ data }) => <CitedSourceCard key={data.url} entry={data} />)}</div>
            {visibleCited.length > 12 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">{copy(visibleCited.length - 12 === 1 ? "sourceLibrary.moreCited.one" : "sourceLibrary.moreCited.other", { count: visibleCited.length - 12 })}</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visibleCited.slice(12).map(({ data }) => <CitedSourceCard key={data.url} entry={data} />)}</div></details>}
          </> : <p role="status" className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">{copy("sourceLibrary.citationsUnavailable")}</p>}
        </section>}

        {showCollection("feed") && (publicReferences.status === "unavailable" || visibleFeeds.length > 0 || !hasSources) && <section id="public-references" className="mt-10 scroll-mt-6" aria-labelledby="public-references-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="public-references-title" className="font-display text-2xl text-ink">{copy("sourceLibrary.publicReferences")}</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{copy("sourceLibrary.freeReading")}</span>
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">
            {copy("sourceLibrary.feedNotice")}
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {visibleFeeds.slice(0, 12).map(({ data }) => <PublicReferenceCard key={data.id} reference={data} matchingQuery={filters.q} />)}
          </div>
          {visibleFeeds.length > 12 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">{copy(visibleFeeds.length - 12 === 1 ? "sourceLibrary.moreFeeds.one" : "sourceLibrary.moreFeeds.other", { count: visibleFeeds.length - 12 })}</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visibleFeeds.slice(12).map(({ data }) => <PublicReferenceCard key={data.id} reference={data} matchingQuery={filters.q} />)}</div></details>}
          {publicReferences.status === "unavailable" ? (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              {copy("sourceLibrary.referencesUnavailable")}
            </p>
          ) : references.length === 0 && (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              {richCopy("sourceLibrary.feedEmpty", { ask: <Link href="/" className="text-seal underline underline-offset-4">{copy("sourceLibrary.ask")}</Link> })}
            </p>
          )}
        </section>}

        {showCollection("creator") && (registry.status === "unavailable" || visibleCreators.length > 0 || !hasSources) && <section id="creator-listings" className="mt-12 scroll-mt-6" aria-labelledby="creator-listings-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="creator-listings-title" className="font-display text-2xl text-ink">{copy("sourceLibrary.creatorListings")}</h2>
            {registry.status === "ready" && entries.length > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{copy(onchainCount === 1 ? "sourceLibrary.registered.one" : "sourceLibrary.registered.other", { count: onchainCount })}</span>
            )}
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">
            {copy("sourceLibrary.creatorNotice")}
          </p>
          {earningsStatus === "unavailable" ? (
            <p className="mt-3 font-serif text-sm text-ink-2">{copy("sourceLibrary.earningsUnavailable")}</p>
          ) : totalPaid > 0 && (
            <p className="mt-3 font-serif text-sm text-ink-2">
              {richCopy("sourceLibrary.earnings", { amount: <span className="text-paid">${fmtUsdc(totalPaid)} USDC</span> })}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-4">
            {visibleCreators.map(({ data }) => <SourceRegistryRow key={data.source.id} {...data} />)}
          </div>
          {registry.status === "unavailable" ? (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              {copy("sourceLibrary.creatorsUnavailable")}
            </p>
          ) : entries.length === 0 && (
            <div className="mt-5 border border-line bg-paper p-5">
              <p className="font-serif text-[15px] text-ink-2">{copy("sourceLibrary.creatorsEmpty")}</p>
              <p className="mt-2 font-serif text-sm text-ink-3">{copy("sourceLibrary.referencesPaymentNotice")}</p>
            </div>
          )}
        </section>}

        <div className="mt-12 border-t border-ink pt-6">
          <h2 className="font-display text-2xl text-ink">{copy("sourceLibrary.claimTitle")}</h2>
          <p className="mt-3 max-w-[70ch] font-serif text-[15px] leading-relaxed text-ink-2">
            {copy("sourceLibrary.claimNotice")}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/claim-source" className="inline-block border border-ink bg-seal px-[18px] py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-paper transition-colors hover:bg-ink">
              {copy("sourceLibrary.claim")}
            </Link>
            <Link href="/register" className="inline-block border border-ink bg-paper px-[18px] py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-paper-2">
              {copy("sourceLibrary.register")}
            </Link>
          </div>
          <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-ink-3">
            {richCopy("sourceLibrary.wanted", { wanted: <Link href="/wanted" className="underline underline-offset-4 hover:text-seal">{copy("sourceLibrary.unanswered")}</Link> })}
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
