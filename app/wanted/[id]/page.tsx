import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedMatchForm } from "@/components/keryx/feed-match-form";
import { ExistingArticleResponseForm } from "@/components/keryx/existing-article-response-form";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { WantedShareButton } from "@/components/keryx/wanted-share-button";
import {
  findWantedBrief,
  loadWantedBoard,
  wantedOfferStatus,
  WANTED_DETAIL_LIMIT,
  type PublicWantedOffer,
} from "@/lib/wanted-board";

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
    if (!brief) return { title: "Wanted claim not found — Keryx" };
    const { gap, state } = brief;
    const stateLabel = state === "open" ? "Open creator brief" : "Filled creator brief";
    const description =
      state === "open"
        ? `${gap.seen} paid dispatch${gap.seen === 1 ? "" : "es"} left this claim ${Math.round(gap.coverage * 100)}% covered. Check whether your RSS feed can close it.`
        : `This claim moved from ${Math.round(gap.coverage * 100)}% to ${Math.round(gap.filledBy?.coverage ?? 0)}% coverage. Inspect the dispatch and creator payout receipt.`;
    return {
      title: `${gap.claim} — Keryx Wanted`,
      description,
      alternates: { canonical: `/wanted/${gap.id}` },
      openGraph: {
        title: `${stateLabel} — Keryx`,
        description,
        url: `${BASE}/wanted/${gap.id}`,
        type: "article",
      },
      twitter: { card: "summary_large_image", title: `${stateLabel} — Keryx`, description },
    };
  } catch {
    return { title: "Wanted claim — Keryx" };
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
          ← All wanted claims
        </Link>

        <article className="mt-7 border-2 border-ink bg-paper p-[5px]">
          <div className="border border-ink">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink bg-ink px-5 py-3 text-paper">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
                Wanted claim · {state}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper/65">
                Demand with a receipt
              </span>
            </header>

            <div className="p-5 sm:p-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
                A claim Keryx was paid to support
              </div>
              <h1 className="mt-3 font-display text-[clamp(28px,5vw,44px)] font-medium leading-[1.08] tracking-tight text-ink">
                {gap.claim}
              </h1>

              <div className="mt-7 grid border-y border-line sm:grid-cols-3">
                <BriefStat
                  label="Coverage"
                  value={`${Math.round(gap.coverage * 100)}%`}
                  detail={state === "open" ? "finished short" : "before it was filled"}
                  accent={state === "open"}
                />
                <BriefStat
                  label="Reader demand"
                  value={`${gap.seen}×`}
                  detail="paid dispatches; agent retries excluded"
                />
                <BriefStat
                  label="Last measured"
                  value={new Date(gap.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  detail="from a public dispatch receipt"
                />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <WantedShareButton url={url} claim={gap.claim} />
                <Link
                  href={`/dispatch/${gap.queryId}`}
                  className="inline-flex items-center border border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
                >
                  Inspect the failed dispatch ↗
                </Link>
              </div>
            </div>
          </div>
        </article>

        {state === "open" ? (
          <>
            <section className="mt-9 border-l-2 border-seal pl-5">
              <h2 className="font-display text-[23px] font-medium text-ink">
                This is an invitation, not a guaranteed bounty.
              </h2>
              <p className="mt-2 max-w-[66ch] font-serif text-[15.5px] leading-[1.6] text-ink-2">
                Offer a post only after Keryx judges its public RSS preview relevant. Once the
                source is registered, indexed, and ownership-verified, Keryx sponsors one bounded
                retry with at most $0.05 on Arc testnet. A payout happens only when the paid full
                text supplies qualifying evidence, the agent cites it, and Circle settlement
                succeeds.
              </p>
            </section>

            <OffersList offers={offers} />

            <ExistingArticleResponseForm gapId={gap.id} />

            <FeedMatchForm gapId={gap.id} claim={gap.claim} />
          </>
        ) : (
          <section className="mt-10 border border-paid/50 bg-paid/[0.06] p-6">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.17em] text-paid">
              Covered now
            </div>
            <h2 className="mt-2 font-display text-[28px] font-medium text-ink">
              {Math.round(gap.coverage * 100)}% → {Math.round(fill?.coverage ?? 0)}% coverage
            </h2>
            <p className="mt-3 max-w-[66ch] font-serif text-[15.5px] leading-[1.6] text-ink-2">
              A later dispatch found qualifying evidence for this claim. The creator offer is only
              called fulfilled when its citation reward also carries a real settlement receipt.
            </p>
            {fill && (
              <div className="mt-5">
                <Link
                  href={`/dispatch/${fill.queryId}`}
                  className="font-mono text-[11px] uppercase tracking-[0.13em] text-ink underline underline-offset-4 hover:text-seal"
                >
                  Inspect the closing dispatch ↗
                </Link>
                {fill.paid.length > 0 && (
                  <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
                    Cited and paid: {fill.paid.map((source) => source.sourceName).join(", ")}
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
        Offers against this claim
      </h2>
      <ul className="mt-3 divide-y divide-line border border-line bg-paper">
        {offers.map((offer) => (
          <li key={offer.id} className="px-4 py-3">
            <p className="font-serif text-[15px] text-ink">{offer.sourceName}</p>
            <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">
              {wantedOfferStatus(offer)}
              {offer.sourceItemLink ? (
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
              ) : null}
              {offer.contentVersion ? (
                <> · exact {offer.contentVersion.slice(0, 18)}…</>
              ) : null}
              {offer.articleOfferId ? <> · signed price</> : null}
            </p>
            {offer.retryRunId ? (
              <Link
                href={`/dispatch/${offer.retryRunId}`}
                className="mt-1 inline-block font-mono text-[10px] text-seal underline underline-offset-4"
              >
                inspect autonomous retry ↗
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
