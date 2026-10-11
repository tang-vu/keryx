"use client";
import { selectPlural } from "@/lib/i18n/format";

import { DisplayTime } from "@/components/keryx/display-time";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { OwnerFeedVerification } from "@/components/keryx/owner-feed-verification";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Banknote, Calendar, CircleX, Clock3, Hash, Wallet } from "lucide-react";
import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";
import { cn } from "@/lib/utils";
import { ListingControlsPanel } from "./listing-controls-panel";
import { ArticleOffersPanel } from "./article-offers-panel";
import { ArticleContentPanel } from "./article-content-panel";
import { ScholarlyRightsPanel } from "./scholarly-rights-panel";
import { NotifyWebhookPanel } from "./notify-webhook-panel";
import { NotifyEmailPanel } from "./notify-email-panel";
import { PreviewDepthPanel } from "./preview-depth-panel";
import { EmbedBadgePanel } from "./embed-badge-panel";
import { EmbedWidgetPanel } from "./embed-widget-panel";
import { DecisionFeedbackPanel } from "./decision-feedback-panel";
import { GatewayProofPanel, type GatewayProof } from "./gateway-proof-panel";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

interface CreatorData {
  scholarlyRights?: { status: string; declarationId?: string; approvalId?: string; license?: string; summary?: string; contentVersion?: string; effectiveAt?: string; embargoUntil?: string; expiresAt?: string } | null;
  source: {
    id: string;
    name: string;
    description: string;
    walletAddress: string;
    evidenceProvenance?: "synthetic-demo";
    fetchPrice: number;
    verified: boolean;
  };
  /** Circle's own figure for this creator's wallets, from the hourly parity sweep. */
  gatewayProof: GatewayProof | null;
  stats: {
    totalEarned: number;
    settledTotal: number;
    paymentCount: number;
    citationCount: number;
    rank: number;
  };
  recentPayments: {
    id: string;
    queryId: string;
    kind: string;
    amountUsdc: number;
    settled: boolean;
    settlementStatus?: "settled" | "simulated" | "pending" | "failed";
    txHash: string | null;
    createdAt: string;
    /** The question that triggered this payout — what work of theirs was used. */
    question: string | null;
  }[];
  dailyEarnings: { date: string; amount: number }[];
}

export function CreatorDetailView({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<CreatorData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/creator/${creatorId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(uiCopy("creatorDetail.loadFailed"))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [creatorId]);

  if (error) {
    return <p className="py-20 text-center font-mono text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return <CreatorSkeleton />;
  }

  const { source, stats, recentPayments, dailyEarnings, gatewayProof } = data;
  const maxDaily = Math.max(...dailyEarnings.map((d) => d.amount), 0.001);

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-seal bg-seal/10 font-display text-xl font-bold text-seal">
          #{stats.rank || "–"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[clamp(22px,3vw,30px)] font-medium tracking-tight text-ink">
              {source.name}
            </h1>
          </div>
          <p className="mt-1 max-w-xl font-serif text-[14px] text-ink-2">
            {source.description || uiCopy("creatorDetail.fallbackDescription")}
          </p>
          <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-ink-3">
            <span className="flex items-center gap-1">
              <Wallet className="h-3 w-3" />
              {shortAddr(source.walletAddress)}
            </span>
            <span className="flex items-center gap-1">
              <Banknote className="h-3 w-3" />
              {uiCopy("creatorDetail.readPrice", { price: fmtUsdc(source.fetchPrice) })}
            </span>
          </div>
        </div>
      </div>

      {source.evidenceProvenance === "synthetic-demo" && <p className="mb-6 border border-seal/40 bg-seal/5 p-3 text-sm">{uiCopy("creatorDetail.synthetic")}</p>}

      {/* Stat tiles */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={Banknote}
          label={uiCopy("creatorDetail.totalEarned")}
          value={`$${fmtUsdc(stats.totalEarned)}`}
          sub={uiCopy("creatorDetail.settled", { amount: fmtUsdc(stats.settledTotal) })}
          accent="paid"
        />
        <StatTile
          icon={Hash}
          label={uiCopy("creatorDetail.citations")}
          value={String(stats.citationCount)}
          sub={uiCopy(selectPlural(stats.paymentCount) === "one" ? "creatorDetail.payments.one" : "creatorDetail.payments.other", { count: stats.paymentCount })}
        />
        <StatTile
          icon={Calendar}
          label={uiCopy("creatorDetail.activeDays")}
          value={String(dailyEarnings.length)}
          sub={uiCopy("creatorDetail.last14Days")}
        />
        <StatTile
          icon={BadgeCheck}
          label={uiCopy("creatorDetail.rank")}
          value={`#${stats.rank || "–"}`}
          sub={uiCopy("creatorDetail.leaderboard")}
          accent="seal"
        />
      </section>

      {/* Public: the earnings above, checked against Circle's own books. Sits directly under the
          tiles it corroborates — the proof is worth little a scroll away from the claim. */}
      <GatewayProofPanel proof={gatewayProof} />
      {data.scholarlyRights && <section className="mb-6 rounded border border-line p-4 text-sm [overflow-wrap:anywhere]" aria-label={uiCopy("creatorDetail.rightsAria")}>
        <p>{uiRichCopy("creatorDetail.declaredRights", { status: <strong>{data.scholarlyRights.status}</strong> })}</p>
        {data.scholarlyRights.summary && <p className="mt-2">{data.scholarlyRights.summary}</p>}
        {data.scholarlyRights.license && <p className="mt-2">{uiCopy("creatorDetail.license", { license: data.scholarlyRights.license })}</p>}
        {data.scholarlyRights.contentVersion && <p className="mt-2 break-all font-mono text-xs">{uiCopy("creatorDetail.version", { version: data.scholarlyRights.contentVersion })}</p>}
        {data.scholarlyRights.expiresAt && <p className="mt-2 text-xs">{uiRichCopy("creatorDetail.permission", { effectiveAt: data.scholarlyRights.effectiveAt ?? "", expiresAt: data.scholarlyRights.expiresAt, embargoUntil: data.scholarlyRights.embargoUntil ?? "" })}</p>}
        <p className="mt-2 text-xs text-ink-3">{uiCopy("creatorDetail.rightsBoundary")}</p>
      </section>}

      {/* Public: why the agent buys or passes on this source, in its own words. Sits above the
          price dial because it is the input to using that dial. */}
      <DecisionFeedbackPanel creatorId={creatorId} />

      <OwnerFeedVerification sourceId={creatorId} onVerified={() => setData(previous => previous ? { ...previous, source: { ...previous.source, verified: true } } : previous)} />

      {/* Owner-only: price-per-read dial + permanent delist (renders nothing for non-owners) */}
      <ListingControlsPanel creatorId={creatorId} />

      {/* Owner-only: publisher-signed full text, encrypted before durable storage */}
      <ScholarlyRightsPanel creatorId={creatorId} />
      <ArticleContentPanel creatorId={creatorId} />

      {/* Owner-only: signed, version-bound article discounts */}
      <ArticleOffersPanel creatorId={creatorId} />

      {/* Owner-only: citation email alerts (renders nothing for non-owners) */}
      <NotifyEmailPanel creatorId={creatorId} />

      {/* Owner-only: citation webhook settings (renders nothing for non-owners) */}
      <NotifyWebhookPanel creatorId={creatorId} />

      {/* Owner-only: free-preview depth control (renders nothing for non-owners) */}
      <PreviewDepthPanel creatorId={creatorId} />

      {/* Public: embeddable "Cited by Keryx" badge (Markdown + HTML snippets) */}
      <EmbedBadgePanel creatorId={creatorId} />

      {/* Public: one-line "Ask Keryx" widget for the creator's own site */}
      <EmbedWidgetPanel creatorId={creatorId} />

      {/* Earnings chart */}
      {dailyEarnings.length > 0 && (
        <section className="mb-8 border border-line bg-paper p-5">
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            {uiCopy("creatorDetail.earnings")}
          </h2>
          <div className="flex items-end gap-1" style={{ height: 100 }}>
            {dailyEarnings.map((d) => (
              <div
                key={d.date}
                className="flex-1 rounded-t-sm bg-seal transition-all hover:bg-seal/80"
                style={{ height: `${Math.max(2, (d.amount / maxDaily) * 100)}%` }}
                title={`${d.date}: $${fmtUsdc(d.amount)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-3">
            <span>{dailyEarnings[0]?.date}</span>
            <span>{dailyEarnings[dailyEarnings.length - 1]?.date}</span>
          </div>
        </section>
      )}

      {/* Recent payments */}
      <section className="border border-line bg-paper p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            {uiCopy(selectPlural(recentPayments.length) === "one" ? "creatorDetail.recentPayments.one" : "creatorDetail.recentPayments.other", { count: recentPayments.length })}
          </h2>
          {/* The panel shows a slice; the export is the whole ledger — what a creator needs
              to reconcile a withdrawal or file the income. */}
          <a
            href={`/api/creator/${creatorId}/export?format=csv`}
            download
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 underline underline-offset-4 transition-colors hover:text-seal"
          >
            {uiCopy("creatorDetail.export")}
          </a>
        </div>
        {recentPayments.length === 0 ? (
          <p className="py-6 text-center font-serif text-sm text-ink-3">
            {uiCopy("creatorDetail.empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {recentPayments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/dispatch/${p.queryId}`}
                    className="block truncate font-serif text-[13px] leading-snug text-ink transition-colors hover:text-seal"
                    title={p.question ?? p.queryId}
                  >
                    {p.question ?? uiCopy("creatorDetail.dispatch", { id: p.queryId.slice(0, 8) })}
                  </Link>
                  <p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink-3">
                    <span
                      className={cn(
                        "rounded px-1 py-px uppercase tracking-wide",
                        p.kind === "citation" ? "bg-paid/10 text-paid" : "bg-paper-2 text-ink-3",
                      )}
                    >
                      {p.kind === "citation" ? uiCopy("creatorDetail.cited") : uiCopy("creatorDetail.read")}
                    </span>
                    {<DisplayTime value={p.createdAt} />}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      p.settlementStatus === "failed" ? "text-red-700" : "text-paid",
                    )}
                  >
                    ${fmtUsdc(p.amountUsdc)}
                  </span>
                  {p.settled && p.txHash && (
                    <p className="font-mono text-[10px] text-ink-3">
                      tx {p.txHash.slice(0, 10)}…
                    </p>
                  )}
                  {p.settlementStatus === "pending" && (
                    <p className="inline-flex items-center gap-1 font-mono text-[10px] text-amber-700">
                      <Clock3 className="h-2.5 w-2.5" /> {uiCopy("creatorDetail.pendingProof")}
                    </p>
                  )}
                  {p.settlementStatus === "failed" && (
                    <p className="inline-flex items-center gap-1 font-mono text-[10px] text-red-700">
                      <CircleX className="h-2.5 w-2.5" /> {uiCopy("creatorDetail.failed")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="border border-line bg-paper p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-ink-3" />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "font-display text-xl font-semibold tabular-nums",
          accent === "paid" ? "text-paid" : accent === "seal" ? "text-seal" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-ink-3">{sub}</p>}
    </div>
  );
}

/** Shimmer placeholder shown while the creator profile loads — mirrors the real
 *  layout (identity, four stat tiles, a chart block) so the page doesn't jump. */
function CreatorSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 flex items-start gap-4">
        <div className="h-14 w-14 shrink-0 rounded-full bg-ink/10" />
        <div className="flex-1 space-y-2">
          <div className="h-7 w-56 rounded bg-ink/10" />
          <div className="h-4 w-full max-w-md rounded bg-ink/10" />
          <div className="h-3 w-40 rounded bg-ink/10" />
        </div>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded border border-line bg-paper" />
        ))}
      </div>
      <div className="h-[180px] rounded border border-line bg-paper" />
    </div>
  );
}
