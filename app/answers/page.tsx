/**
 * /answers — the public answer archive. Every question Keryx has actually
 * answered and paid its sources for, deduped to one canonical dispatch each,
 * rendered server-side so search + AI crawlers index a growing corpus that
 * links back into each /dispatch/[id] permalink. This is the organic on-ramp:
 * people find a Keryx answer in search, then ask their own.
 *
 * This route is page 1. Older pages live at /answers/page/[n] and render the same document —
 * see lib/answers-pagination for why the index is sliced at all.
 */

import type { Metadata } from "next";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { buildTopics } from "@/lib/answers-topics";
import { paginateArchive } from "@/lib/answers-pagination";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ArchiveIndexView } from "@/components/keryx/archive-index-view";
import { archiveIndexJsonLd } from "./archive-index-json-ld";

// Recompute a few times an hour — the corpus grows as new dispatches settle.
export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "The Archive — every answer Keryx has paid for";
const DESCRIPTION =
  "Browse every question Keryx has answered. Each answer is grounded in cited sources and settled with a real USDC micropayment to the writers it quoted — no platform cut, no payout minimum.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/answers",
    types: {
      "application/atom+xml": [{ url: "/answers/feed.xml", title: "Keryx Answer Archive" }],
    },
  },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/answers`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function AnswersPage() {
  const entries = await getArchiveCached();
  const totalToCreators = entries.reduce((s, e) => s + e.toCreators, 0);
  const topics = buildTopics(entries);
  const slice = paginateArchive(entries, 1);

  const jsonLd = [
    archiveIndexJsonLd({
      base: BASE,
      url: `${BASE}/answers`,
      name: "Keryx Answer Archive",
      description: DESCRIPTION,
      slice,
      totalEntries: entries.length,
    }),
    breadcrumbJsonLd(BASE, [{ name: "Keryx", path: "/" }, { name: "The Archive" }]),
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
        topics={topics}
        totalEntries={entries.length}
        totalToCreators={totalToCreators}
      />
      <SiteFooter />
    </div>
  );
}
