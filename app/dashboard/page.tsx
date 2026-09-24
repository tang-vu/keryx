"use client";

/**
 * Dashboard — traction screen. Polls /api/metrics and /api/payments every ~10s
 * and renders metric tiles, the creator leaderboard, and a live payments feed.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Coins, Receipt, TrendingUp } from "lucide-react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { MetricCard } from "@/components/keryx/metric-card";
import {
  CreatorLeaderboard,
  type LeaderboardEntry,
} from "@/components/keryx/creator-leaderboard";
import { PaymentsFeed } from "@/components/keryx/payments-feed";
import { CreatorCashoutsPanel } from "@/components/keryx/creator-cashouts-panel";
import { DispatchHistory } from "@/components/keryx/dispatch-history";
import { fmtUsdc } from "@/components/keryx/phase-style";
import type {
  DashboardMetrics,
  PaymentRecord,
  WithdrawalRecord,
} from "@/lib/types";

const POLL_MS = 10_000;

interface MetricsResponse {
  metrics: DashboardMetrics;
  leaderboard: LeaderboardEntry[];
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [runs, setRuns] = useState<
    {
      id: string;
      question: string;
      createdAt: string;
      totalSpent: number;
      totalToCreators: number;
      citationCount: number;
    }[]
  >([]);

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
        }
        if (pRes.ok) {
          const data = (await pRes.json()) as { payments: PaymentRecord[] };
          setPayments(data.payments ?? []);
        }
        if (wRes.ok) {
          const data = (await wRes.json()) as {
            withdrawals: WithdrawalRecord[];
          };
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
              Questions, creator payouts, and proof
            </h1>
            <p className="mt-1.5 text-sm text-ink-2">
              A public record of Keryx queries and settled creator payments in
              USDC on Arc testnet.
            </p>
            <Link
              href="/proof"
              className="mt-3 inline-block font-mono text-[11px] font-semibold text-seal hover:underline"
            >
              How these records are verified →
            </Link>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-full border border-paid/40 bg-paid/[0.07] px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-paid sm:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paid" />
            Arc testnet
          </span>
        </header>

        <section className="mt-6" aria-label="Ledger overview">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Total queries"
              value={String(metrics?.totalQueries ?? 0)}
              sub="all readers and agents"
              icon={TrendingUp}
              accent="neutral"
              loading={!metrics}
            />
            <MetricCard
              label="Settled payments"
              value={String(metrics?.totalPayments ?? 0)}
              sub="verified payment records"
              icon={Receipt}
              accent="neutral"
              loading={!metrics}
            />
            <MetricCard
              label="Settled volume"
              value={`$${fmtUsdc(metrics?.totalVolumeUsdc)}`}
              sub="USDC"
              icon={ArrowLeftRight}
              accent="amber"
              loading={!metrics}
            />
            <MetricCard
              label="Creator payouts"
              value={`$${fmtUsdc(metrics?.totalCreatorPayoutsUsdc)}`}
              sub={`${metrics?.creatorsEarning ?? 0} creators earning`}
              icon={Coins}
              accent="emerald"
              loading={!metrics}
            />
          </div>

          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-2">
            Readers and agents ask questions. Keryx buys useful sources and pays
            creators it cites. Payment and volume totals include only settled
            records.
          </p>
          {metrics && metrics.pendingPaymentConfirmations > 0 && (
            <div className="mt-3 border border-amber-600/40 bg-amber-50 px-4 py-3 font-mono text-[11px] text-amber-800">
              {metrics.pendingPaymentConfirmations} signed authorization
              {metrics.pendingPaymentConfirmations === 1 ? "" : "s"} ($
              {fmtUsdc(metrics.pendingPaymentVolumeUsdc)}) await settlement proof.
              They are excluded from the settled totals above.
            </div>
          )}
          {metrics && metrics.failedPaymentAttempts > 0 && (
            <div className="mt-3 border border-red-600/40 bg-red-50 px-4 py-3 font-mono text-[11px] text-red-800">
              {metrics.failedPaymentAttempts} Circle-terminal payment attempt
              {metrics.failedPaymentAttempts === 1 ? "" : "s"} ($
              {fmtUsdc(metrics.failedPaymentVolumeUsdc)}) failed and were not
              charged. These receipts are excluded from the settled totals above.
            </div>
          )}
        </section>
        <section className="mt-10" aria-labelledby="recent-activity-title">
          <div className="mb-4">
            <h2
              id="recent-activity-title"
              className="font-display text-2xl font-medium text-ink"
            >
              Recent activity
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              Open a question to see its cited answer, or inspect the latest
              creator payments.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <DispatchHistory runs={runs.slice(0, 5)} />
            <PaymentsFeed payments={payments.slice(0, 8)} compact />
          </div>
        </section>

        <section className="mt-10" aria-labelledby="creator-proof-title">
          <div className="mb-4">
            <h2
              id="creator-proof-title"
              className="font-display text-2xl font-medium text-ink"
            >
              Creators and proof
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              Earnings are settled through Circle Gateway in batches. Cash-outs
              link to individual Arc transactions.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <CreatorLeaderboard rows={leaderboard.slice(0, 5)} />
            <CreatorCashoutsPanel
              withdrawals={withdrawals.slice(0, 5)}
              compact
            />
          </div>
        </section>

        <details className="group mt-10 border border-line bg-paper-2/30">
          <summary className="cursor-pointer px-5 py-4 font-display text-xl text-ink marker:text-seal">
            More records
          </summary>
          <div className="border-t border-line px-5 pb-6">
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-2">
              Individual payments have Circle Gateway settlement references, not
              individual EVM transaction hashes. The live feed links to the
              batch settlement wallet; creator cash-outs link to their own Arc
              transactions.
            </p>
            {(leaderboard.length > 5 || payments.length > 8) && (
              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                {leaderboard.length > 5 && (
                  <CreatorLeaderboard rows={leaderboard.slice(5)} />
                )}
                {payments.length > 8 && (
                  <PaymentsFeed payments={payments.slice(8, 25)} />
                )}
              </div>
            )}
            {withdrawals.length > 5 && (
              <div className="mt-5">
                <CreatorCashoutsPanel withdrawals={withdrawals.slice(5)} />
              </div>
            )}
            {runs.length > 5 && (
              <div className="mt-5">
                <DispatchHistory runs={runs.slice(5, 15)} />
              </div>
            )}
          </div>
        </details>
      </main>
      <SiteFooter />
    </div>
  );
}
