/**
 * /sources — the public source registry. Every source listed with Keryx,
 * rendered server-side so the catalogue is crawlable: price per read, the
 * on-chain registration stamp, and lifetime citation earnings from real
 * settled payments. Creators get a canonical public listing to point at;
 * askers see exactly what corpus backs the answers they buy.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SourceRegistryRow } from "@/components/keryx/source-registry-row";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { fmtUsdc } from "@/components/keryx/phase-style";
import type { Source } from "@/lib/types";
import { safeInlineJson } from "@/lib/safe-json";
import type { PublicReference } from "@/lib/public-references/catalog";

// Recompute a few times an hour — new registrations arrive via the indexer.
export const dynamic = "force-dynamic";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "The Registry — paid sources and free public references";
const DESCRIPTION =
  "Browse Keryx's creator registry and free public references. Inspect paid-source registration and settled earnings, or follow public references to their publishers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/sources" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/sources`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

interface RegistryEntry {
  source: Source;
  totalEarnedUsdc: number;
  citationCount: number;
}

async function loadRegistry(): Promise<RegistryEntry[]> {
  try {
    const db = await getDb();
    const [sources, leaderboard] = await Promise.all([db.listSources(), db.creatorLeaderboard()]);
    const earningsById = new Map(leaderboard.map((e) => [e.sourceId, e]));
    return sources
      .map((source) => {
        const e = earningsById.get(source.id);
        return {
          source,
          totalEarnedUsdc: e?.totalEarnedUsdc ?? 0,
          citationCount: e?.citationCount ?? 0,
        };
      })
      .sort(
        (a, b) =>
          b.totalEarnedUsdc - a.totalEarnedUsdc ||
          Number(!!b.source.onchainId) - Number(!!a.source.onchainId) ||
          b.source.createdAt.localeCompare(a.source.createdAt),
      );
  } catch {
    return [];
  }
}

async function loadPublicReferences(): Promise<PublicReference[]> {
  try {
    const db = await getDb();
    return (await db.listPublicReferences?.() ?? []).filter((reference) => reference.active);
  } catch {
    return [];
  }
}

export default async function SourcesPage() {
  const [entries, publicReferences] = await Promise.all([loadRegistry(), loadPublicReferences()]);
  const onchainCount = entries.filter((e) => e.source.onchainId).length;
  const totalPaid = entries.reduce((s, e) => s + e.totalEarnedUsdc, 0);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Keryx Source Registry",
      description: DESCRIPTION,
      url: `${BASE}/sources`,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: entries.length + publicReferences.length,
        itemListElement: [...entries.map((e) => ({ url: `${BASE}/creator/${e.source.id}`, name: e.source.name })),
          ...publicReferences.map((reference) => ({ url: reference.url, name: reference.name }))].slice(0, 100).map((entry, i) => ({
          "@type": "ListItem",
          position: i + 1,
          ...entry,
        })),
      },
    },
    breadcrumbJsonLd(BASE, [{ name: "Keryx", path: "/" }, { name: "The Registry" }]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeInlineJson(jsonLd) }}
      />

      <main className="mx-auto max-w-[860px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          The registry
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
          Every source, <em className="italic text-paid">on the record.</em>
        </h1>
        <p className="mt-4 max-w-[62ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          {entries.length > 0 ? (
            <>
              {entries.length} source{entries.length !== 1 ? "s" : ""} listed — {onchainCount}{" "}
              registered on-chain from the creator&apos;s own wallet.{" "}
              <span className="text-paid">${fmtUsdc(totalPaid)}</span> paid to these creators to
              date, one citation at a time.
            </>
          ) : (
            <>The registry is empty — be the first to list a source.</>
          )}
        </p>

        {entries.length > 0 && (
          <div className="mt-10 flex flex-col gap-4">
            {entries.map((e) => (
              <SourceRegistryRow
                key={e.source.id}
                source={e.source}
                totalEarnedUsdc={e.totalEarnedUsdc}
                citationCount={e.citationCount}
              />
            ))}
          </div>
        )}

        <section className="mt-12 border-t border-ink pt-6" aria-labelledby="public-references-title">
          <h2 id="public-references-title" className="font-display text-2xl text-ink">Free public references</h2>
          <p className="mt-3 max-w-[62ch] font-serif text-[15px] leading-relaxed text-ink-2">
            Public RSS feed bodies supplement the creator corpus. Keryx reads only what the feed supplies;
            an excerpt or abstract may omit parts of the article. Follow the publisher link for the original.
            These references carry no publisher ownership verification or creator payment.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            {publicReferences.map((reference) => (
              <article key={reference.id} className="border border-line bg-paper p-5">
                <a href={reference.url} target="_blank" rel="noopener noreferrer" className="font-serif text-lg text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                  {reference.name} ↗
                </a>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">Free public reference · no creator payment</p>
                <p className="mt-3 font-serif text-[14px] leading-relaxed text-ink-2">{reference.description}</p>
                <p className="mt-3 font-mono text-[10px] text-ink-3">{reference.items.length} recent feed item{reference.items.length === 1 ? "" : "s"} available</p>
              </article>
            ))}
            {publicReferences.length === 0 && <p className="font-mono text-xs text-ink-3">No public references are available yet.</p>}
          </div>
        </section>

        <div className="mt-12 border-t border-ink pt-6">
          <Link
            href="/register"
            className="inline-block border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
          >
            List your writing ▸
          </Link>
          <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
            Listing is permissionless — paste an RSS feed, prove you own it, and every citation
            pays your wallet directly. Not sure what to list?{" "}
            <Link href="/wanted" className="underline underline-offset-4 hover:text-seal">
              See what the corpus couldn&apos;t answer
            </Link>
            .
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
