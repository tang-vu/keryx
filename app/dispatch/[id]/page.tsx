import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { loadDispatchThread, resolveDispatch } from "@/lib/history/read-dispatch";
import { HistoricalDispatchNote } from "@/components/keryx/historical-dispatch-note";
import { cleanText, relatedAnswers } from "@/lib/answers-archive";
import { getArchiveCached } from "@/lib/answers-archive-cache";
import { RelatedDispatches } from "@/components/keryx/related-dispatches";
import { FollowUpForm } from "@/components/keryx/follow-up-form";
import { FreshnessNote } from "@/components/keryx/freshness-note";
import { loadFreshness } from "@/lib/answers-freshness";
import { compareAnswerReceipts } from "@/lib/answers-delta";
import { AnswerDeltaPanel } from "@/components/keryx/answer-delta";
import { PortableReceiptPanel } from "@/components/keryx/portable-receipt-panel";
import { PurchaseOutcomesPanel } from "@/components/keryx/purchase-outcomes";
import { projectPurchaseOutcomes } from "@/lib/research/purchase-outcomes-projector";
import { deriveConfidence } from "@/lib/agent/confidence";
import { projectBibliographicTask } from "@/lib/research/bibliographic-task-result";
import { breadcrumbJsonLd, crumbLabel } from "@/lib/seo-structured-data";
import { safeInlineJson } from "@/lib/safe-json";
import { DispatchView } from "./dispatch-view";
import { publicQueryRun } from "@/lib/research/public-query-run";
import { DeliverableAcceptance } from "@/components/keryx/deliverable-acceptance";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const CURRENT_NETWORK_LABEL = config.profile.testnet ? "Arc testnet" : "Arc mainnet";

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
    const dispatch = await resolveDispatch(id);
    if (!dispatch) return { title: "Dispatch not found — Keryx" };
    const { run, archive } = dispatch;
    const snippet = run.answer.slice(0, 160).replace(/\n/g, " ");
    const cited = run.citations.length;
    const conf = deriveConfidence(run);
    const confTag = projectBibliographicTask(run.bibliography) ? "Original bibliographic metadata · " : conf ? `${conf.level} confidence · ` : "";
    const networkTag = archive ? "Arc testnet historical · " : "";
    return {
      title: `${run.question} — Keryx Dispatch`,
      description: `${networkTag}${confTag}${cited} source${cited !== 1 ? "s" : ""} cited · $${run.totalSpent.toFixed(4)} spent · ${snippet}…`,
      alternates: { canonical: `/dispatch/${id}` },
      openGraph: {
        title: `${run.question} — Keryx Dispatch`,
        description: `${networkTag}${confTag}${cited} cited · $${run.totalSpent.toFixed(4)} spent · $${run.totalToCreators.toFixed(4)} to creators`,
      },
    };
  } catch {
    return { title: "Keryx Dispatch" };
  }
}

export default async function DispatchPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const dispatch = await resolveDispatch(id, db);
  if (!dispatch) notFound();
  const { run, reader, archive } = dispatch;
  // Original outbound rows include creator payments and separate operating fees.
  // Their ledger states, rather than allocations, establish settlement truth.
  const payments = await reader.listCreatorPaymentAttemptsByQuery(id);

  // The thread this dispatch sits in: what it followed from, and what followed from it — plus
  // whether the sources it cited have published since it settled (see lib/answers-freshness).
  // Freshness is only as current as this page's revalidate window, which is the right granularity:
  // an hour-old count of new posts still tells a reader the same thing.
  const [thread, freshness] = await Promise.all([
    loadDispatchThread(dispatch, db),
    archive ? Promise.resolve(null) : loadFreshness(db, run),
  ]);
  const { parent: parentDispatch, followUps } = thread;
  // Optional read-only enrichment from this exact retained public record. No
  // additional ledger/source/private-sidecar lookup or immutable receipt change.
  const purchaseOutcomes = (() => {
    try { return projectPurchaseOutcomes({ ...publicQueryRun(run), archive: archive ?? null }, config.networkId); }
    catch { return null; }
  })();
  const parent = parentDispatch?.run ?? null;
  const sameNetwork = parentDispatch !== null &&
    (parentDispatch.archive?.network ?? config.networkId) === (archive?.network ?? config.networkId);
  const comparison = await (async () => {
    if (!parentDispatch || !parent || !sameNetwork) return { delta: null, unavailable: false };
    try {
      const parentPayments = await parentDispatch.reader.listCreatorPaymentAttemptsByQuery(parentDispatch.run.id);
      return { delta: compareAnswerReceipts(parent, run, { previous: parentPayments, current: payments }), unavailable: false };
    } catch {
      return { delta: null, unavailable: true };
    }
  })();

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
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "QAPage",
      mainEntity: {
        "@type": "Question",
        name: run.question,
        answerCount: answerText ? 1 : 0,
        // The answer's own date, so a result can show when this was settled rather than guessing.
        dateCreated: run.createdAt,
        ...(answerText
          ? {
              acceptedAnswer: {
                "@type": "Answer",
                text: answerText,
                url: `${BASE}/dispatch/${id}`,
                dateCreated: run.createdAt,
                ...(run.citations.length
                  ? { citation: run.citations.map((c) => c.sourceName).filter(Boolean) }
                  : {}),
              },
            }
          : {}),
      },
    },
    // A dispatch id says nothing about where the page sits; the trail is what a result shows
    // instead of the raw URL, and it matches the links in this page's own header.
    breadcrumbJsonLd(BASE, [
      { name: "Keryx", path: "/" },
      { name: "The Archive", path: "/answers" },
      { name: crumbLabel(run.question) },
    ]),
  ];

  return (
    <div className="min-h-screen bg-paper-2">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeInlineJson(jsonLd) }}
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
        {archive ? <HistoricalDispatchNote archive={archive} /> : null}
        {thread.parentUnavailable ? <p role="status" className="mb-6 max-w-[860px] font-serif text-sm text-ink-3">The earlier dispatch could not be loaded. This answer and its payment evidence remain available.</p> : null}
        {parent ? (
          <Link
            href={`/dispatch/${parent.id}`}
            className="mb-6 flex max-w-[860px] items-baseline gap-2.5 border-l-2 border-line pl-4 transition-colors hover:border-ink"
          >
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
              Follows up on{parentDispatch?.archive ? " · Arc testnet" : ""}
            </span>
            <span className="font-serif text-[15px] leading-[1.5] text-ink-2">
              {parent.question}
            </span>
          </Link>
        ) : null}

        <DispatchView run={publicQueryRun(run)} payments={payments} historical={Boolean(archive)} historicalNetwork={archive?.network} />

        <PortableReceiptPanel dispatchId={id} />
        {!archive && <DeliverableAcceptance id={id} answer={run.answer} />}
        <PurchaseOutcomesPanel dispatchId={id} report={purchaseOutcomes} />

        {comparison.delta ? <AnswerDeltaPanel delta={comparison.delta} /> : null}
        {comparison.unavailable ? <p role="status" className="mt-6 max-w-[860px] font-serif text-sm text-ink-3">The earlier payment comparison could not be loaded. This answer and its own payment evidence remain available.</p> : null}

        {freshness ? <FreshnessNote freshness={freshness} dispatchId={id} question={run.question} /> : null}

        {followUps.length ? (
          <section className="mt-8 max-w-[860px]">
            <h2 className="mb-3.5 border-b border-line pb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
              Followed by
            </h2>
            <ul className="space-y-2.5">
              {followUps.map((f) => (
                <li key={f.run.id}>
                  <Link
                    href={`/dispatch/${f.run.id}`}
                    className="font-serif text-[15px] leading-[1.5] text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
                  >
                    {f.run.question}
                  </Link>
                  {archive ? <span className="ml-2 font-mono text-[10px] text-ink-3">{f.archive ? "Arc testnet · historical" : CURRENT_NETWORK_LABEL}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {thread.followUpsUnavailable ? <p role="status" className="mt-6 max-w-[860px] font-serif text-sm text-ink-3">Some follow-up links could not be loaded. This answer and its payment evidence remain available.</p> : null}

        {archive ? <p className="mt-8 font-serif text-sm text-ink-2">A new follow-up runs on {CURRENT_NETWORK_LABEL} with today’s sources and budget. Only the historical question supplies context.</p> : null}
        <FollowUpForm parentId={id} />
        <RelatedDispatches entries={related} />
      </main>
    </div>
  );
}
