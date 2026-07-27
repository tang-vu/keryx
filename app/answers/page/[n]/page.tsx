/**
 * /answers/page/[n] — the older pages of the answer archive.
 *
 * Page 1 stays at /answers so the index keeps one canonical address; this route serves 2 and up.
 * Each page is its own indexable document with its own canonical URL: they are not duplicates of
 * the index, they are the only place a crawler can reach the older half of the corpus.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { buildTopics } from "@/lib/answers-topics";
import { paginateArchive, parsePageParam, answersPagePath } from "@/lib/answers-pagination";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ArchiveIndexView } from "@/components/keryx/archive-index-view";
import { archiveIndexJsonLd } from "../../archive-index-json-ld";

export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";

/**
 * Prerender nothing at build — the page count moves as the corpus grows, and every page is cheap
 * to render on demand. Declaring it is what marks the route cacheable; without it `revalidate`
 * above is ignored and each crawler hit re-renders from scratch.
 */
export function generateStaticParams(): { n: string }[] {
  return [];
}

async function loadPage(raw: string) {
  const n = parsePageParam(raw);
  if (n === null) return null;
  const entries = await getArchiveCached();
  const slice = paginateArchive(entries, n);
  return { entries, slice, n };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const { n } = await params;
  const loaded = await loadPage(n);
  if (!loaded || loaded.slice.items.length === 0) {
    return { title: "Archive page not found — Keryx", robots: { index: false } };
  }
  const { slice } = loaded;
  const title = `The Archive — page ${slice.page} of ${slice.totalPages}`;
  const description = `Older answers from the Keryx archive (page ${slice.page}) — each grounded in cited sources and settled with a real USDC micropayment to the writers it quoted.`;
  return {
    title,
    description,
    alternates: { canonical: answersPagePath(slice.page) },
    openGraph: {
      title,
      description,
      url: `${BASE}${answersPagePath(slice.page)}`,
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AnswersPageN({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const loaded = await loadPage(n);
  if (!loaded) notFound();
  // /answers/page/1 is the index under a second address — send it home rather than serve a
  // duplicate that competes with /answers in search.
  if (loaded.n === 1) redirect("/answers");
  if (loaded.slice.items.length === 0) notFound();

  const { entries, slice } = loaded;
  const jsonLd = [
    archiveIndexJsonLd({
      base: BASE,
      url: `${BASE}${answersPagePath(slice.page)}`,
      name: `Keryx Answer Archive — page ${slice.page}`,
      slice,
      totalEntries: entries.length,
      partOf: { name: "Keryx Answer Archive", url: `${BASE}/answers` },
    }),
    breadcrumbJsonLd(BASE, [
      { name: "Keryx", path: "/" },
      { name: "The Archive", path: "/answers" },
      { name: `Page ${slice.page}` },
    ]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ArchiveIndexView
        slice={slice}
        topics={buildTopics(entries)}
        totalEntries={entries.length}
        totalToCreators={entries.reduce((s, e) => s + e.toCreators, 0)}
      />
      <SiteFooter />
    </div>
  );
}
