/**
 * /answers/topic/[slug] — a hub page for one beat the archive covers.
 *
 * These exist for the reader who arrives from a search engine wanting "everything Keryx has
 * answered about settlement", and for the crawler: a flat list of hundreds of answers is one
 * shallow page, while topic hubs give the corpus internal structure to follow. Slugs come from
 * the questions themselves (lib/answers-topics), so the set grows as the corpus does.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { searchTerm, type ArchiveEntry } from "@/lib/answers-archive";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { buildTopics, filterByTopic, type ArchiveTopic } from "@/lib/answers-topics";
import { paginateArchive } from "@/lib/answers-pagination";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ArchiveAnswerRow } from "@/components/keryx/archive-answer-row";
import { ArchiveSearch } from "@/components/keryx/archive-search";
import { ArchiveTopicChips } from "@/components/keryx/archive-topic-chips";
import { safeInlineJson } from "@/lib/safe-json";

// Same cadence as the archive it slices — new dispatches join a topic without a redeploy.
export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";

interface TopicData {
  topic: ArchiveTopic | null;
  entries: ArchiveEntry[];
  topics: ArchiveTopic[];
  toCreators: number;
}

async function loadTopic(slug: string): Promise<TopicData> {
  try {
    const archive = await getArchiveCached();
    const topics = buildTopics(archive);
    const entries = filterByTopic(archive, slug);
    // A slug outside the ranked facets can still be a legitimate topic someone linked to; it
    // just has no chip. Only an empty result is a 404.
    const topic =
      topics.find((t) => t.slug === slug) ??
      (entries.length > 0 ? { slug, label: slug, count: entries.length } : null);
    return { topic, entries, topics, toCreators: entries.reduce((s, e) => s + e.toCreators, 0) };
  } catch {
    return { topic: null, entries: [], topics: [], toCreators: 0 };
  }
}

/**
 * Prerender the ranked hubs at build: there are only a couple of dozen and they are the crawl
 * targets this feature exists for. Declaring it also marks the route cacheable — without it every
 * request re-renders and `revalidate` above does nothing. A slug outside this list still renders
 * on demand and is then cached like any other.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    return buildTopics(await getArchiveCached()).map((t) => ({ slug: t.slug }));
  } catch {
    // No database at build time — every hub is then rendered on demand.
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { topic, entries } = await loadTopic(slug);
  if (!topic) return { title: "Topic not found — Keryx", robots: { index: false } };

  const title = `${topic.label} — answers Keryx paid for`;
  const description = `${entries.length} question${
    entries.length !== 1 ? "s" : ""
  } about ${topic.label} answered by Keryx, each grounded in cited sources and settled with a real USDC micropayment to the writers it quoted.`;

  return {
    title,
    description,
    alternates: { canonical: `/answers/topic/${topic.slug}` },
    openGraph: {
      title,
      description,
      url: `${BASE}/answers/topic/${topic.slug}`,
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { topic, entries, topics, toCreators } = await loadTopic(slug);
  if (!topic || entries.length === 0) notFound();

  // A hub is an entry point to a beat, not a second copy of the archive: the biggest topic can
  // claim well over half the corpus, and rendering all of it put these pages near a megabyte. So
  // the page shows a beat's most recent answers, the filter still reaches the rest, and complete
  // coverage is the paginated archive's job — every dispatch is reachable from /answers either way.
  const { items: shown, rest } = paginateArchive(entries, 1);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${topic.label} — Keryx answers`,
      url: `${BASE}/answers/topic/${topic.slug}`,
      isPartOf: { "@type": "CollectionPage", name: "Keryx Answer Archive", url: `${BASE}/answers` },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: entries.length,
        // The answers this page actually links to — a list that advertises entries the page
        // doesn't carry is a promise the markup doesn't keep.
        itemListElement: shown.map((e, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${BASE}/dispatch/${e.id}`,
          name: e.question,
        })),
      },
    },
    breadcrumbJsonLd(BASE, [
      { name: "Keryx", path: "/" },
      { name: "The Archive", path: "/answers" },
      { name: topic.label },
    ]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeInlineJson(jsonLd) }}
      />

      <main className="mx-auto max-w-[860px] px-4 pb-20 pt-12 sm:px-[30px]">
        <Link
          href="/answers"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal underline-offset-4 hover:underline"
        >
          The archive
        </Link>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] font-medium leading-[1.05] tracking-tight text-ink">
          Answers about <em className="italic text-paid">{topic.label}</em>
        </h1>
        <p className="mt-4 max-w-[62ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          {entries.length} question{entries.length !== 1 ? "s" : ""} on this beat, each answered
          from sources the herald paid to read —{" "}
          <span className="text-paid">${toCreators.toFixed(4)}</span> to creators across this topic.
        </p>

        <ArchiveTopicChips topics={topics} activeSlug={topic.slug} />

        <ArchiveSearch
          terms={shown.map(searchTerm)}
          others={rest.map((e) => ({
            id: e.id,
            question: e.question,
            sources: e.sourceNames.join(" "),
          }))}
          placeholder={`Filter ${topic.label} answers…`}
        >
          {shown.map((e) => (
            <ArchiveAnswerRow key={e.id} entry={e} />
          ))}
        </ArchiveSearch>

        {rest.length > 0 && (
          <p className="mt-8 border-t border-line pt-5 font-serif text-[15px] leading-[1.55] text-ink-2">
            Showing the {shown.length} most recent of {entries.length} on this beat — the filter
            above still searches all of them, and{" "}
            <Link
              href="/answers"
              className="underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              the full archive
            </Link>{" "}
            is paginated end to end.
          </p>
        )}

        <div className="mt-12 border-t border-ink pt-6">
          <Link
            href="/"
            className="inline-block border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
          >
            Ask your own question ▸
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
