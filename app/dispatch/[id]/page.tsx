import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { cleanText, relatedAnswers } from "@/lib/answers-archive";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { RelatedDispatches } from "@/components/keryx/related-dispatches";
import { FollowUpForm } from "@/components/keryx/follow-up-form";
import { FreshnessNote } from "@/components/keryx/freshness-note";
import { loadFreshness } from "@/lib/answers-freshness";
import { ConfidenceBadge } from "@/components/keryx/confidence-badge";
import { deriveConfidence } from "@/lib/agent/confidence";
import { DispatchView } from "./dispatch-view";

const BASE = process.env.BASE_URL || "https://keryx.cc";

// A settled dispatch is a finished record — its answer, citations and payouts never change. Only
// the things layered on top (follow-ups, related answers) move, and hourly is soon enough for
// those. Explicit because the root layout no longer forces every page to render per-request:
// without this, the permalink would be generated once and served from then on, never noticing a
// follow-up. Refreshed in the background, so a crawler hitting hundreds of these costs one render
// each per window rather than one per hit.
export const revalidate = 3600;

/**
 * Empty on purpose: no permalink is worth prerendering at build (there are hundreds, and the
 * newest ones are minted minutes later anyway). Declaring it at all is what marks the route as
 * cacheable — without it Next renders every dynamic-param request from scratch, and `revalidate`
 * above would be silently ignored. Unknown ids are still served on demand (dynamicParams default).
 */
export function generateStaticParams(): { id: string }[] {
  return [];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const db = await getDb();
    const run = await db.getQueryRun(id);
    if (!run) return { title: "Dispatch not found — Keryx" };
    const snippet = run.answer.slice(0, 160).replace(/\n/g, " ");
    const cited = run.citations.length;
    const conf = deriveConfidence(run);
    const confTag = conf ? `${conf.level} confidence · ` : "";
    return {
      title: `${run.question} — Keryx Dispatch`,
      description: `${confTag}${cited} source${cited !== 1 ? "s" : ""} cited · $${run.totalSpent.toFixed(4)} spent · ${snippet}…`,
      alternates: { canonical: `/dispatch/${id}` },
      openGraph: {
        title: `${run.question} — Keryx Dispatch`,
        description: `${confTag}${cited} cited · $${run.totalSpent.toFixed(4)} spent · $${run.totalToCreators.toFixed(4)} to creators`,
      },
    };
  } catch {
    return { title: "Keryx Dispatch" };
  }
}

export default async function DispatchPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const run = await db.getQueryRun(id);
  if (!run) notFound();
  // Load the real citation payouts so the permalink reflects on-chain settlement
  // truth (settled / batched) instead of reconstructing a "simulated" view.
  const payments = await db.listPaymentsByQuery(id);

  // The thread this dispatch sits in: what it followed from, and what followed from it — plus
  // whether the sources it cited have published since it settled (see lib/answers-freshness).
  // Freshness is only as current as this page's revalidate window, which is the right granularity:
  // an hour-old count of new posts still tells a reader the same thing.
  const [parent, followUps, freshness] = await Promise.all([
    run.parentId ? db.getQueryRun(run.parentId) : Promise.resolve(null),
    db.listFollowUps(id),
    loadFreshness(db, run),
  ]);

  // Internal link mesh: point this permalink at its archive neighbours.
  const related = relatedAnswers(
    {
      id,
      question: run.question,
      sourceNames: run.citations.map((c) => c.sourceName).filter(Boolean),
    },
    await getArchiveCached(),
  );

  // QAPage structured data — lets search + AI crawlers read this permalink as a
  // question with an accepted answer, and surface the sources it credited.
  const answerText = cleanText(run.answer);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: run.question,
      answerCount: answerText ? 1 : 0,
      ...(answerText
        ? {
            acceptedAnswer: {
              "@type": "Answer",
              text: answerText,
              url: `${BASE}/dispatch/${id}`,
              ...(run.citations.length
                ? { citation: run.citations.map((c) => c.sourceName).filter(Boolean) }
                : {}),
            },
          }
        : {}),
    },
  };

  return (
    <div className="min-h-screen bg-paper-2">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Minimal header */}
      <header className="border-b border-ink bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3 sm:px-[30px]">
          <Link
            href="/"
            className="font-display text-[15px] font-semibold tracking-tight text-ink"
          >
            KERYX
          </Link>
          <div className="flex items-center gap-5">
            <Link
              href="/answers"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
            >
              The archive
            </Link>
            <Link
              href="/"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
            >
              ← New dispatch
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
        {parent ? (
          <Link
            href={`/dispatch/${parent.id}`}
            className="mb-6 flex max-w-[860px] items-baseline gap-2.5 border-l-2 border-line pl-4 transition-colors hover:border-ink"
          >
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
              Follows up on
            </span>
            <span className="font-serif text-[15px] leading-[1.5] text-ink-2">
              {parent.question}
            </span>
          </Link>
        ) : null}

        <DispatchView run={run} payments={payments} />

        <FreshnessNote freshness={freshness} dispatchId={id} question={run.question} />

        {followUps.length ? (
          <section className="mt-8 max-w-[860px]">
            <h2 className="mb-3.5 border-b border-line pb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
              Followed by
            </h2>
            <ul className="space-y-2.5">
              {followUps.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/dispatch/${f.id}`}
                    className="font-serif text-[15px] leading-[1.5] text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                  >
                    {f.question}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <FollowUpForm parentId={id} />
        <RelatedDispatches entries={related} />
      </main>
    </div>
  );
}
