import { formatRecordedAmount, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
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

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import Link from "next/link";
import { getDb } from "@/lib/db";
import {publicWantedOffers} from "@/lib/run-privacy/public";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { FeedMatchForm } from "@/components/keryx/feed-match-form";
import { buildBoard, type DemandGap } from "@/lib/demand-signal";
import { WANTED_WINDOW_RUNS } from "@/lib/wanted-limits";
import type { GapIntentStatus } from "@/lib/types";
import { UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

// Visibility changes take effect on the next request, including intent metadata.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = uiCopy("wantedBoard.metadataTitle");
const DESCRIPTION =
  uiCopy("wantedBoard.description");

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: englishPublicAlternates("/wanted"),
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
      db.listRecentQueries(WANTED_WINDOW_RUNS),
      publicWantedOffers(db,200),
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
          <UiMessage messageKey={"wantedBoard.eyebrow"} />
        </div>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] font-medium leading-[1.05] tracking-tight text-ink">
          <UiRichMessage messageKey={"wantedBoard.title"} values={{ emphasis: <em className="italic text-paid"><UiMessage messageKey={"wantedBoard.titleEmphasis"} /></em> }} />
        </h1>
        <p className="mt-4 max-w-[62ch] font-serif text-[17px] leading-[1.55] text-ink-2">
          <UiText source={gaps.length > 0 ? uiCopy(selectPlural(gaps.length) === "one" ? "wantedBoard.introduction.one" : "wantedBoard.introduction.other", { count: gaps.length, window: WANTED_WINDOW_RUNS }) : uiCopy("wantedBoard.empty", { window: WANTED_WINDOW_RUNS })} />
        </p>

        {gaps.length > 0 && (
          <ol className="mt-10 flex flex-col gap-4">
            {gaps.map((gap) => (
              <li key={gap.claim} className="border border-line bg-paper p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    <UiText source={gap.seen > 1 ? uiCopy("wantedBoard.coverageAsked", { coverage: Math.round(gap.coverage * 100), count: gap.seen }) : uiCopy("wantedBoard.coverage", { coverage: Math.round(gap.coverage * 100) })} />
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-3">
                    {<DisplayTime value={gap.createdAt} dateOnly />}
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
                  <UiRichMessage messageKey={"wantedBoard.asked"} values={{ question: <Link href={`/dispatch/${gap.queryId}`} className="underline underline-offset-4 transition-colors hover:text-seal">“{gap.question}”</Link> }} />
                </p>
                {(offersByGap.get(gap.id)?.length ?? 0) > 0 && (
                  <ul className="mt-3 border-t border-line pt-3">
                    {offersByGap.get(gap.id)!.map((offer) => (
                      <li
                        key={offer.id}
                        className="font-mono text-[10.5px] leading-relaxed text-ink-3"
                      >
                        {offer.sourceItemLink ? uiRichCopy("wantedBoard.offerWithPost", { source: offer.sourceName, status: offerStatus(offer), post: <a href={offer.sourceItemLink} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-seal"><UiMessage messageKey={"wantedBoard.offeredPost"} /></a> }) : uiCopy("wantedBoard.offer", { source: offer.sourceName, status: offerStatus(offer) })}
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
              <UiRichMessage messageKey={"wantedBoard.filledTitle"} values={{ emphasis: <em className="italic text-paid"><UiMessage messageKey={"wantedBoard.filledEmphasis"} /></em> }} />
            </h2>
            <p className="mt-2 max-w-[62ch] font-serif text-[15px] leading-[1.55] text-ink-2">
              <UiMessage messageKey={"wantedBoard.filledIntroduction"} />
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
                        <UiMessage messageKey={fill.byRetry ? "wantedBoard.transitionRetry" : "wantedBoard.transition"} values={{ before: Math.round(gap.coverage * 100), after: Math.round(fill.coverage * 100) }} />
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-3">
                        {<DisplayTime value={fill.createdAt} dateOnly />}
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
                      {fill.paid.length > 0 ? uiRichCopy("wantedBoard.closedWithCitations", { sources: fill.paid.map(p => p.sourceName).join(", "), dispatch: <Link href={`/dispatch/${fill.queryId}`} className="underline underline-offset-4 transition-colors hover:text-seal"><UiMessage messageKey={"wantedBoard.closedDispatch"} /></Link> }) : <Link href={`/dispatch/${fill.queryId}`} className="underline underline-offset-4 transition-colors hover:text-seal"><UiMessage messageKey={"wantedBoard.closedDispatch"} /></Link>}
                    </p>
                    {fulfilledOffers.map((offer) => (
                      <p
                        key={offer.id}
                        className="mt-1 font-mono text-[10.5px] text-paid"
                      >
                        <UiMessage messageKey={"wantedBoard.fulfilled"} values={{ source: offer.sourceName, reward: formatRecordedAmount((offer.rewardUsdc ?? 0), { minimumFractionDigits: 6 }) }} />
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
            <UiMessage messageKey={"wantedBoard.listSource"} />
          </Link>
          <p className="mt-3 max-w-[62ch] font-mono text-[10.5px] leading-relaxed text-ink-3">
            <UiRichMessage messageKey={"wantedBoard.listingBoundary"} values={{ listed: <Link href="/sources" className="underline underline-offset-4 hover:text-seal"><UiMessage messageKey={"wantedBoard.alreadyListed"} /></Link> }} />
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
      return uiCopy("wantedBoard.pending");
    case "running":
      return uiCopy("wantedBoard.running", { attempt: offer.attempts });
    case "filled":
      return uiCopy("wantedBoard.settled", { reward: formatRecordedAmount((offer.rewardUsdc ?? 0), { minimumFractionDigits: 6 }) });
    case "unpaid":
      return uiCopy("wantedBoard.unpaid");
    case "missed":
      return uiCopy("wantedBoard.missed");
    case "stale":
      return uiCopy("wantedBoard.stale");
    case "failed":
      return uiCopy("wantedBoard.failed");
  }
}
