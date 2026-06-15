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
  TrendingUp,
  Users,
} from "lucide-react";
import { SiteHeader } from "@/components/keryx/site-header";
import { MetricCard } from "@/components/keryx/metric-card";
import {
  CreatorLeaderboard,
  type LeaderboardEntry,
} from "@/components/keryx/creator-leaderboard";
import { PaymentsFeed } from "@/components/keryx/payments-feed";
import { fmtUsdc } from "@/components/keryx/phase-style";
import type { DashboardMetrics, PaymentRecord } from "@/lib/types";

const POLL_MS = 2000;

interface MetricsResponse {
  metrics: DashboardMetrics;
  leaderboard: LeaderboardEntry[];
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const [mRes, pRes] = await Promise.all([
          fetch("/api/metrics", { cache: "no-store" }),
          fetch("/api/payments?limit=25", { cache: "no-store" }),
        ]);
        if (!alive) return;
        if (mRes.ok) {
          const data = (await mRes.json()) as MetricsResponse;
          setMetrics(data.metrics);
          setLeaderboard(data.leaderboard ?? []);
        }
        if (pRes.ok) {
          const data = (await pRes.json()) as { payments: PaymentRecord[] };
          setPayments(data.payments ?? []);
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
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Traction
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real value flowing to creators — every payment Keryx has settled.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <MetricCard
            label="Total payments"
            value={String(metrics?.totalPayments ?? 0)}
            icon={Receipt}
            accent="neutral"
          />
          <MetricCard
            label="Total volume"
            value={`$${fmtUsdc(metrics?.totalVolumeUsdc)}`}
            sub="USDC"
            icon={ArrowLeftRight}
            accent="amber"
          />
          <MetricCard
            label="Creator payouts"
            value={`$${fmtUsdc(metrics?.totalCreatorPayoutsUsdc)}`}
            sub="USDC to creators"
            icon={Coins}
            accent="emerald"
          />
          <MetricCard
            label="Creators earning"
            value={String(metrics?.creatorsEarning ?? 0)}
            icon={Users}
            accent="amber"
          />
          <MetricCard
            label="Avg payment"
            value={`$${fmtUsdc(metrics?.avgPaymentUsdc)}`}
            sub="USDC"
            icon={Banknote}
            accent="neutral"
          />
          <MetricCard
            label="Reader → payer"
            value={`${Math.round((metrics?.readerToPayerConversion ?? 0) * 100)}%`}
            sub={`${metrics?.payingQueries ?? 0} / ${metrics?.totalQueries ?? 0} queries`}
            icon={TrendingUp}
            accent="emerald"
          />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <CreatorLeaderboard rows={leaderboard} />
          <PaymentsFeed payments={payments} />
        </section>
      </main>
    </div>
  );
}
