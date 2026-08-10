import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, Clock3, ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";

import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";
import { getDb } from "@/lib/db";
import { listArticleMarket } from "@/lib/offers/offer-book";

export const dynamic = "force-dynamic";

const TITLE = "Article market — exact work, visible price";
const DESCRIPTION =
  "Browse exact article versions Keryx can buy through x402, including publisher-signed temporary offers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/market" },
};

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q?.trim() ?? "";
  const entries = await listArticleMarket(await getDb(), { query, limit: 60 });
  const signed = entries.filter((entry) => entry.offer).length;

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[1080px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          Open article market
        </div>
        <div className="grid gap-6 border-b border-line pb-8 md:grid-cols-[1fr_320px] md:items-end">
          <div>
            <h1 className="max-w-3xl font-display text-[clamp(34px,6vw,66px)] font-semibold leading-[0.96] tracking-[-0.04em] text-ink">
              Exact work. Visible price. No mystery bundle.
            </h1>
            <p className="mt-5 max-w-2xl font-serif text-[16px] leading-relaxed text-ink-2">
              Every row names the article version the agent can inspect, its registry ceiling, and
              any temporary discount the publisher signed. Payment still settles to the registry payee.
            </p>
          </div>
          <form action="/market" className="border border-line bg-paper p-3">
            <label htmlFor="market-query" className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              Search free metadata
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="market-query"
                name="q"
                defaultValue={query}
                placeholder="stablecoins, agents, x402…"
                className="min-w-0 flex-1 border border-line bg-paper-2 px-3 py-2 font-serif text-sm outline-none focus:border-seal"
              />
              <button className="border border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-cream">
                Find
              </button>
            </div>
          </form>
        </div>

        <div className="my-5 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          <span>{entries.length} payable article versions</span>
          <span>·</span>
          <span className="text-paid">{signed} signed offers</span>
          {query && <span>· matching “{query}”</span>}
        </div>

        {entries.length === 0 ? (
          <div className="border border-line bg-paper p-10 text-center font-serif text-ink-2">
            No payable article metadata matched this search.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {entries.map((entry) => (
              <article key={`${entry.sourceId}:${entry.itemId}`} className="flex flex-col border border-line bg-paper p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <Link href={`/creator/${entry.sourceId}`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-seal hover:underline">
                    {entry.sourceName}
                  </Link>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {entry.contentReceipt?.manifestId && entry.contentReceipt.deliveryKind === "full_text" && (
                      <span className="inline-flex items-center gap-1 border border-seal/30 bg-seal/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-seal">
                        <FileCheck2 className="h-3 w-3" /> signed full text
                      </span>
                    )}
                    {entry.offer ? (
                      <span className="inline-flex items-center gap-1 border border-paid/30 bg-paid/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-paid">
                        <ShieldCheck className="h-3 w-3" /> signed −{entry.savingsPercent}%
                      </span>
                    ) : (
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">registry price</span>
                    )}
                  </div>
                </div>
                <h2 className="font-display text-xl font-semibold leading-tight text-ink">
                  <a href={entry.itemUrl} target="_blank" rel="noreferrer" className="hover:text-seal">
                    {entry.itemTitle}
                  </a>
                </h2>
                {entry.summary && (
                  <p className="mt-3 line-clamp-3 font-serif text-[13px] leading-relaxed text-ink-2">{entry.summary}</p>
                )}
                <div className="mt-auto pt-5">
                  <div className="flex items-end justify-between gap-3 border-t border-line pt-3">
                    <div>
                      <p className="font-display text-2xl font-semibold text-ink">${fmtUsdc(entry.priceUsdc)}</p>
                      {entry.offer && (
                        <p className="font-mono text-[9px] text-ink-3 line-through">list ${fmtUsdc(entry.listPriceUsdc)}</p>
                      )}
                    </div>
                    <a
                      href={entry.paidPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 border border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink hover:bg-ink hover:text-cream"
                    >
                      Inspect x402 <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[9px] text-ink-3">
                    <BadgeDollarSign className="h-3 w-3" /> {entry.contentVersion.slice(0, 22)}…
                    {entry.offer && (
                      <>
                        <span>·</span>
                        <Clock3 className="h-3 w-3" /> until {new Date(entry.offer.expiresAt * 1_000).toLocaleDateString("en-US", { timeZone: "UTC" })}
                        <span>· signer {shortAddr(entry.offer.signer)}</span>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
