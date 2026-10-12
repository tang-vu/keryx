"use client";

/**
 * The wallet's dispatch ledger: a summary strip (recorded browser-wallet vs other creator funding, kept apart on
 * purpose) over a list of every attributed dispatch, each showing the creators its toll reached.
 * Read-only — the dispatch permalink stays the place to re-read an answer and its trace.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { fmtUsdc } from "@/components/keryx/phase-style";
import { DisplayTime } from "@/components/keryx/display-time";
import { OwnedHistoryPane } from "./owned-history-view";
import { CurrentHistoryPane } from "./current-history-view";
import { ClaimantHistoryPane } from "./claimant-history-view";
import { personalHistoryCopy as copy } from "@/locales/en/personal-history";
import { ownedHistoryCopy } from "@/locales/en/owned-history";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { selectPlural } from "@/lib/i18n/format";

const message = createMessages("en");
const richMessage = createRichMessages("en");

interface AskCreator {
  sourceId: string;
  name: string;
  rewardUsdc: number;
}

interface AskRow {
  id: string;
  question: string;
  createdAt: string;
  spentUsdc: number;
  toCreatorsUsdc: number;
  citationCount: number;
  creators: AskCreator[];
  confidence: "High" | "Moderate" | "Low" | null;
  /** Recorded browser-wallet creator funding; never the price of the original research service. */
  funded: boolean;
  isFollowUp: boolean;
  /** A cited source has published since this dispatch settled — a re-ask would read new material. */
  hasNewMaterial: boolean;
}

interface Totals {
  dispatches: number;
  spentUsdc: number;
  toCreatorsUsdc: number;
  citations: number;
  /** Legacy names for rows without recorded browser-wallet funding, including prepaid A2A. */
  trialDispatches: number;
  trialToCreatorsUsdc: number;
}

function timeAgo(iso: string) {
  return <DisplayTime value={iso} relative />;
}

export function MyAsksView() {
  const [historical, setHistorical] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [claimantHistory, setClaimantHistory] = useState(false);
  const [owned, setOwned] = useState(true);
  return <div>
    <nav className="mb-6 flex flex-wrap gap-3" aria-label={message("myHistory.networkLabel")}>
      <button type="button" aria-pressed={!historical} onClick={() => setHistorical(false)} className="min-h-11 border border-line px-4 text-sm">{message("myHistory.currentNetwork")}</button>
      <button type="button" aria-pressed={historical} onClick={() => setHistorical(true)} className="min-h-11 border border-line px-4 text-sm">{message("myHistory.testnetHistory")}</button>
    </nav>
    {historical && <p className="mb-5 text-sm leading-relaxed text-ink-2">{message("myHistory.testnetScope")}</p>}
    {!historical && <button type="button" className="mb-5 min-h-11 border border-line px-4 text-sm" aria-pressed={owned}
      onClick={() => { setOwned(value => !value); setBrowse(false); setClaimantHistory(false); }}>{ownedHistoryCopy.title}</button>}
    {!historical && !claimantHistory && <button type="button" className="mb-5 min-h-11 border border-line px-4 text-sm" onClick={() => { setOwned(false); setBrowse(value => !value); }}>{browse ? copy.recent : copy.browse}</button>}
    {!historical && <button type="button" className="mb-5 min-h-11 border border-line px-4 text-sm" aria-pressed={claimantHistory} onClick={() => { setOwned(false); setClaimantHistory(value => !value); }}>{claimantHistory ? message("claimantHistory.close") : message("claimantHistory.open")}</button>}
    {historical ? <MyAsksLedger key="testnet" historical /> : claimantHistory ? <ClaimantHistoryPane /> : browse ? <CurrentHistoryPane /> : owned ? <OwnedHistoryPane /> : <MyAsksLedger key="current" historical={false} />}
  </div>;
}

export function MyAsksLedger({ historical }: { historical: boolean }) {
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [asks, setAsks] = useState<AskRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(historical ? "/api/me/asks?network=arcTestnet&limit=200" : "/api/me/asks?view=recent", { cache: "no-store", signal: controller.signal });
        if (res.status === 401) {
          setSignedOut(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as {
          asks: AskRow[];
          totals: Totals;
          truncated: boolean;
        };
        setAsks(d.asks);
        setTotals(d.totals);
        setTruncated(d.truncated);
      } catch {
        if (!controller.signal.aborted) { setFailed(true); toast.error(message("myHistory.loadFailed")); }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [historical, revision]);

  if (loading) return <p className="font-mono text-xs text-ink-3">{message("myHistory.loading")}</p>;
  if (failed) return <p role="status" className="text-sm">{richMessage("myHistory.unavailable", { action: <button type="button" onClick={() => { setLoading(true); setFailed(false); setRevision(value => value + 1); }} className="min-h-11 px-2 text-seal underline">{message("myHistory.retry")}</button> })}</p>;

  if (signedOut)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          {message("myHistory.signInInstruction")}
        </p>
        <Link href="/connect" className="font-mono text-xs text-seal underline underline-offset-2">
          {message("myHistory.connect")}
        </Link>
      </div>
    );

  if (asks.length === 0)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          {historical ? message("myHistory.emptyTestnet") : message("myHistory.emptyCurrent")}{message("myHistory.attributionInstruction")}
        </p>
        <Link href="/" className="font-mono text-xs text-seal underline underline-offset-2">
          {message("myHistory.ask")}
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {/* Summary strip */}
      {totals && (
        <section className="border border-line bg-paper p-5">
          <h2 className="mb-4 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            <Receipt className="h-3.5 w-3.5 text-seal" /> {historical ? message("myHistory.testnetTolls") : message("myHistory.tolls")}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="font-serif text-xl text-ink">{totals.dispatches}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {message(selectPlural(totals.dispatches) === "one" ? "myHistory.dispatchLabel.one" : "myHistory.dispatchLabel.other")}
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-ink">${fmtUsdc(totals.spentUsdc)}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                {message("myHistory.walletCreatorSpend")}
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-seal">${fmtUsdc(totals.toCreatorsUsdc)}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                {message("myHistory.toCreators")}
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-ink">{totals.citations}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {message(selectPlural(totals.citations) === "one" ? "myHistory.citationsLabel.one" : "myHistory.citationsLabel.other")}
              </p>
            </div>
          </div>
          {totals.trialDispatches > 0 && (
            <p className="mt-4 border-t border-line pt-3 font-mono text-[10px] text-ink-3">
        {richMessage(selectPlural(totals.trialDispatches) === "one" ? "myHistory.otherFunding.one" : "myHistory.otherFunding.other", { count: totals.trialDispatches, fundingGap: " ", amount: fmtUsdc(totals.trialToCreatorsUsdc), separateGap: " " })}
            </p>
          )}
        </section>
      )}

      {/* Dispatch rows */}
      <section className="divide-y divide-line border border-line bg-paper">
        {asks.map((a) => (
          <div key={a.id} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link
                href={`/dispatch/${a.id}`}
                className="min-w-0 flex-1 font-serif text-[15px] text-ink underline-offset-2 hover:underline"
              >
                {a.question}
              </Link>
              <span className="font-mono text-[11px] text-ink-2">
                ${fmtUsdc(a.spentUsdc)}
                {!a.funded && <span className="text-ink-3">{message("myHistory.browserFundingNotRecorded")}</span>}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-ink-3">
              <span>{timeAgo(a.createdAt)}</span>
              <span>{richMessage(selectPlural(a.citationCount ?? 0) === "one" ? "myHistory.cited.one" : "myHistory.cited.other", { count: a.citationCount ?? null })}</span>
              {a.confidence && <span>{richMessage("myHistory.confidence", { level: a.confidence.toLowerCase() })}</span>}
              {a.isFollowUp && <span>{message("myHistory.followUp")}</span>}
              {a.hasNewMaterial && (
                <Link
                  href={`/?q=${encodeURIComponent(a.question)}&parent=${a.id}&run=1`}
                  title={message("myHistory.newMaterialTitle")}
                  className="border border-seal px-1.5 py-0.5 uppercase tracking-[0.1em] text-seal transition-colors hover:bg-seal hover:text-cream"
                >
                  {message("myHistory.reask")}
                </Link>
              )}
            </div>
            {a.creators.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                {a.creators.map((c) => historical ? (
                  <span key={c.sourceId} className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2">{richMessage("myHistory.testnetCreatorRecord", { creator: c.name ?? null, amount: fmtUsdc(c.rewardUsdc) })}</span>
                ) : (
                  <Link
                    key={c.sourceId}
                    href={`/creator/${c.sourceId}`}
                    title={message("myHistory.citationPaymentTitle", { amount: fmtUsdc(c.rewardUsdc) })}
                    className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-seal hover:text-seal"
                  >
                    {c.name} · ${fmtUsdc(c.rewardUsdc)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      {truncated && (
        <p className="font-mono text-[10px] text-ink-3">
          {richMessage(selectPlural(asks.length) === "one" ? "myHistory.recentLimit.one" : "myHistory.recentLimit.other", { count: asks.length })}
        </p>
      )}
    </div>
  );
}
