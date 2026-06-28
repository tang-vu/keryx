"use client";

/**
 * Dashboard — traction screen. Polls /api/metrics and /api/payments every ~2s
 * and renders metric tiles, the creator leaderboard, and a live payments feed.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Coins,
  Receipt,
  ThumbsUp,
  TrendingUp,
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

const POLL_MS = 2000;

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
              Traction
            </h1>
            <p className="mt-1.5 text-sm text-ink-2">
              Real value flowing to creators — every payment Keryx has settled.
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

/**
 * Honest provenance of the volume: how much is genuine EXTERNAL usage (humans asking on the site +
 * external agents calling the paid A2A endpoint) vs Keryx's own autonomous volume engine. Both are
 * real settled USDC on Arc; the split is shown so traction is never overstated.
 */
function ProvenanceStrip({ metrics }: { metrics: DashboardMetrics | null }) {
  const ext = metrics?.externalPayments ?? 0;
  const extVol = metrics?.externalVolumeUsdc ?? 0;
  const eng = metrics?.enginePayments ?? 0;
  const engVol = metrics?.engineVolumeUsdc ?? 0;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border border-line bg-paper-2/40 px-4 py-3 font-mono text-[11px] text-ink-2">
      <span className="uppercase tracking-[0.12em] text-ink-3">Volume provenance</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-paid" />
        External (web + A2A): <span className="font-semibold text-ink">{ext}</span> payments · $
        {fmtUsdc(extVol)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
        Autonomous engine: <span className="font-semibold text-ink">{eng}</span> payments · $
        {fmtUsdc(engVol)}
      </span>
      <span className="text-ink-3">Both real, settled on Arc.</span>
      <a
        href="/api/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto font-semibold text-seal transition-colors hover:underline"
        title="Keryx is a paid x402 endpoint — point your agent at it"
      >
        Your agent can call this ↗
      </a>
    </div>
  );
}
