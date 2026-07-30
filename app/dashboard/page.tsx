"use client";

/**
 * Dashboard — traction screen. Polls /api/metrics and /api/payments every ~2s
 * and renders metric tiles, the creator leaderboard, and a live payments feed.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Clock3,
  Coins,
  Gauge,
  Info,
  Receipt,
  ShieldCheck,
  Target,
  ThumbsUp,
  TrendingUp,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { MetricCard } from "@/components/keryx/metric-card";
import {
  CreatorLeaderboard,
  type LeaderboardEntry,
} from "@/components/keryx/creator-leaderboard";
import { PaymentsFeed } from "@/components/keryx/payments-feed";
import { CreatorCashoutsPanel } from "@/components/keryx/creator-cashouts-panel";
import { EarningsChart } from "@/components/keryx/earnings-chart";
import { TopicsPanel, type Topic } from "@/components/keryx/topics-panel";
import { A2aCallCard } from "@/components/keryx/a2a-call-card";
import { DispatchHistory } from "@/components/keryx/dispatch-history";
import { fmtUsdc } from "@/components/keryx/phase-style";
import type { DailyVolume, DashboardMetrics, PaymentRecord, WithdrawalRecord } from "@/lib/types";

const POLL_MS = 10_000;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

interface MetricsResponse {
  metrics: DashboardMetrics;
  leaderboard: LeaderboardEntry[];
  topics?: Topic[];
  dailySettled?: DailyVolume[];
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [daily, setDaily] = useState<DailyVolume[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [runs, setRuns] = useState<{ id: string; question: string; createdAt: string; totalSpent: number; totalToCreators: number; citationCount: number }[]>([]);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const [mRes, pRes, wRes, rRes] = await Promise.all([
          fetch("/api/metrics", { cache: "no-store" }),
          fetch("/api/payments?limit=200", { cache: "no-store" }),
          fetch("/api/withdrawals?limit=25", { cache: "no-store" }),
          fetch("/api/runs", { cache: "no-store" }),
        ]);
        if (!alive) return;
        if (mRes.ok) {
          const data = (await mRes.json()) as MetricsResponse;
          setMetrics(data.metrics);
          setLeaderboard(data.leaderboard ?? []);
          setTopics(data.topics ?? []);
          setDaily(data.dailySettled ?? []);
        }
        if (pRes.ok) {
          const data = (await pRes.json()) as { payments: PaymentRecord[] };
          setPayments(data.payments ?? []);
        }
        if (wRes.ok) {
          const data = (await wRes.json()) as { withdrawals: WithdrawalRecord[] };
          setWithdrawals(data.withdrawals ?? []);
        }
        if (rRes.ok) {
          const data = await rRes.json();
          setRuns(Array.isArray(data) ? data : []);
        }
      } catch {
        /* keep last good state on transient error */
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
        <header className="mb-8 flex items-end justify-between gap-6 border-b-[1.5px] border-ink pb-6">
          <div>
            <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
              The ledger
            </div>
            <h1 className="letterpress mt-2.5 font-display text-[clamp(28px,3.6vw,40px)] font-medium tracking-tight text-ink">
              Independent usage
            </h1>
            <p className="mt-1.5 text-sm text-ink-2">
              People and third-party agents choosing Keryx; first-party activity remains visible
              below.
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-full border border-paid/40 bg-paid/[0.07] px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-paid sm:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paid" />
            Settling on Arc
          </span>
        </header>

        {metrics && <ProvenanceStrip metrics={metrics} />}
        <p className="mt-2 max-w-3xl font-mono text-[10px] leading-relaxed text-ink-3">
          Sub-cent rewards are netted off-chain in the Circle Gateway ledger and finalized on Arc in
          batches, so the per-payment IDs in the feed are Gateway settlement references, not per-tx
          EVM hashes (they do not open at <span className="text-ink-2">/tx/</span>). The verifiable
          on-chain anchor is the batched settlement wallet, linked from the live feed.
        </p>

        <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <MetricCard
            label="Independent queries"
            value={String(metrics?.externalQueries ?? 0)}
            sub={`${metrics?.externalPayingQueries ?? 0} paid · ${Math.round(
              (metrics?.externalReaderToPayerConversion ?? 0) * 100,
            )}% conversion`}
            icon={TrendingUp}
            accent="emerald"
            loading={!metrics}
          />
          <MetricCard
            label="Returning actors"
            value={String(metrics?.returningExternalActors ?? 0)}
            sub={`${metrics?.identifiedExternalActors ?? 0} identified · ${Math.round(
              (metrics?.returningExternalActorRate ?? 0) * 100,
            )}% returning`}
            icon={UserRoundCheck}
            accent="emerald"
            loading={!metrics}
          />
          <MetricCard
            label="Cost / independent query"
            value={`$${fmtUsdc(metrics?.externalAvgCostPerQueryUsdc)}`}
            sub={`$${fmtUsdc(metrics?.externalCreatorPayoutsUsdc)} to creators`}
            icon={Coins}
            accent="amber"
            loading={!metrics}
          />
          <MetricCard
            label={
              (metrics?.externalFeedbackTotal ?? 0) > 0
                ? "Independent satisfaction"
                : "High-confidence answers"
            }
            value={
              (metrics?.externalFeedbackTotal ?? 0) === 0 &&
              (metrics?.externalConfidenceSamples ?? 0) === 0
                ? "Collecting"
                : `${Math.round(
                    (((metrics?.externalFeedbackTotal ?? 0) > 0
                      ? metrics?.externalSatisfactionRate
                      : metrics?.externalHighConfidenceRate) ?? 0) * 100,
                  )}%`
            }
            sub={
              (metrics?.externalFeedbackTotal ?? 0) > 0
                ? `${metrics?.externalFeedbackTotal ?? 0} independent votes`
                : `${metrics?.externalConfidenceSamples ?? 0} completed samples`
            }
            icon={ThumbsUp}
            accent="emerald"
            loading={!metrics}
          />
          <MetricCard
            label="Evidence-grounded claims"
            value={
              (metrics?.evidenceClaimSamples ?? 0) > 0
                ? `${Math.round((metrics?.groundedClaimRate ?? 0) * 100)}%`
                : "Collecting"
            }
            sub={`${metrics?.evidenceClaimSamples ?? 0} claims · ${metrics?.citationPoolWithheldRuns ?? 0} pools withheld`}
            icon={ShieldCheck}
            accent="emerald"
            loading={!metrics}
          />
          <MetricCard
            label="Independent p95 latency"
            value={fmtDuration(metrics?.externalP95DurationMs ?? 0)}
            sub={`${metrics?.externalDurationSamples ?? 0} completed samples`}
            icon={Clock3}
            accent="neutral"
            loading={!metrics}
          />
          <MetricCard
            label="Wanted claims filled"
            value={
              (metrics?.gapIntentOffers ?? 0) > 0
                ? `${Math.round((metrics?.gapIntentFillRate ?? 0) * 100)}%`
                : "Collecting"
            }
            sub={`${metrics?.gapIntentFilled ?? 0} / ${metrics?.gapIntentOffers ?? 0} offers · ${metrics?.gapIntentPending ?? 0} queued`}
            icon={Target}
            accent="emerald"
            loading={!metrics}
          />
          <MetricCard
            label="Settlement success"
            value={
              (metrics?.externalSettlementAttempts ?? 0) > 0
                ? `${Math.round((metrics?.externalSettlementSuccessRate ?? 0) * 100)}%`
                : "Collecting"
            }
            sub={`${metrics?.externalSettledPayments ?? 0} / ${
              metrics?.externalSettlementAttempts ?? 0
            } independent creator payments`}
            icon={Gauge}
            accent="emerald"
            loading={!metrics}
          />
        </section>

        <div className="mb-4 mt-10 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Lifetime settled ledger
        </div>
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <MetricCard
            label="Total payments"
            value={String(metrics?.totalPayments ?? 0)}
            icon={Receipt}
            accent="neutral"
            loading={!metrics}
          />
          <MetricCard
            label="Total volume"
            value={`$${fmtUsdc(metrics?.totalVolumeUsdc)}`}
            sub="USDC"
            icon={ArrowLeftRight}
            accent="amber"
            loading={!metrics}
          />
          <MetricCard
            label="Creator payouts"
            value={`$${fmtUsdc(metrics?.totalCreatorPayoutsUsdc)}`}
            sub="USDC to creators"
            icon={Coins}
            accent="emerald"
            loading={!metrics}
          />
          <MetricCard
            label="Creators earning"
            value={String(metrics?.creatorsEarning ?? 0)}
            icon={Users}
            accent="amber"
            loading={!metrics}
          />
          <MetricCard
            label="Avg payment"
            value={`$${fmtUsdc(metrics?.avgPaymentUsdc)}`}
            sub="USDC"
            icon={Banknote}
            accent="neutral"
            loading={!metrics}
          />
          <MetricCard
            label="Reader → payer"
            value={`${Math.round((metrics?.readerToPayerConversion ?? 0) * 100)}%`}
            sub={`${metrics?.payingQueries ?? 0} / ${metrics?.totalQueries ?? 0} queries`}
            icon={TrendingUp}
            accent="emerald"
            loading={!metrics}
          />
          {(metrics?.feedbackTotal ?? 0) > 0 && (
            <MetricCard
              label="Satisfaction"
              value={`${Math.round((metrics?.satisfactionRate ?? 0) * 100)}%`}
              sub={`${metrics?.feedbackTotal ?? 0} votes`}
              icon={ThumbsUp}
              accent="emerald"
            />
          )}
        </section>

        {topics.length > 0 ? (
          <section className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <EarningsChart daily={daily} />
            <TopicsPanel topics={topics} />
          </section>
        ) : (
          <div className="mt-6">
            <EarningsChart daily={daily} />
          </div>
        )}

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <CreatorLeaderboard rows={leaderboard} />
          <PaymentsFeed payments={payments.slice(0, 25)} />
        </section>

        {withdrawals.length > 0 ? (
          <div className="mt-6">
            <CreatorCashoutsPanel withdrawals={withdrawals} />
          </div>
        ) : null}

        {runs.length > 0 && (
          <div className="mt-6">
            <DispatchHistory runs={runs.slice(0, 15)} />
          </div>
        )}

        <A2aCallCard />
      </main>
      <SiteFooter />
    </div>
  );
}

/** Present independent demand first while keeping first-party activity visible and inspectable. */
function ProvenanceStrip({ metrics }: { metrics: DashboardMetrics | null }) {
  const ext = metrics?.externalPayments ?? 0;
  const extVol = metrics?.externalVolumeUsdc ?? 0;
  const eng = metrics?.enginePayments ?? 0;
  const engVol = metrics?.engineVolumeUsdc ?? 0;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border border-line bg-paper-2/40 px-4 py-3 font-mono text-[11px] text-ink-2">
      <span className="group relative inline-flex items-center gap-1 uppercase tracking-[0.12em] text-ink-3">
        Usage mix
        <button
          type="button"
          aria-label="How Keryx classifies usage"
          aria-describedby="usage-mix-help"
          className="rounded-full text-ink-3 transition-colors hover:text-seal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal/40"
        >
          <Info size={13} aria-hidden="true" />
        </button>
        <span
          id="usage-mix-help"
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-72 border border-line bg-paper px-3 py-2 font-mono text-[10px] normal-case leading-relaxed tracking-normal text-ink-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          Independent usage comes from people and third-party agents through web, MCP, or A2A.
          First-party activity is initiated by Keryx itself. Settled totals include both.
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-paid" />
        Independent usage:{" "}
        <span className="font-semibold text-ink">{metrics?.externalQueries ?? 0}</span> queries ·{" "}
        <span className="font-semibold text-ink">{ext}</span> payments · ${fmtUsdc(extVol)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
        First-party agent activity:{" "}
        <span className="font-semibold text-ink">{metrics?.engineQueries ?? 0}</span> queries ·{" "}
        <span className="font-semibold text-ink">{eng}</span> payments · ${fmtUsdc(engVol)}
      </span>
      <a
        href="/api/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto font-semibold text-seal transition-colors hover:underline"
        title="Keryx is a paid x402 endpoint — point your agent at it"
      >
        Call Keryx from your agent ↗
      </a>
    </div>
  );
}
