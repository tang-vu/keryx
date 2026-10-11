"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
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

const message = createMessages("en");
const uiCopy = message;
const uiRichCopy = createRichMessages("en");

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
  const operatingFeeUsdc = metrics.settledOperatingFeeUsdc;
  const operatingFeePayments = metrics.settledOperatingFeePayments;
  return {
    ...value,
    metrics: {
      ...metrics,
      recordedAccounts: typeof recordedAccounts === "number" && Number.isSafeInteger(recordedAccounts) && recordedAccounts >= 0 ? recordedAccounts : null,
      guestQuestions: typeof guestQuestions === "number" && Number.isSafeInteger(guestQuestions)
        && guestQuestions >= 0 && guestQuestions <= (metrics.totalQueries as number) ? guestQuestions : null,
      settledOperatingFeeUsdc: typeof operatingFeeUsdc === "number" && Number.isFinite(operatingFeeUsdc) && operatingFeeUsdc >= 0 ? operatingFeeUsdc : null,
      settledOperatingFeePayments: typeof operatingFeePayments === "number" && Number.isSafeInteger(operatingFeePayments) && operatingFeePayments >= 0 ? operatingFeePayments : null,
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
    {resource.status === "loading" ? uiCopy("ledgerResource.loading", { label }) : resource.data !== null && resource.observedAt ? uiRichCopy("ledgerResource.unavailableWithObservation", { label, observed: new Date(resource.observedAt).toLocaleString("en-GB", { timeZone: "UTC" }), retry: <button type="button" onClick={resource.retry} className="min-h-11 px-2 text-seal underline">{uiCopy("ledgerResource.retry")}</button> }) : uiRichCopy("ledgerResource.unavailable", { label, retry: <button type="button" onClick={resource.retry} className="min-h-11 px-2 text-seal underline">{uiCopy("ledgerResource.retry")}</button> })}
  </div>;
}

function recordedTotal(kind: "questions" | "accounts" | "guests", count: number, stale: boolean) {
  const keys = {
    questions: { current: { one: "ledgerRecorded.questions.current.one", other: "ledgerRecorded.questions.current.other" }, stale: { one: "ledgerRecorded.questions.stale.one", other: "ledgerRecorded.questions.stale.other" } },
    accounts: { current: { one: "ledgerRecorded.accounts.current.one", other: "ledgerRecorded.accounts.current.other" }, stale: { one: "ledgerRecorded.accounts.stale.one", other: "ledgerRecorded.accounts.stale.other" } },
    guests: { current: { one: "ledgerRecorded.guests.current.one", other: "ledgerRecorded.guests.current.other" }, stale: { one: "ledgerRecorded.guests.stale.one", other: "ledgerRecorded.guests.stale.other" } },
  } as const;
  return uiRichCopy(keys[kind][stale ? "stale" : "current"][count === 1 ? "one" : "other"], { count: <span className="font-display text-2xl">{count}</span> });
}

export function DashboardView({ sourcePreview, historyPreview }: { sourcePreview: ReactNode; historyPreview?: ReactNode }) {
  const metricsResource = useLedgerResource("/api/metrics", metricBody);
  const paymentsResource = useLedgerResource("/api/payments?limit=200", paymentBody);
  const withdrawalsResource = useLedgerResource("/api/withdrawals?limit=25", withdrawalBody);
  const runsResource = useLedgerResource("/api/runs", runBody);
  const metrics = metricsResource.data?.metrics;
  const leaderboard = metricsResource.data?.leaderboard ?? [];
  const creatorNames = new Map(leaderboard.map(row => [row.sourceId, row.sourceName]));
  const payments = (paymentsResource.data ?? []).map(payment => ({
    ...payment,
    sourceName: payment.sourceName === payment.sourceId ? creatorNames.get(payment.sourceId) ?? payment.sourceName : payment.sourceName,
  }));
  const withdrawals = withdrawalsResource.data ?? [];
  const runs = (runsResource.data ?? []).filter(run => !run.archive);

  return <div className="min-h-screen bg-paper">
    <SiteHeader />
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <header className="border-b-[1.5px] border-ink pb-6">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-seal">{uiCopy("ledgerPresentation.eyebrow")}</div>
        <h1 className="letterpress mt-3 font-display text-[clamp(28px,3.6vw,40px)] font-medium tracking-tight text-ink">{message("ledger.title")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{message("ledger.introduction")}</p>
        <nav aria-label={message("ledger.sectionsLabel")} className="mt-4 flex flex-wrap gap-x-5 text-sm text-seal">
          <Link href="/history/testnet" className="min-h-11 py-3 underline">{message("ledger.testnetTrackRecord")}</Link>
          <a href="#current-activity" className="min-h-11 py-3 underline">{message("ledger.activity", { network: currentArcLabel })}</a>
          <a href="#current-creators" className="min-h-11 py-3 underline">{message("ledger.currentCreators")}</a>
          <a href="#payment-records" className="min-h-11 py-3 underline">{message("ledger.paymentEvidence")}</a>
        </nav>
      </header>

      {historyPreview}

      <section id="current-activity" aria-label={message("ledger.currentActivityLabel")} className="mt-8 border-t border-line pt-6">
        <h2 className="font-display text-2xl text-ink">{message("ledger.activity", { network: currentArcLabel })}</h2>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="font-mono text-sm text-ink">{metrics ? recordedTotal("questions", metrics.totalQueries, metricsResource.status === "error") : metricsResource.status === "error" ? uiCopy("ledgerPresentation.questionsUnavailable") : uiCopy("ledgerPresentation.questionsLoading")}</span>
          <span className="font-mono text-sm text-ink">{metrics?.recordedAccounts != null ? recordedTotal("accounts", metrics.recordedAccounts, metricsResource.status === "error") : metrics || metricsResource.status === "error" ? uiCopy("ledgerPresentation.accountsUnavailable") : uiCopy("ledgerPresentation.accountsLoading")}</span>
          <span className="font-mono text-sm text-ink">{metrics?.guestQuestions != null ? recordedTotal("guests", metrics.guestQuestions, metricsResource.status === "error") : metrics || metricsResource.status === "error" ? uiCopy("ledgerPresentation.guestsUnavailable") : uiCopy("ledgerPresentation.guestsLoading")}</span>
          <span className="font-mono text-xs text-paid">{currentArcLabel}</span>
          <Link href="/" className="min-h-11 border border-ink bg-ink px-4 py-3 font-mono text-xs text-paper hover:underline">{uiCopy("ledgerPresentation.ask")}</Link>
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-3">{uiCopy("ledgerPresentation.accountBoundary")}</p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-3">{uiCopy("ledgerPresentation.guestBoundary")}</p>
      </section>

      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label={uiCopy("ledgerPresentation.activityAria")} className="min-w-0">
          <ResourceNotice resource={runsResource} label={uiCopy("ledgerPresentation.questionRecords")} />
          {runsResource.data !== null && <DispatchHistory runs={runs.slice(0, 4)} title={uiCopy("ledgerPresentation.recent")} showFinancials={false} />}
          {runs.length > 4 && <details className="mt-4 border border-line bg-paper-2/30"><summary className="cursor-pointer px-5 py-4 font-display text-lg text-ink">{uiCopy("ledgerPresentation.more")}</summary><div className="px-4 pb-4"><DispatchHistory runs={runs.slice(4, 25)} title={uiCopy("ledgerPresentation.earlier")} showFinancials={false} /></div></details>}
          <Link href="/answers" className="mt-3 inline-block min-h-11 py-2 font-mono text-xs text-seal underline">{uiCopy("ledgerPresentation.pastAnswers")}</Link>
        </section>
        <aside aria-labelledby="payment-proof-title" className="border-t-2 border-seal bg-paper-2 p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-seal">{uiCopy("ledgerPresentation.proofEyebrow")}</div>
          <h2 id="payment-proof-title" className="mt-3 font-display text-2xl text-ink">{metricsResource.status !== "ready" ? uiCopy("ledgerPresentation.records") : metrics?.totalPayments ? uiCopy("ledgerPresentation.settlements") : metrics?.pendingPaymentConfirmations ? uiCopy("ledgerPresentation.awaitingProof") : uiCopy("ledgerPresentation.noSettledPayments")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">{uiCopy("ledgerPresentation.settlementBoundary")}</p>
          <ResourceNotice resource={metricsResource} label={uiCopy("ledgerPresentation.totals")} />
          {metrics && <>
            {metrics.pendingPaymentConfirmations > 0 && <p className="mt-3 text-sm text-amber-800">{uiCopy(metrics.pendingPaymentConfirmations === 1 ? "ledgerPresentation.pending.one" : "ledgerPresentation.pending.other", { count: metrics.pendingPaymentConfirmations, amount: fmtUsdc(metrics.pendingPaymentVolumeUsdc) })}</p>}
            {metrics.failedPaymentAttempts > 0 && <p className="mt-3 text-sm text-red-700">{uiCopy(metrics.failedPaymentAttempts === 1 ? "ledgerPresentation.failed.one" : "ledgerPresentation.failed.other", { count: metrics.failedPaymentAttempts, amount: fmtUsdc(metrics.failedPaymentVolumeUsdc) })}</p>}
            <details className="mt-4 border-t border-line pt-2" open={metrics.totalPayments > 0 || undefined}>
              <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-ink">{uiCopy("ledgerPresentation.inspectTotals")}</summary>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 text-sm text-ink-2">
                <dt>{uiCopy("ledgerPresentation.settledPayments")}</dt><dd className="font-mono text-ink">{metrics.totalPayments}</dd>
                <dt>{uiCopy("ledgerPresentation.settledVolume")}</dt><dd className="font-mono text-ink">${fmtUsdc(metrics.totalVolumeUsdc)}</dd>
                <dt>{uiCopy("ledgerPresentation.creatorRewards")}</dt><dd className="font-mono text-ink">${fmtUsdc(metrics.totalCreatorPayoutsUsdc)}</dd>
                <dt>{uiCopy("ledgerPresentation.creatorsEarning")}</dt><dd className="font-mono text-ink">{metrics.creatorsEarning}</dd>
                <dt>{uiCopy("ledgerPresentation.operatingFees")}</dt><dd className="font-mono text-ink">{metrics.settledOperatingFeeUsdc != null ? `$${fmtUsdc(metrics.settledOperatingFeeUsdc)}` : uiCopy("ledgerPresentation.unavailable")}</dd>
                <dt>{uiCopy("ledgerPresentation.operatingTransfers")}</dt><dd className="font-mono text-ink">{metrics.settledOperatingFeePayments ?? uiCopy("ledgerPresentation.unavailable")}</dd>
              </dl>
              <p className="mt-3 font-mono text-[11px] text-ink-3">{uiCopy("ledgerPresentation.totalsBoundary")}</p>
            </details>
          </>}
          <Link href="/proof" className="mt-3 inline-block min-h-11 py-2 font-mono text-xs text-seal underline">{uiCopy("ledgerPresentation.verifyRecords")}</Link>
          <Link href="/claim-source" className="mt-3 block border-t border-line pt-4 text-sm text-seal underline">{uiCopy("ledgerPresentation.claimSource")}</Link>
        </aside>
      </div>

      <section id="current-creators" aria-label={message("ledger.currentCreators")} className="mt-8">
        <ResourceNotice resource={withdrawalsResource} label={uiCopy("ledgerPresentation.cashouts")} />
        {(leaderboard.length > 0 || withdrawals.length > 0) && <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {leaderboard.length > 0 && <CreatorLeaderboard rows={leaderboard} title={message("ledger.creatorLeaderboard", { network: currentArcLabel })} />}
          {withdrawals.length > 0 && <CreatorCashoutsPanel withdrawals={withdrawals} compact />}
        </div>}
      </section>

      {sourcePreview}

      <section id="payment-records" aria-label={uiCopy("ledgerPresentation.paymentRecords")} className="mt-8">
        <ResourceNotice resource={paymentsResource} label={uiCopy("ledgerPresentation.paymentRecords")} />
        {payments.length > 0 && <details className="border border-line"><summary className="min-h-11 cursor-pointer px-5 py-3 font-display text-lg text-ink">{uiCopy("ledgerPresentation.inspectPayments")}</summary><PaymentsFeed payments={payments} /></details>}
        {(payments.length > 0 || withdrawals.length > 0) && <p className="mt-4 text-sm leading-relaxed text-ink-2">{uiCopy("ledgerPresentation.referencesBoundary")}</p>}
      </section>
    </main>
    <SiteFooter />
  </div>;
}
