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
import { fmtUsdc } from "@/components/keryx/phase-style";
import type { Source } from "@/lib/types";

// Recompute a few times an hour — new registrations arrive via the indexer.
export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "The Registry — every source Keryx pays";
const DESCRIPTION =
  "Browse every content source registered with Keryx: price per read, on-chain registration proof, and lifetime citation earnings — settled in USDC on Arc, no platform cut.";

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

export default async function SourcesPage() {
  const entries = await loadRegistry();
  const onchainCount = entries.filter((e) => e.source.onchainId).length;
  const totalPaid = entries.reduce((s, e) => s + e.totalEarnedUsdc, 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Keryx Source Registry",
    description: DESCRIPTION,
    url: `${BASE}/sources`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: entries.length,
      itemListElement: entries.slice(0, 100).map((e, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${BASE}/creator/${e.source.id}`,
        name: e.source.name,
      })),
    },
  };

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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

        <div className="mt-12 border-t border-ink pt-6">
          <Link
            href="/register"
            className="inline-block border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
          >
            List your writing ▸
          </Link>
          <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
            Listing is permissionless — paste an RSS feed, prove you own it, and every citation
            pays your wallet directly.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
