/**
 * /answers — the public answer archive. Every question Keryx has actually
 * answered and paid its sources for, deduped to one canonical dispatch each,
 * rendered server-side so search + AI crawlers index a growing corpus that
 * links back into each /dispatch/[id] permalink. This is the organic on-ramp:
 * people find a Keryx answer in search, then ask their own.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { buildArchive, type ArchiveEntry } from "@/lib/answers-archive";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";

// Recompute a few times an hour — the corpus grows as new dispatches settle.
export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "The Archive — every answer Keryx has paid for";
const DESCRIPTION =
  "Browse every question Keryx has answered. Each answer is grounded in cited sources and settled with a real USDC micropayment to the writers it quoted — no platform cut, no payout minimum.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/answers" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/answers`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

async function loadArchive(): Promise<ArchiveEntry[]> {
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(600);
    return buildArchive(runs);
  } catch {
    return [];
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AnswerRow({ entry }: { entry: ArchiveEntry }) {
  return (
    <article>
      <Link
        href={`/dispatch/${entry.id}`}
        className="group block border border-ink bg-paper p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] sm:p-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-seal">
            Dispatch
          </span>
          <time className="font-mono text-[10px] text-ink-3" dateTime={entry.createdAt}>
            {fmtDate(entry.createdAt)}
          </time>
        </div>
        <h2 className="mt-2 font-display text-[19px] font-medium leading-snug text-ink transition-colors group-hover:text-seal">
          {entry.question}
        </h2>
        {entry.answerSnippet && (
          <p className="mt-2 font-serif text-[15px] leading-[1.5] text-ink-2">
            {entry.answerSnippet}
          </p>
        )}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          <span>
            {entry.citationCount} source{entry.citationCount !== 1 ? "s" : ""} cited
          </span>
          <span className="text-paid">${entry.toCreators.toFixed(4)} to creators</span>
          {entry.sourceNames.length > 0 && (
            <span className="normal-case tracking-normal text-ink-3">
              {entry.sourceNames.slice(0, 4).join(" · ")}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}

export default async function AnswersPage() {
  const entries = await loadArchive();
  const totalToCreators = entries.reduce((s, e) => s + e.toCreators, 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Keryx Answer Archive",
    description: DESCRIPTION,
    url: `${BASE}/answers`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: entries.length,
      itemListElement: entries.slice(0, 100).map((e, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${BASE}/dispatch/${e.id}`,
        name: e.question,
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
          The archive
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
          Every answer, <em className="italic text-paid">paid for.</em>
        </h1>
        <p className="mt-4 max-w-[62ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          {entries.length > 0 ? (
            <>
              {entries.length} question{entries.length !== 1 ? "s" : ""} the herald has answered —
              each grounded in cited sources and settled with a real micropayment to the writers it
              quoted. <span className="text-paid">${totalToCreators.toFixed(4)}</span> paid to
              creators across this archive.
            </>
          ) : (
            <>The archive is warming up — no settled dispatches to show yet.</>
          )}
        </p>

        {entries.length > 0 && (
          <div className="mt-10 flex flex-col gap-4">
            {entries.map((e) => (
              <AnswerRow key={e.id} entry={e} />
            ))}
          </div>
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
