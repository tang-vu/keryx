"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { DispatchHistory, type RunSummary } from "./dispatch-history";
import { PaymentsFeed } from "./payments-feed";
import { CreatorLeaderboard, type LeaderboardEntry } from "./creator-leaderboard";
import { CreatorCashoutsPanel } from "./creator-cashouts-panel";
import { fmtUsdc } from "./phase-style";
import { currentArcLabel } from "@/lib/arc-network-display";
import { useLedgerResource, type LedgerResource } from "@/lib/hooks/use-ledger-resource";
import type { DashboardMetrics, PaymentRecord, WithdrawalRecord } from "@/lib/types";

interface MetricsResponse { metrics: DashboardMetrics; leaderboard: LeaderboardEntry[] }

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid ledger response");
  return body as Record<string, unknown>;
}
function metricBody(body: unknown): MetricsResponse {
  const value = objectBody(body);
  const metrics = objectBody(value.metrics);
  for (const key of ["totalQueries", "totalPayments", "totalVolumeUsdc", "totalCreatorPayoutsUsdc", "creatorsEarning", "pendingPaymentConfirmations", "pendingPaymentVolumeUsdc", "failedPaymentAttempts", "failedPaymentVolumeUsdc"]) {
    if (typeof metrics[key] !== "number" || !Number.isFinite(metrics[key]) || (metrics[key] as number) < 0) throw new Error("Invalid ledger metric");
  }
  if (!Array.isArray(value.leaderboard)) throw new Error("Invalid leaderboard");
  const recordedAccounts = metrics.recordedAccounts;
  const guestQuestions = metrics.guestQuestions;
  return {
    ...value,
    metrics: {
      ...metrics,
      recordedAccounts: typeof recordedAccounts === "number" && Number.isSafeInteger(recordedAccounts) && recordedAccounts >= 0 ? recordedAccounts : null,
      guestQuestions: typeof guestQuestions === "number" && Number.isSafeInteger(guestQuestions)
        && guestQuestions >= 0 && guestQuestions <= (metrics.totalQueries as number) ? guestQuestions : null,
    },
  } as unknown as MetricsResponse;
}
function paymentBody(body: unknown): PaymentRecord[] {
  const value = objectBody(body).payments;
  if (!Array.isArray(value)) throw new Error("Invalid payment records");
  return value;
}
function withdrawalBody(body: unknown): WithdrawalRecord[] {
  const value = objectBody(body).withdrawals;
  if (!Array.isArray(value)) throw new Error("Invalid withdrawal records");
  return value;
}
function runBody(body: unknown): RunSummary[] {
  if (!Array.isArray(body)) throw new Error("Invalid question records");
  return body;
}

function ResourceNotice({ resource, label }: { resource: LedgerResource<unknown> & { retry: () => void }; label: string }) {
  if (resource.status === "ready") return null;
  return <div role="status" className="mb-3 text-sm leading-relaxed text-ink-2">
    {resource.status === "loading" ? `Loading ${label}…` : <>
      {label} unavailable.{resource.data !== null && resource.observedAt && ` Showing the last successful read from ${new Date(resource.observedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.`}{" "}
      <button type="button" onClick={resource.retry} className="min-h-11 px-2 text-seal underline">Retry</button>
    </>}
  </div>;
}

export function DashboardView({ sourcePreview }: { sourcePreview: ReactNode }) {
  const metricsResource = useLedgerResource("/api/metrics", metricBody);
  const paymentsResource = useLedgerResource("/api/payments?limit=200", paymentBody);
  const withdrawalsResource = useLedgerResource("/api/withdrawals?limit=25", withdrawalBody);
  const runsResource = useLedgerResource("/api/runs", runBody);
  const metrics = metricsResource.data?.metrics;
  const leaderboard = metricsResource.data?.leaderboard ?? [];
  const payments = paymentsResource.data ?? [];
  const withdrawals = withdrawalsResource.data ?? [];
  const runs = runsResource.data ?? [];

  return <div className="min-h-screen bg-paper">
    <SiteHeader />
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <header className="border-b-[1.5px] border-ink pb-6">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-seal">The ledger</div>
        <h1 className="letterpress mt-3 font-display text-[clamp(28px,3.6vw,40px)] font-medium tracking-tight text-ink">Reading activity &amp; payment proof</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">Explore recorded questions, citations, and sources. Creator payments appear with their original settlement evidence and network.</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="font-mono text-sm text-ink">{metrics ? <><span className="font-display text-2xl">{metrics.totalQueries}</span> recorded questions{metricsResource.status === "error" && " · last successful read"}</> : metricsResource.status === "error" ? "Question total unavailable" : "Loading question total…"}</span>
          <span className="font-mono text-sm text-ink">{metrics?.recordedAccounts != null ? <><span className="font-display text-2xl">{metrics.recordedAccounts}</span> recorded accounts{metricsResource.status === "error" && " · last successful read"}</> : metrics || metricsResource.status === "error" ? "Account total unavailable" : "Loading account total…"}</span>
          <span className="font-mono text-sm text-ink">{metrics?.guestQuestions != null ? <><span className="font-display text-2xl">{metrics.guestQuestions}</span> guest questions{metricsResource.status === "error" && " · last successful read"}</> : metrics || metricsResource.status === "error" ? "Guest question total unavailable" : "Loading guest question total…"}</span>
          <span className="font-mono text-xs text-paid">{currentArcLabel}</span>
          <Link href="/" className="min-h-11 border border-ink bg-ink px-4 py-3 font-mono text-xs text-paper hover:underline">Ask a question →</Link>
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-3">Account totals include verified Google and wallet sign-ins. Each wallet is counted once; one person may use several wallets.</p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-3">Guest questions are included in recorded questions: completed web questions with no signed-in wallet recorded. This counts questions, not visits or unique people.</p>
      </header>

      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Recorded research activity" className="min-w-0">
          <ResourceNotice resource={runsResource} label="Question records" />
          {runsResource.data !== null && <DispatchHistory runs={runs.slice(0, 8)} title="Recent questions" showFinancials={false} />}
          {runs.length > 8 && <details className="mt-4 border border-line bg-paper-2/30"><summary className="cursor-pointer px-5 py-4 font-display text-lg text-ink">More questions</summary><div className="px-4 pb-4"><DispatchHistory runs={runs.slice(8, 25)} title="Earlier questions" showFinancials={false} /></div></details>}
          <Link href="/answers" className="mt-3 inline-block min-h-11 py-2 font-mono text-xs text-seal underline">Browse past answers →</Link>
        </section>
        <aside aria-labelledby="payment-proof-title" className="border-t-2 border-seal bg-paper-2 p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-seal">Payment proof</div>
          <h2 id="payment-proof-title" className="mt-3 font-display text-2xl text-ink">{metricsResource.status !== "ready" ? "Settlement records" : metrics?.totalPayments ? "Recorded settlements" : metrics?.pendingPaymentConfirmations ? "Awaiting settlement proof" : "No settled payments yet"}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">Public-source research and citations are recorded separately from payments. Creator rewards require eligible sources, an authorized budget, and settlement evidence.</p>
          <ResourceNotice resource={metricsResource} label="Settlement totals" />
          {metrics && <>
            {metrics.pendingPaymentConfirmations > 0 && <p className="mt-3 text-sm text-amber-800">{metrics.pendingPaymentConfirmations} signed authorization(s), ${fmtUsdc(metrics.pendingPaymentVolumeUsdc)} USDC, await settlement proof and are excluded from settled totals.</p>}
            {metrics.failedPaymentAttempts > 0 && <p className="mt-3 text-sm text-red-700">{metrics.failedPaymentAttempts} Circle-terminal attempt(s) failed and were not charged; ${fmtUsdc(metrics.failedPaymentVolumeUsdc)} USDC is excluded from settled totals.</p>}
            <details className="mt-4 border-t border-line pt-2" open={metrics.totalPayments > 0 || undefined}>
              <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-ink">Inspect recorded totals</summary>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 text-sm text-ink-2">
                <dt>Settled payments</dt><dd className="font-mono text-ink">{metrics.totalPayments}</dd>
                <dt>Settled volume</dt><dd className="font-mono text-ink">${fmtUsdc(metrics.totalVolumeUsdc)}</dd>
                <dt>Creator payouts</dt><dd className="font-mono text-ink">${fmtUsdc(metrics.totalCreatorPayoutsUsdc)}</dd>
                <dt>Creators earning</dt><dd className="font-mono text-ink">{metrics.creatorsEarning}</dd>
              </dl>
              <p className="mt-3 font-mono text-[11px] text-ink-3">Amounts in USDC. Only settled records count.</p>
            </details>
          </>}
          <Link href="/proof" className="mt-3 inline-block min-h-11 py-2 font-mono text-xs text-seal underline">How these records are verified →</Link>
          <Link href="/claim-source" className="mt-3 block border-t border-line pt-4 text-sm text-seal underline">Publish work? Claim your source →</Link>
        </aside>
      </div>

      {sourcePreview}

      <section aria-label="Payment records" className="mt-8">
        <ResourceNotice resource={paymentsResource} label="Payment records" />
        {payments.length > 0 && <>
          <PaymentsFeed payments={payments.slice(0, 8)} compact />
          <details className="mt-4 border border-line"><summary className="min-h-11 cursor-pointer px-5 py-3 font-display text-lg text-ink">Inspect payment evidence</summary><PaymentsFeed payments={payments} /></details>
        </>}
        <ResourceNotice resource={withdrawalsResource} label="Cash-out records" />
        {(leaderboard.length > 0 || withdrawals.length > 0) && <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {leaderboard.length > 0 && <CreatorLeaderboard rows={leaderboard} />}
          {withdrawals.length > 0 && <CreatorCashoutsPanel withdrawals={withdrawals} compact />}
        </div>}
        {(payments.length > 0 || withdrawals.length > 0) && <p className="mt-4 text-sm leading-relaxed text-ink-2">Individual payment references identify Circle Gateway batch settlements. Creator cash-outs link to their own Arc transactions. Each record retains its original network.</p>}
      </section>
    </main>
    <SiteFooter />
  </div>;
}
