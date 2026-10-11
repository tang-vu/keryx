import { createMessages } from "@/lib/i18n/messages";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { safeInlineJson } from "@/lib/safe-json";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { CreatorDetailView } from "./creator-detail-view";
import { SourceLearningPanel } from "@/components/keryx/source-learning-panel";
import { readSourceLearning } from "@/lib/research/source-learning-server";
import { config } from "@/lib/config";

const uiCopy = createMessages("en");

const BASE = process.env.BASE_URL || "https://keryx.cc";

interface PageProps {
  params: Promise<{ id: string }>;
}

// Always per-request. A creator opens this page straight after registering, and a cached miss
// would hold the 404 for the whole revalidate window — the one page where staleness reads as
// "my source doesn't exist" or "my earnings stopped". Its traffic is a handful of owners, not
// crawlers, so there is nothing to save here.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (!source) return { title: uiCopy("creatorPage.missing"), robots: { index: false } };
    const title = uiCopy("creatorPage.title", { name: source.name });
    const description = uiCopy("creatorPage.description", { name: source.name });
    return {
      title,
      description,
      // The registry links here, so this is a page search engines will reach — give it one address
      // of its own rather than letting it inherit the site canonical.
      alternates: englishPublicAlternates(`/creator/${id}`),
      openGraph: { title, description, url: `${BASE}/creator/${id}`, type: "profile" },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch {
    return { title: uiCopy("creatorPage.fallbackTitle") };
  }
}

export default async function CreatorPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) notFound();
  const learning = await readSourceLearning(db, id, config.networkId).catch(() => null);

  // A creator page is a profile: who they are, what they publish, and the trail back to the
  // registry that lists them.
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      inLanguage: "en",
      url: `${BASE}/creator/${id}`,
      mainEntity: {
        "@type": "Organization",
        name: source.name,
        ...(source.url ? { url: source.url } : {}),
        description: uiCopy("creatorPage.profileDescription", { name: source.name }),
      },
    },
    breadcrumbJsonLd(BASE, [
      { name: "Keryx", path: "/" },
      { name: uiCopy("creatorPage.sources"), path: "/sources" },
      { name: source.name },
    ]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeInlineJson(jsonLd) }}
      />
      <header className="border-b border-ink bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3 sm:px-[30px]">
          <Link
            href="/"
            className="font-display text-[15px] font-semibold tracking-tight text-ink"
          >
            KERYX
          </Link>
          <Link
            href="/dashboard"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
          >
            {uiCopy("creatorPage.back")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
        <CreatorDetailView creatorId={id} />
        <SourceLearningPanel report={learning} sourceId={id} />
      </main>
    </div>
  );
}
