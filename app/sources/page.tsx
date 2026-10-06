/** The retained source directory: public reading material and creator listings. */

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
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { fmtUsdc } from "@/components/keryx/phase-style";
import { safeInlineJson } from "@/lib/safe-json";
import { loadSourceDirectory, unavailableSourceDirectory } from "@/lib/sources/source-directory";
import { EXPLORE_SOURCES } from "@/lib/public-references/explore-catalog";
import { browseLibrary, libraryBrowseHref, libraryPublisherGroups, parseLibraryFilters, spreadLibraryTopics, type LibraryRecord } from "@/lib/sources/library-browse";

export const dynamic = "force-dynamic";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "Sources — public references and creator listings";
const DESCRIPTION =
  "Find sources by topic, publisher or domain across the publisher directory, public citation history, retained feeds and creator listings. Reading scope and payments remain separate.";

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
  const allRecords: LibraryRecord[] = [...exploreRecords, ...citedRecords, ...feedRecords, ...creatorRecords];
  const visibleExplore = browseLibrary(exploreRecords, filters);
  const visibleCited = browseLibrary(citedRecords, filters);
  const visibleFeeds = browseLibrary(feedRecords, filters);
  const visibleCreators = browseLibrary(creatorRecords, filters);
  const matches = browseLibrary(allRecords, filters);
  const showCollection = (kind: LibraryRecord["kind"]) => filters.kind === "all" || filters.kind === kind;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Keryx Sources",
      description: DESCRIPTION,
      url: `${BASE}/sources`,
      mainEntity: {
        "@type": "ItemList",
        ...(countsReady ? { numberOfItems: allRecords.length } : {}),
        itemListElement: [
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
    breadcrumbJsonLd(BASE, [{ name: "Keryx", path: "/" }, { name: "Sources" }]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeInlineJson(jsonLd) }} />

      <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          The reading library
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
          Sources to <em className="italic text-paid">explore.</em>
        </h1>
        <p className="mt-4 max-w-[65ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          Explore publisher documentation and writing, follow documents cited in public answers, browse retained feeds and discover creator listings.
          Sources remain visible without publisher verification. Reading scope, publisher control
          and creator payments are separate records.
        </p>

        <div className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <Link href={libraryBrowseHref(filters, { kind: "explore" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">Publisher directory</p>
            <p className="mt-1 font-display text-3xl text-ink">{EXPLORE_SOURCES.length}</p>
            <p className="mt-1 font-serif text-sm text-ink-2">Original links · read when asked</p>
          </Link>
          {(citedSources.status === "unavailable" || citedSources.entries.length > 0) && <Link href={libraryBrowseHref(filters, { kind: "cited" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">Recently cited documents</p>
            <p className="mt-1 font-display text-3xl text-ink">{citedSources.status === "ready" ? citedSources.entries.length : "Unavailable"}</p>
            <p className="mt-1 font-serif text-sm text-ink-2">From public answer history</p>
          </Link>}
          {(publicReferences.status === "unavailable" || references.length > 0 || !hasSources) && <Link href={libraryBrowseHref(filters, { kind: "feed" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Public references</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {publicReferences.status === "ready" ? references.length : "Unavailable"}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">Retained feeds · {publicReferences.status === "ready" ? `${retainedItemCount} feed items` : "item count unavailable"}</p>
          </Link>}
          {(registry.status === "unavailable" || entries.length > 0 || !hasSources) && <Link href={libraryBrowseHref(filters, { kind: "creator" })} className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Creator listings</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {registry.status === "ready" ? entries.length : "Unavailable"}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">Registration and payment policies</p>
          </Link>}
        </div>
        {!countsReady && (
          <p className="mt-3 font-serif text-sm text-ink-2">
            Part of the directory could not be loaded. Available records are shown below; a missing count is not an empty catalog.
          </p>
        )}

        <SourceLibraryFilters filters={filters} total={allRecords.length} matched={matches.length} publishers={libraryPublisherGroups(matches)} />
        {matches.length === 0 && <div className="mt-5 border border-line bg-paper p-5">
          <h2 className="font-display text-xl text-ink">No sources match these filters</h2>
          <p className="mt-2 font-serif text-sm text-ink-2">Try a publisher name, a shorter search or another topic. <Link href="/sources#browse-sources" className="text-seal underline">Clear filters</Link> to browse all available records.</p>
        </div>}

        {showCollection("explore") && visibleExplore.length > 0 && <section id="publisher-directory" className="mt-10 scroll-mt-6" aria-labelledby="publisher-directory-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="publisher-directory-title" className="font-display text-2xl text-ink">Publisher directory</h2>
            <span className="font-mono text-[11px] text-ink-3">{visibleExplore.length} publisher link{visibleExplore.length === 1 ? "" : "s"}</span>
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">Starting points for AI and agents, data and infrastructure, payments, and creator research. These are links to original publishers, not retained article evidence. Open the publisher or draft a question with its URL; available content still needs to be read and assessed.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">{visibleExplore.slice(0, 12).map(({ data }) => <ExploreSourceCard key={data.id} source={data} />)}</div>
          {visibleExplore.length > 12 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">Show {visibleExplore.length - 12} more publisher links</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visibleExplore.slice(12).map(({ data }) => <ExploreSourceCard key={data.id} source={data} />)}</div></details>}
        </section>}

        {showCollection("cited") && (citedSources.status === "unavailable" || visibleCited.length > 0) && <section id="cited-sources" className="mt-10 scroll-mt-6" aria-labelledby="cited-sources-title">
          <h2 id="cited-sources-title" className="border-b border-ink pb-3 font-display text-2xl text-ink">Cited in past answers</h2>
          {citedSources.status === "ready" ? <>
            <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">Showing up to 40 public documents from the latest {citedSources.runCount} public question record{citedSources.runCount === 1 ? "" : "s"}. Open the original document or inspect its cited answer. Past citations do not certify publisher control or content accuracy; past public reads stay free.</p>
            <p className="mt-2 font-mono text-[11px] text-ink-3">{visibleCited.length} documents match this view.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">{visibleCited.slice(0, 12).map(({ data }) => <CitedSourceCard key={data.url} entry={data} />)}</div>
            {visibleCited.length > 12 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">Show {visibleCited.length - 12} more cited documents</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visibleCited.slice(12).map(({ data }) => <CitedSourceCard key={data.url} entry={data} />)}</div></details>}
          </> : <p role="status" className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">Public citation history is temporarily unavailable. Reload to retry; other source collections remain available.</p>}
        </section>}

        {showCollection("feed") && (publicReferences.status === "unavailable" || visibleFeeds.length > 0 || !hasSources) && <section id="public-references" className="mt-10 scroll-mt-6" aria-labelledby="public-references-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="public-references-title" className="font-display text-2xl text-ink">Public references</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">Free reading · original publisher links</span>
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">
            These are retained feed snapshots. Keryx also discovers supported websites and PDFs
            when you ask a question; this directory is not a complete index of the web. A feed
            excerpt, abstract or video description may omit the full work. Listing here does not certify content accuracy.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {visibleFeeds.slice(0, 12).map(({ data }) => <PublicReferenceCard key={data.id} reference={data} matchingQuery={filters.q} />)}
          </div>
          {visibleFeeds.length > 12 && <details className="mt-5 border border-line bg-paper p-5"><summary className="min-h-11 cursor-pointer py-2 font-mono text-xs text-seal underline">Show {visibleFeeds.length - 12} more retained feeds</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{visibleFeeds.slice(12).map(({ data }) => <PublicReferenceCard key={data.id} reference={data} matchingQuery={filters.q} />)}</div></details>}
          {publicReferences.status === "unavailable" ? (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              Public references are temporarily unavailable. Try this page again to inspect the retained catalog.
            </p>
          ) : references.length === 0 && (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              No public feed snapshots are retained yet. You can still <Link href="/" className="text-seal underline underline-offset-4">ask a question</Link> with a public source URL.
            </p>
          )}
        </section>}

        {showCollection("creator") && (registry.status === "unavailable" || visibleCreators.length > 0 || !hasSources) && <section id="creator-listings" className="mt-12 scroll-mt-6" aria-labelledby="creator-listings-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
            <h2 id="creator-listings-title" className="font-display text-2xl text-ink">Creator listings</h2>
            {registry.status === "ready" && entries.length > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{onchainCount} registered on-chain</span>
            )}
          </div>
          <p className="mt-3 max-w-[75ch] font-serif text-[15px] leading-relaxed text-ink-2">
            Listings remain visible while publisher control is unverified. On-chain registration
            records a listing and its payout terms; it does not prove publisher control or content accuracy.
            Reading and earning eligibility depend on the applicable verification, policy and evidence checks.
          </p>
          {earningsStatus === "unavailable" ? (
            <p className="mt-3 font-serif text-sm text-ink-2">Settled earnings could not be loaded. No zero balance is inferred.</p>
          ) : totalPaid > 0 && (
            <p className="mt-3 font-serif text-sm text-ink-2">
              <span className="text-paid">${fmtUsdc(totalPaid)} USDC</span> in recorded settled creator earnings.
            </p>
          )}
          <div className="mt-5 flex flex-col gap-4">
            {visibleCreators.map(({ data }) => <SourceRegistryRow key={data.source.id} {...data} />)}
          </div>
          {registry.status === "unavailable" ? (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              Creator listings are temporarily unavailable. Public references have their own availability and free-reading status.
            </p>
          ) : entries.length === 0 && (
            <div className="mt-5 border border-line bg-paper p-5">
              <p className="font-serif text-[15px] text-ink-2">No creator listings are recorded yet.</p>
              <p className="mt-2 font-serif text-sm text-ink-3">Public references can support answers without generating creator payments.</p>
            </div>
          )}
        </section>}

        <div className="mt-12 border-t border-ink pt-6">
          <h2 className="font-display text-2xl text-ink">Is your writing here?</h2>
          <p className="mt-3 max-w-[70ch] font-serif text-[15px] leading-relaxed text-ink-2">
            Claim a supported HTTPS source to prove publishing control, or register a creator listing.
            Verification alone earns nothing. A separate eligible payment policy applies only to new uses; past public reads stay free.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/claim-source" className="inline-block border border-ink bg-seal px-[18px] py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-paper transition-colors hover:bg-ink">
              Claim your source ▸
            </Link>
            <Link href="/register" className="inline-block border border-ink bg-paper px-[18px] py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-paper-2">
              Register a listing ▸
            </Link>
          </div>
          <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-ink-3">
            Not sure what to list? <Link href="/wanted" className="underline underline-offset-4 hover:text-seal">See what the corpus couldn&apos;t answer</Link>.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
