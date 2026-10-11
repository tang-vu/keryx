import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { cache } from "react";
import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedMatchForm } from "@/components/keryx/feed-match-form";
import { ExistingArticleResponseForm } from "@/components/keryx/existing-article-response-form";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { WantedShareButton } from "@/components/keryx/wanted-share-button";
import { currentArcLabel } from "@/lib/arc-network-display";
import {
  findWantedBrief,
  loadWantedBoard,
  wantedOfferStatus,
  WANTED_DETAIL_LIMIT,
  type PublicWantedOffer,
} from "@/lib/wanted-board";
import { createFormatters } from "@/lib/i18n/format";

const uiFormat = createFormatters("en");

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

const BASE = process.env.BASE_URL || "https://keryx.cc";

export const revalidate = 600;

export function generateStaticParams(): { id: string }[] {
  return [];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

const getBoard = cache(() => loadWantedBoard(WANTED_DETAIL_LIMIT));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const brief = findWantedBrief(await getBoard(), id);
    if (!brief) return { title: uiCopy("wantedClaim.notFound") };
    const { gap, state } = brief;
    const stateLabel = state === "open" ? uiCopy("wantedClaim.openLabel") : uiCopy("wantedClaim.filledLabel");
    const description =
      state === "open"
        ? uiCopy(gap.seen === 1 ? "wantedClaim.openDescription.one" : "wantedClaim.openDescription.other", { count: gap.seen, coverage: Math.round(gap.coverage * 100) })
        : uiCopy("wantedClaim.filledDescription", { before: Math.round(gap.coverage * 100), after: Math.round(gap.filledBy?.coverage ?? 0) });
    return {
      title: uiCopy("wantedClaim.metadataTitle", { claim: gap.claim }),
      description,
      alternates: englishPublicAlternates(`/wanted/${gap.id}`),
      openGraph: {
        title: uiCopy("wantedClaim.socialTitle", { stateLabel }),
        description,
        url: `${BASE}/wanted/${gap.id}`,
        type: "article",
      },
      twitter: { card: "summary_large_image", title: uiCopy("wantedClaim.socialTitle", { stateLabel }), description },
    };
  } catch {
    return { title: uiCopy("wantedClaim.fallbackTitle") };
  }
}

export default async function WantedClaimPage({ params }: PageProps) {
  const { id } = await params;
  const board = await getBoard();
  const brief = findWantedBrief(board, id);
  if (!brief) notFound();

  const { gap, state } = brief;
  const offers = board.offers.filter((offer) => offer.gapId === gap.id);
  const url = `${BASE}/wanted/${gap.id}`;
  const fill = gap.filledBy;

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />

      <main className="mx-auto max-w-[860px] px-4 pb-20 pt-10 sm:px-[30px]">
        <Link
          href="/wanted"
          className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3 underline decoration-line underline-offset-4 transition-colors hover:text-ink"
        >
          {uiCopy("wantedClaim.back")}
        </Link>

        <article className="mt-7 border-2 border-ink bg-paper p-[5px]">
          <div className="border border-ink">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink bg-ink px-5 py-3 text-paper">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
                {uiCopy("wantedClaim.state", { state })}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper/65">
                {uiCopy("wantedClaim.receipt")}
              </span>
            </header>

            <div className="p-5 sm:p-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
                {uiCopy("wantedClaim.paidClaim")}
              </div>
              <h1 className="mt-3 font-display text-[clamp(28px,5vw,44px)] font-medium leading-[1.08] tracking-tight text-ink">
                {gap.claim}
              </h1>

              <div className="mt-7 grid border-y border-line sm:grid-cols-3">
                <BriefStat
                  label={uiCopy("wantedClaim.coverage")}
                  value={`${Math.round(gap.coverage * 100)}%`}
                  detail={state === "open" ? uiCopy("wantedClaim.short") : uiCopy("wantedClaim.beforeFilled")}
                  accent={state === "open"}
                />
                <BriefStat
                  label={uiCopy("wantedClaim.demand")}
                  value={`${gap.seen}×`}
                  detail={uiCopy("wantedClaim.retriesExcluded")}
                />
                <BriefStat
                  label={uiCopy("wantedClaim.lastMeasured")}
                  value={uiFormat.instant(gap.createdAt, "monthDay")}
                  detail={uiCopy("wantedClaim.publicReceipt")}
                />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <WantedShareButton url={url} claim={gap.claim} />
                <Link
                  href={`/dispatch/${gap.queryId}`}
                  className="inline-flex items-center border border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
                >
                  {uiCopy("wantedClaim.inspectFailed")}
                </Link>
              </div>
            </div>
          </div>
        </article>

        {state === "open" ? (
          <>
            <section className="mt-9 border-l-2 border-seal pl-5">
              <h2 className="font-display text-[23px] font-medium text-ink">
                {uiCopy("wantedClaim.invitationTitle")}
              </h2>
              <p className="mt-2 max-w-[66ch] font-serif text-[15.5px] leading-[1.6] text-ink-2">
                {uiCopy("wantedClaim.invitation", { network: currentArcLabel })}
              </p>
            </section>

            <OffersList offers={offers} />

            <ExistingArticleResponseForm gapId={gap.id} />

            <FeedMatchForm gapId={gap.id} claim={gap.claim} />
          </>
        ) : (
          <section className="mt-10 border border-paid/50 bg-paid/[0.06] p-6">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.17em] text-paid">
              {uiCopy("wantedClaim.covered")}
            </div>
            <h2 className="mt-2 font-display text-[28px] font-medium text-ink">
              {uiCopy("wantedClaim.transition", { before: Math.round(gap.coverage * 100), after: Math.round(fill?.coverage ?? 0) })}
            </h2>
            <p className="mt-3 max-w-[66ch] font-serif text-[15.5px] leading-[1.6] text-ink-2">
              {uiCopy("wantedClaim.settlementBoundary")}
            </p>
            {fill && (
              <div className="mt-5">
                <Link
                  href={`/dispatch/${fill.queryId}`}
                  className="font-mono text-[11px] uppercase tracking-[0.13em] text-ink underline underline-offset-4 hover:text-seal"
                >
                  {uiCopy("wantedClaim.inspectClosing")}
                </Link>
                {fill.paid.length > 0 && (
                  <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
                    {uiCopy("wantedClaim.cited", { sources: fill.paid.map((source) => source.sourceName).join(", ") })}
                  </p>
                )}
              </div>
            )}
            <OffersList offers={offers} />
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function OffersList({ offers }: { offers: PublicWantedOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section className="mt-9">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.17em] text-ink-3">
        {uiCopy("wantedClaim.offers")}
      </h2>
      <ul className="mt-3 divide-y divide-line border border-line bg-paper">
        {offers.map((offer) => (
          <li key={offer.id} className="px-4 py-3">
            <p className="font-serif text-[15px] text-ink">{offer.sourceName}</p>
            <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">
              {offerDescription(offer)}
            </p>
            {offer.retryRunId ? (
              <Link
                href={`/dispatch/${offer.retryRunId}`}
                className="mt-1 inline-block font-mono text-[10px] text-seal underline underline-offset-4"
              >
                {uiCopy("wantedClaim.inspectRetry")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BriefStat({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="px-1 py-4 sm:border-r sm:border-line sm:px-4 sm:last:border-r-0">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.15em] text-ink-3">
        {label}
      </div>
      <div className={`mt-1 font-display text-[30px] font-semibold ${accent ? "text-seal" : "text-ink"}`}>
        {value}
      </div>
      <div className="mt-1 font-mono text-[9.5px] leading-snug text-ink-3">{detail}</div>
    </div>
  );
}

function offerDescription(offer: PublicWantedOffer) {
  const status = wantedOfferStatus(offer);
  const post = offer.sourceItemLink ? <a href={offer.sourceItemLink} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-seal">{uiCopy("wantedClaim.offeredPost")}</a> : null;
  const version = offer.contentVersion?.slice(0, 18);
  if (post && version) return uiRichCopy(offer.articleOfferId ? "wantedClaim.offerPostVersionPrice" : "wantedClaim.offerPostVersion", { status, post, version });
  if (post) return uiRichCopy(offer.articleOfferId ? "wantedClaim.offerPostPrice" : "wantedClaim.offerPost", { status, post });
  if (version) return uiRichCopy(offer.articleOfferId ? "wantedClaim.offerVersionPrice" : "wantedClaim.offerVersion", { status, version });
  return uiRichCopy(offer.articleOfferId ? "wantedClaim.offerPrice" : "wantedClaim.offer", { status });
}
