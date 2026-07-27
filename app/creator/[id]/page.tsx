import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { breadcrumbJsonLd } from "@/lib/seo-structured-data";
import { safeInlineJson } from "@/lib/safe-json";
import { CreatorDetailView } from "./creator-detail-view";

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
    if (!source) return { title: "Creator not found — Keryx", robots: { index: false } };
    const title = `${source.name} — Keryx Creator`;
    const description = `${source.name} earns USDC every time an AI agent cites their work on Keryx.`;
    return {
      title,
      description,
      // The registry links here, so this is a page search engines will reach — give it one address
      // of its own rather than letting it inherit the site canonical.
      alternates: { canonical: `/creator/${id}` },
      openGraph: { title, description, url: `${BASE}/creator/${id}`, type: "profile" },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch {
    return { title: "Keryx Creator" };
  }
}

export default async function CreatorPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) notFound();

  // A creator page is a profile: who they are, what they publish, and the trail back to the
  // registry that lists them.
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      url: `${BASE}/creator/${id}`,
      mainEntity: {
        "@type": "Organization",
        name: source.name,
        ...(source.url ? { url: source.url } : {}),
        description: `${source.name} is listed with Keryx and is paid in USDC each time an AI agent cites its work.`,
      },
    },
    breadcrumbJsonLd(BASE, [
      { name: "Keryx", path: "/" },
      { name: "The Registry", path: "/sources" },
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
            ← Back to ledger
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
        <CreatorDetailView creatorId={id} />
      </main>
    </div>
  );
}
