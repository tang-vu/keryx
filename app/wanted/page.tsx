/**
 * /wanted — the demand board: questions readers paid for that the corpus could not answer.
 *
 * The registry says what Keryx has. This says what it is missing, and unlike every "write about
 * this" content brief on the internet, each line is backed by money that was actually spent: a
 * dispatch bought everything worth buying, scored its own coverage, and still finished this claim
 * short. For a creator deciding whether listing a feed is worth the trouble, that is the difference
 * between a guess and a market signal — so the page is server-rendered and crawlable, and every row
 * links to the trace that proves it.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { FeedMatchForm } from "@/components/keryx/feed-match-form";
import { buildBoard, type DemandGap } from "@/lib/demand-signal";
import type { GapIntentStatus } from "@/lib/types";

// The window moves with the daemon; a few times an hour is fresh enough for a board people act on
// over days, and keeps the trace parsing off the request path.
export const revalidate = 600;

const BASE = process.env.BASE_URL || "https://keryx.cc";
const WINDOW_RUNS = 400;
const TITLE = "Wanted — questions Keryx was paid to answer and couldn't";
const DESCRIPTION =
  "Real sub-claims from paid dispatches that Keryx's corpus left uncovered. Demand with a receipt: list a source that covers one and every citation pays your wallet in USDC.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/wanted" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/wanted`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

interface PublicOffer {
  id: string;
  gapId: string;
  sourceId: string;
  sourceName: string;
  sourceItemLink: string;
  status: GapIntentStatus;
  attempts: number;
  retryRunId?: string;
  coverage?: number;
  rewardUsdc?: number;
}

async function loadBoard(): Promise<{
  open: DemandGap[];
  filled: DemandGap[];
  offers: PublicOffer[];
}> {
  try {
    const db = await getDb();
    const [runs, intents, sources] = await Promise.all([
      db.listRecentQueries(WINDOW_RUNS),
      db.listGapIntents(200),
      db.listAllSources(),
    ]);
    const names = new Map(sources.map((source) => [source.id, source.name]));
    return {
      ...buildBoard(runs),
      offers: intents
        .filter((intent) => names.has(intent.sourceId))
        .map((intent) => ({
          id: intent.id,
          gapId: intent.gapId,
          sourceId: intent.sourceId,
          sourceName: names.get(intent.sourceId) ?? intent.sourceId,
          sourceItemLink: intent.sourceItemLink,
          status: intent.status,
          attempts: intent.attempts,
          retryRunId: intent.retryRunId,
          coverage: intent.coverage,
          rewardUsdc: intent.rewardUsdc,
        })),
    };
  } catch {
    return { open: [], filled: [], offers: [] };
  }
}

export default async function WantedPage() {
  const { open: gaps, filled, offers } = await loadBoard();
  const offersByGap = new Map<string, PublicOffer[]>();
  for (const offer of offers) {
    offersByGap.set(offer.gapId, [...(offersByGap.get(offer.gapId) ?? []), offer]);
  }

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />

      <main className="mx-auto max-w-[860px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          Wanted
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
          What the corpus <em className="italic text-paid">couldn&apos;t answer.</em>
        </h1>
        <p className="mt-4 max-w-[62ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          {gaps.length > 0 ? (
            <>
              Every dispatch breaks its question into claims, buys what looks worth buying, then
              scores how well it actually covered each one. These {gaps.length} claims finished
              short across the last {WINDOW_RUNS} dispatches — readers paid, and Keryx came back
              thin. Publish on one and the next agent that asks has somewhere to spend.
            </>
          ) : (
            <>
              Nothing on the board: across the last {WINDOW_RUNS} dispatches, the corpus covered
              every claim it was asked to support. Come back after the next quiet week.
            </>
          )}
        </p>

        {gaps.length > 0 && (
          <ol className="mt-10 flex flex-col gap-4">
            {gaps.map((gap) => (
              <li key={gap.claim} className="border border-line bg-paper p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    {Math.round(gap.coverage * 100)}% covered
                    {gap.seen > 1 && <> · asked {gap.seen}×</>}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-3">
                    {new Date(gap.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <p className="mt-2 font-serif text-[16px] leading-snug text-ink">
                  <Link
                    href={`/wanted/${gap.id}`}
                    className="underline decoration-line underline-offset-4 transition-colors hover:text-seal hover:decoration-seal"
                  >
                    {gap.claim}
                  </Link>
                </p>

                {/* The coverage bar is the whole argument: the emptiness IS the opportunity. */}
                <div className="mt-3 h-1.5 w-full bg-paper-2" aria-hidden>
                  <div
                    className="h-full bg-seal"
                    style={{ width: `${Math.max(2, Math.round(gap.coverage * 100))}%` }}
                  />
                </div>

                <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
                  asked as{" "}
                  <Link
                    href={`/dispatch/${gap.queryId}`}
                    className="underline underline-offset-4 transition-colors hover:text-seal"
                  >
                    “{gap.question}”
                  </Link>
                </p>
                {(offersByGap.get(gap.id)?.length ?? 0) > 0 && (
                  <ul className="mt-3 border-t border-line pt-3">
                    {offersByGap.get(gap.id)!.map((offer) => (
                      <li
                        key={offer.id}
                        className="font-mono text-[10.5px] leading-relaxed text-ink-3"
                      >
                        {offer.sourceName} · {offerStatus(offer)}
                        {offer.sourceItemLink && (
                          <>
                            {" · "}
                            <a
                              href={offer.sourceItemLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-4 hover:text-seal"
                            >
                              offered post
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}

        {/* Reading the list above and guessing which line is yours is the work this page used to
            leave to the reader. With an empty board there is nothing to check against, so the tool
            only appears when there is. */}
        {gaps.length > 0 && <FeedMatchForm />}

        {/* The payoff, and the reason the list above is worth acting on: holes that closed. Keryx
            re-asks a failed question once content arrives that might answer it, so a creator who
            lists against an open claim does not have to wait for a reader to happen by. */}
        {filled.length > 0 && (
          <section className="mt-14">
            <h2 className="font-display text-[22px] font-medium tracking-tight text-ink">
              Filled — and <em className="italic text-paid">covered now.</em>
            </h2>
            <p className="mt-2 max-w-[62ch] font-serif text-[15px] leading-[1.55] text-ink-2">
              Claims the corpus was missing and now covers. When something new lands that might
              answer an open claim, Keryx puts the question again — a real dispatch that buys the
              new material. A targeted creator offer is only marked fulfilled when its citation
              reward also settles.
            </p>

            <ol className="mt-6 flex flex-col gap-3">
              {filled.map((gap) => {
                const fill = gap.filledBy!;
                const fulfilledOffers = (offersByGap.get(gap.id) ?? []).filter(
                  (offer) => offer.status === "filled",
                );
                return (
                  <li key={gap.claim} className="border border-line bg-paper p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paid">
                        {Math.round(gap.coverage * 100)}% → {Math.round(fill.coverage * 100)}% covered
                        {fill.byRetry && <> · re-asked by Keryx</>}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-3">
                        {new Date(fill.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="mt-2 font-serif text-[15px] leading-snug text-ink">
                      <Link
                        href={`/wanted/${gap.id}`}
                        className="underline decoration-line underline-offset-4 transition-colors hover:text-seal hover:decoration-seal"
                      >
                        {gap.claim}
                      </Link>
                    </p>

                    <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-ink-3">
                      {fill.paid.length > 0 ? (
                        <>
                          cited {fill.paid.map((p) => p.sourceName).join(", ")} ·{" "}
                        </>
                      ) : null}
                      <Link
                        href={`/dispatch/${fill.queryId}`}
                        className="underline underline-offset-4 transition-colors hover:text-seal"
                      >
                        closed by this dispatch
                      </Link>
                    </p>
                    {fulfilledOffers.map((offer) => (
                      <p
                        key={offer.id}
                        className="mt-1 font-mono text-[10.5px] text-paid"
                      >
                        offer fulfilled · {offer.sourceName} received $
                        {(offer.rewardUsdc ?? 0).toFixed(6)} settled USDC
                      </p>
                    ))}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <div className="mt-12 border-t border-ink pt-6">
          <Link
            href="/register"
            className="inline-block border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
          >
            List a source that covers one ▸
          </Link>
          <p className="mt-3 max-w-[62ch] font-mono text-[10.5px] leading-relaxed text-ink-3">
            Listing is permissionless — paste an RSS feed, prove you own it, and every citation pays
            your wallet directly. See{" "}
            <Link href="/sources" className="underline underline-offset-4 hover:text-seal">
              what is already listed
            </Link>
            .
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function offerStatus(offer: PublicOffer): string {
  switch (offer.status) {
    case "pending":
      return "queued until the source is indexed + verified";
    case "running":
      return `targeted retry running · attempt ${offer.attempts}/3`;
    case "filled":
      return `fulfilled · $${(offer.rewardUsdc ?? 0).toFixed(6)} settled`;
    case "unpaid":
      return "evidence passed, settlement did not complete";
    case "missed":
      return "retry completed, evidence still fell short";
    case "stale":
      return "closed without retry because the claim was already filled";
    case "failed":
      return "retry stopped after bounded failures";
  }
}
