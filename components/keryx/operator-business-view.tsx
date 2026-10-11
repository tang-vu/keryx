"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CirclePause, FileCheck2, Layers3, Radio, ShieldCheck } from "lucide-react";
import {
  operatorBusinessStatusSchema,
  type OperatorBusinessStatus,
} from "@/lib/business-operator/contracts";
import { cn } from "@/lib/utils";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { createFormatters } from "@/lib/i18n/format";

const uiFormat = createFormatters("en");

const message = createMessages("en");
const richMessage = createRichMessages("en");
const REASON_MESSAGE = {
  "no-orders": "operatorBusiness.reasonNoOrders",
  "liquidity-covered": "operatorBusiness.reasonLiquidityCovered",
  "liquidity-unavailable": "operatorBusiness.reasonLiquidityUnavailable",
  "liquidity-short": "operatorBusiness.reasonLiquidityShort",
  "policy-cap": "operatorBusiness.reasonPolicyCap",
  "incomplete-inventory": "operatorBusiness.reasonIncompleteInventory",
  "original-job-needs-review": "operatorBusiness.reasonOriginalJobNeedsReview",
  "another-job-active": "operatorBusiness.reasonAnotherJobActive",
  "acceptance-paused": "operatorBusiness.reasonAcceptancePaused",
} as const;

const STATE = {
  disabled: { label: message("operatorBusiness.disabled"), text: message("operatorBusiness.theOperatorWorkerIsDisabledThisViewDoes"), tone: "text-ink-3", Icon: CirclePause },
  idle: { label: message("operatorBusiness.activeIdle"), text: message("operatorBusiness.theWorkerIsObservingPrepaidOrdersAndWaiting"), tone: "text-paid", Icon: Radio },
  working: { label: message("operatorBusiness.activeWorking"), text: message("operatorBusiness.theLastObservationShowsAcceptedResearchInProgress"), tone: "text-paid", Icon: Radio },
  held: { label: message("operatorBusiness.held"), text: message("operatorBusiness.newWorkIsHeldAtAnOperatingBoundary"), tone: "text-seal", Icon: CirclePause },
  review: { label: message("operatorBusiness.reviewRequired"), text: message("operatorBusiness.anOriginalObligationNeedsHumanReviewBeforeThe"), tone: "text-seal", Icon: ShieldCheck },
  stale: { label: message("operatorBusiness.observationStale"), text: message("operatorBusiness.theWorkerObservationIsOutOfDateCurrent"), tone: "text-seal", Icon: CirclePause },
  unavailable: { label: message("operatorBusiness.unknown"), text: message("operatorBusiness.aCurrentWorkerObservationIsUnavailableActivityCannot"), tone: "text-ink-3", Icon: CirclePause },
} as const;

const WORKFLOW = [
  { title: message("operatorBusiness.receivePrepaidResearch"), text: message("operatorBusiness.aCustomerChoosesAPricedPackageVerifiedPayment") },
  { title: message("operatorBusiness.assessObligationsCapacity"), text: message("operatorBusiness.theOperatorChecksUnfinishedObligationsAndAvailableCapacity") },
  { title: message("operatorBusiness.buyReadUnderBudget"), text: message("operatorBusiness.theReadingAgentDiscoversSourcesExplainsBUYSKIP") },
  { title: message("operatorBusiness.deliverReviewedResearch"), text: message("operatorBusiness.evidenceChecksDetermineWhichClaimsCitationsAndLimitations") },
  { title: message("operatorBusiness.reconcileOrEscalate"), text: message("operatorBusiness.receiptsPreservePaymentStateUncertainOriginalJobsAre") },
];

function timestamp(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return message("operatorBusiness.unknown");
  return uiFormat.dateTime(value);
}

function count(value: number | null | undefined): string {
  return value == null ? message("operatorBusiness.unknown") : uiFormat.number(value);
}

function elapsed(seconds: number | null | undefined): string {
  if (seconds == null) return message("operatorBusiness.unknown");
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds % 3_600 / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds % 86_400 / 3_600)}h`;
}

function networkLabel(network?: string): string {
  if (network === "eip155:5042") return message("operatorBusiness.arcMainnet");
  if (network === "eip155:5042002") return message("operatorBusiness.arcTestnet");
  return message("operatorBusiness.networkUnknown");
}

/** Polling is a public GET observation, never an execution or spending control. */
export function OperatorBusinessView() {
  const [status, setStatus] = useState<OperatorBusinessStatus | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch("/api/operator/status", {
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
        });
        if (!response.ok) throw new Error("Status unavailable");
        const parsed = operatorBusinessStatusSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Status unavailable");
        if (alive) { setStatus(parsed.data); setReadState("ready"); }
      } catch {
        if (alive) { setStatus(null); setReadState("unavailable"); }
      } finally {
        if (alive) timer = setTimeout(poll, 30_000);
      }
    };
    void poll();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);

  return <OperatorBusinessSnapshot status={status} readState={readState} />;
}

/** The same public snapshot renders loading, failure and recorded worker states. */
export function OperatorBusinessSnapshot({ status, readState = "ready" }: {
  status: OperatorBusinessStatus | null;
  readState?: "loading" | "ready" | "unavailable";
}) {
  const state = status?.operator.state ?? "unavailable";
  const appearance = STATE[state];
  const jobs = status?.jobs;
  const decision = status?.operator.decision;
  const loading = readState === "loading";
  const terminal = jobs ? jobs.completedLast24h + jobs.failedLast24h : null;
  const registered = status?.creatorCatalog.registered;
  const Icon = appearance.Icon;

  return (
    <div className="space-y-8 sm:space-y-12">
      <header className="grid gap-8 border-b border-ink pb-9 lg:grid-cols-[1fr_320px] lg:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">{message("operatorBusiness.keryxOperatorBusinessOperations")}</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.05] sm:text-6xl">{richMessage("operatorBusiness.title", { lineBreak: <br className="hidden sm:block" /> })}</h1>
          <p className="mt-5 max-w-2xl font-serif text-lg leading-relaxed text-ink-2">{message("operatorBusiness.followTheServiceFromAPrepaidQuestionTo")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/research#paid-research" className="inline-flex min-h-11 items-center gap-3 border border-ink bg-ink px-5 py-3 font-mono text-xs text-paper transition-colors hover:bg-ink-2">{richMessage("operatorBusiness.requestResearchContent", { arrowIcon: <ArrowRight className="h-4 w-4" aria-hidden="true" /> })}</Link>
            <Link href="/sources" className="inline-flex min-h-11 items-center gap-3 border border-line bg-paper px-5 py-3 font-mono text-xs transition-colors hover:border-ink">{richMessage("operatorBusiness.exploreCreatorSourcesContent", { arrowIcon: <ArrowRight className="h-4 w-4" aria-hidden="true" /> })}</Link>
          </div>
        </div>
        <div className="border border-ink bg-paper p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-3">{message("operatorBusiness.operatingBoundary")}</p>
          <div className="mt-4 flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-paid" aria-hidden="true" /><p className="font-serif text-base leading-relaxed">{message("operatorBusiness.prepaidOrdersOriginalBudgetsHumanReviewWhenEvidence")}</p></div>
          <p className="mt-4 border-t border-line pt-3 font-mono text-[10px] leading-relaxed text-ink-3">{message("operatorBusiness.aWorkerObservationIsNotProofOfSettlement")}</p>
        </div>
      </header>

      <section aria-labelledby="operator-state-heading" className="grid border border-ink bg-paper md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="p-6 sm:p-8" aria-live="polite">
          <div className="flex items-center justify-between gap-3"><h2 id="operator-state-heading" className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-3">{message("operatorBusiness.currentObservation")}</h2><span className="font-mono text-[10px] text-ink-3">{networkLabel(status?.network)}</span></div>
          <div className={cn("mt-6 flex items-center gap-3", appearance.tone)}><Icon className="h-6 w-6 shrink-0" aria-hidden="true" /><p className="font-display text-3xl sm:text-4xl">{loading ? message("operatorBusiness.readingStatus") : appearance.label}</p></div>
          <p className="mt-4 max-w-lg font-serif text-base leading-relaxed text-ink-2">{loading ? message("operatorBusiness.checkingThePublicOperatingSnapshotCountsRemainUnknown") : appearance.text}</p>
          {readState === "unavailable" && <p role="status" className="mt-3 font-mono text-xs leading-relaxed text-seal">{message("operatorBusiness.theStatusServiceCouldNotBeReadPrevious")}</p>}
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-ink-3">{richMessage("operatorBusiness.observationRefresh", { observedAt: timestamp(status?.operator.observedAt) })}</p>
        </div>
        <div className="border-t border-line bg-panel p-6 sm:p-8 md:border-l md:border-t-0">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-3">{message("operatorBusiness.lastObservedDecision")}</h2>
          <p className="mt-5 font-display text-2xl">{decision ? ({ idle: message("operatorBusiness.waitForAnOrder"), "run-next": message("operatorBusiness.proceedWithinPolicy"), hold: message("operatorBusiness.holdNewWork"), review: message("operatorBusiness.escalateForReview") }[decision.action]) : message("operatorBusiness.noDecisionAvailable")}</p>
          <p className="mt-3 font-serif text-base leading-relaxed text-ink-2">{decision ? message(REASON_MESSAGE[decision.reason]) : message("operatorBusiness.aDecisionIsShownOnlyAfterItHas")}</p>
          <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div><dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{message("operatorBusiness.decisionObserved")}</dt><dd className="mt-1 font-mono text-[11px]">{timestamp(decision?.observedAt)}</dd></div>
            <div><dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{message("operatorBusiness.auditRecord")}</dt><dd className="mt-1 font-mono text-[11px]">{status ? status.operator.auditRecorded ? message("operatorBusiness.recorded") : message("operatorBusiness.notRecorded") : message("operatorBusiness.unknown")}</dd></div>
          </dl>
          {status && !status.operator.auditRecorded && <p className="mt-3 font-mono text-[10px] leading-relaxed text-seal">{message("operatorBusiness.thePublicObservationDoesNotConfirmADurable")}</p>}
        </div>
      </section>

      <section aria-labelledby="order-queue-heading">
        <SectionHeading number="01" title={message("operatorBusiness.acceptedResearchQueue")} id="order-queue-heading" detail={message("operatorBusiness.selectedNetworkCurrentOrderRecords")} />
        <dl className="mt-5 grid grid-cols-1 border border-line bg-paper sm:grid-cols-3">
          <Metric label={message("operatorBusiness.queued")} value={count(jobs?.queued)} detail={message("operatorBusiness.prepaidOrdersAwaitingExecution")} Icon={Layers3} />
          <Metric label={message("operatorBusiness.processing")} value={count(jobs?.processing)} detail={message("operatorBusiness.originalJobsAlreadyStarted")} Icon={Radio} />
          <Metric label={message("operatorBusiness.needsReview")} value={count(jobs?.reviewRequired)} detail={message("operatorBusiness.originalJobsRequiringReconciliation")} Icon={ShieldCheck} alert={!!jobs?.reviewRequired} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10px] text-ink-3"><span>{richMessage("operatorBusiness.oldestQueued", { oldestQueuedAgeSeconds: elapsed(jobs?.oldestQueuedAgeSeconds) })}</span><span>{richMessage("operatorBusiness.oldestProcessing", { oldestProcessingAgeSeconds: elapsed(jobs?.oldestProcessingAgeSeconds) })}</span>{jobs?.degraded && <span className="text-seal">{message("operatorBusiness.queueObservationDegradedWaitingOrReviewNeedsAttention")}</span>}</div>
        {!jobs && <p className="mt-3 font-serif text-sm text-ink-3">{message("operatorBusiness.theQueueIsUnknownMissingRecordsAreNot")}</p>}
      </section>

      <section aria-labelledby="delivery-heading" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
        <div>
          <SectionHeading number="02" title={message("operatorBusiness.recordedDeliveryOutcomes")} id="delivery-heading" detail={message("operatorBusiness.terminalOrdersLast24Hours")} />
          <dl className="mt-5 grid border border-line bg-paper sm:grid-cols-2">
            <Metric label={message("operatorBusiness.completed")} value={count(jobs?.completedLast24h)} detail={message("operatorBusiness.ordersWithASavedCompletedResult")} Icon={FileCheck2} />
            <Metric label={message("operatorBusiness.failed")} value={count(jobs?.failedLast24h)} detail={message("operatorBusiness.ordersRecordedAsFailed")} Icon={CirclePause} />
          </dl>
          <p className="mt-3 font-serif text-sm leading-relaxed text-ink-3">{terminal === 0 ? message("operatorBusiness.noTerminalOrderOutcomesAreRecordedInThis") : message("operatorBusiness.orderCompletionDescribesDeliveryStateItDoesNot")}</p>
          <div className="mt-6" aria-labelledby="completion-latency-heading">
            <h3 id="completion-latency-heading" className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{message("operatorBusiness.completionTimingByRecordedPath")}</h3>
            <p className="mt-2 font-serif text-sm leading-relaxed text-ink-3">{message("operatorBusiness.acceptanceToRecordedCompletionUpdateForOrdersRecorded")}</p>
            {jobs?.completionLatencyCohorts ? <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left font-mono text-[10px]">
                <caption className="sr-only">{message("operatorBusiness.recordedCompletionLatencyCohortsNotFirstAnswerOr")}</caption>
                <thead><tr className="border-b border-line">{[message("operatorBusiness.path"), message("operatorBusiness.completed"), message("operatorBusiness.timedSamples"), message("operatorBusiness.median"), message("operatorBusiness.percentile95")].map(label => <th key={label} scope="col" className="px-2 py-2 font-normal text-ink-3">{label}</th>)}</tr></thead>
                <tbody>{(["ordinary", "recovered", "unknown"] as const).map(path => {
                  const cohort = jobs.completionLatencyCohorts![path];
                  return <tr key={path} className="border-b border-line"><th scope="row" className="px-2 py-2 font-normal">{{ ordinary: message("operatorBusiness.ordinary"), recovered: message("operatorBusiness.recovered"), unknown: message("operatorBusiness.unknownPath") }[path]}</th><td className="px-2 py-2">{count(cohort.completed)}</td><td className="px-2 py-2">{count(cohort.timedSamples)}</td><td className="px-2 py-2">{elapsed(cohort.p50Ms == null ? null : cohort.p50Ms / 1000)}</td><td className="px-2 py-2">{elapsed(cohort.p95Ms == null ? null : cohort.p95Ms / 1000)}</td></tr>;
                })}</tbody>
              </table>
            </div> : <p className="mt-3 font-serif text-sm text-ink-3">{message("operatorBusiness.completionPathTimingIsUnavailableOnThisStorage")}</p>}
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-ink-3">{message("operatorBusiness.timingDoesNotMeasureTheFirstAnswerOr")}</p>
          </div>
        </div>
        <div className="border border-line bg-panel p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-3">{message("operatorBusiness.creatorCatalog")}</p>
          <p className="mt-4 font-display text-5xl tabular-nums">{count(registered)}</p>
          <p className="mt-2 font-serif text-sm text-ink-2">{message("operatorBusiness.registeredSourcesInTheSelectedCatalog")}</p>
          <p className="mt-4 font-serif text-sm leading-relaxed text-ink-3">{registered === 0 ? message("operatorBusiness.noRegisteredCreatorSourceIsObservedPublicWeb") : registered == null ? message("operatorBusiness.theCatalogCountIsUnknownRegistrationPayoutEligibility") : message("operatorBusiness.registrationAloneDoesNotEstablishPayoutEligibilityPurchases")}</p>
          <Link href="/sources" className="mt-5 inline-flex min-h-11 items-center gap-2 font-mono text-xs text-seal underline underline-offset-4">{richMessage("operatorBusiness.visitTheSourceCatalogContent", { arrowIcon: <ArrowRight className="h-3 w-3" aria-hidden="true" /> })}</Link>
        </div>
      </section>

      <section aria-labelledby="workflow-heading">
        <SectionHeading number="03" title={message("operatorBusiness.howTheBusinessOperates")} id="workflow-heading" detail={message("operatorBusiness.oneOriginalOrderPreservedObligations")} />
        <ol className="mt-5 grid border border-line bg-paper md:grid-cols-5">
          {WORKFLOW.map((step, index) => <li key={step.title} className="min-w-0 border-b border-line p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"><span className="flex h-8 w-8 items-center justify-center border border-line font-mono text-[11px] text-seal">{String(index + 1).padStart(2, "0")}</span><h3 className="mt-4 font-display text-xl leading-tight">{step.title}</h3><p className="mt-3 font-serif text-sm leading-relaxed text-ink-3">{step.text}</p></li>)}
        </ol>
      </section>

      <section aria-labelledby="boundaries-heading" className="border-t border-ink pt-7">
        <h2 id="boundaries-heading" className="font-display text-2xl">{message("operatorBusiness.whatThisObservationEstablishes")}</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-paid" aria-hidden="true" /><p className="font-serif text-sm leading-relaxed text-ink-2">{message("operatorBusiness.thisViewReportsTheWorkerSObservedDecisions")}</p></div>
          <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-seal" aria-hidden="true" /><p className="font-serif text-sm leading-relaxed text-ink-2">{message("operatorBusiness.aGeneralOnChainBusinessBudgetWalletAnd")}</p></div>
        </div>
        <p className="mt-5 font-mono text-[10px] leading-relaxed text-ink-3">{message("operatorBusiness.localOperatorDesktopAndCLIWorkspacesRetainTheir")}</p>
      </section>
    </div>
  );
}

function SectionHeading({ number, title, id, detail }: { number: string; title: string; id: string; detail: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 id={id} className="font-display text-2xl sm:text-3xl"><span className="mr-3 align-middle font-mono text-[11px] text-seal">{number}</span>{title}</h2><p className="font-mono text-[10px] text-ink-3">{detail}</p></div>;
}

function Metric({ label, value, detail, Icon, alert = false }: {
  label: string; value: string; detail: string; Icon: typeof Radio; alert?: boolean;
}) {
  return <div className="min-w-0 border-b border-line p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><dt className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}<Icon className="h-4 w-4 shrink-0" aria-hidden="true" /></dt><dd className="mt-3"><span className={cn("font-display text-4xl tabular-nums", alert && "text-seal", value === "Unknown" && "text-2xl text-ink-3")}>{value}</span><p className="mt-2 font-serif text-sm text-ink-3">{detail}</p></dd></div>;
}
