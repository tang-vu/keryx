/** The retained source directory: public reading material and creator listings. */

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SourceRegistryRow } from "@/components/keryx/source-registry-row";
import { PublicReferenceCard } from "@/components/keryx/public-reference-card";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { fmtUsdc } from "@/components/keryx/phase-style";
import { safeInlineJson } from "@/lib/safe-json";
import { loadSourceDirectory, unavailableSourceDirectory } from "@/lib/sources/source-directory";

export const dynamic = "force-dynamic";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "Sources — public references and creator listings";
const DESCRIPTION =
  "Explore Keryx's retained public feeds and creator listings. Browse article titles, publication dates and available content, with publisher control and settled earnings shown separately.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/sources" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/sources`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function SourcesPage() {
  let directory;
  try {
    directory = await loadSourceDirectory(await getDb());
  } catch {
    directory = unavailableSourceDirectory();
  }
  const { registry, publicReferences, earningsStatus } = directory;
  const entries = registry.entries;
  const references = publicReferences.entries;
  const countsReady = registry.status === "ready" && publicReferences.status === "ready";
  const onchainCount = entries.filter((entry) => entry.source.onchainId).length;
  const totalPaid = entries.reduce((sum, entry) => sum + (entry.totalEarnedUsdc ?? 0), 0);
  const retainedItemCount = references.reduce((sum, reference) => sum + reference.items.length, 0);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Keryx Sources",
      description: DESCRIPTION,
      url: `${BASE}/sources`,
      mainEntity: {
        "@type": "ItemList",
        ...(countsReady ? { numberOfItems: entries.length + references.length } : {}),
        itemListElement: [
          ...references.map((reference) => ({ url: reference.url, name: reference.name })),
          ...entries.map((entry) => ({ url: `${BASE}/creator/${entry.source.id}`, name: entry.source.name })),
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
          Browse public writing and creator listings, then follow the original publisher.
          Public references remain available without publisher verification. Source control,
          available content and creator payments are separate records.
        </p>

        <div className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-3">
          <a href="#public-references" className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Public references</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {publicReferences.status === "ready" ? references.length : "Unavailable"}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">Retained feeds, free to read</p>
          </a>
          <a href="#creator-listings" className="bg-paper p-4 transition-colors hover:bg-paper-2 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Creator listings</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {registry.status === "ready" ? entries.length : "Unavailable"}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">Registration and payment policies</p>
          </a>
          <div className="bg-paper p-4 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Feed items retained</p>
            <p className="mt-1 font-display text-3xl text-ink">
              {publicReferences.status === "ready" ? retainedItemCount : "Unavailable"}
            </p>
            <p className="mt-1 font-serif text-sm text-ink-2">Full text, excerpts or metadata</p>
          </div>
        </div>
        {!countsReady && (
          <p className="mt-3 font-serif text-sm text-ink-2">
            Part of the directory could not be loaded. Available records are shown below; a missing count is not an empty catalog.
          </p>
        )}

        <section id="public-references" className="mt-10 scroll-mt-6" aria-labelledby="public-references-title">
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
            {references.map((reference) => <PublicReferenceCard key={reference.id} reference={reference} />)}
          </div>
          {publicReferences.status === "unavailable" ? (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              Public references are temporarily unavailable. Try this page again to inspect the retained catalog.
            </p>
          ) : references.length === 0 && (
            <p className="mt-5 border border-line bg-paper p-5 font-serif text-[15px] text-ink-2">
              No public feed snapshots are retained yet. You can still <Link href="/" className="text-seal underline underline-offset-4">ask a question</Link> with a public source URL.
            </p>
          )}
        </section>

        <section id="creator-listings" className="mt-12 scroll-mt-6" aria-labelledby="creator-listings-title">
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
            {entries.map((entry) => <SourceRegistryRow key={entry.source.id} {...entry} />)}
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
        </section>

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
