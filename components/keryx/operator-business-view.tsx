"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CirclePause, FileCheck2, Layers3, Radio, ShieldCheck } from "lucide-react";
import {
  OPERATOR_REASON_TEXT,
  operatorBusinessStatusSchema,
  type OperatorBusinessStatus,
} from "@/lib/business-operator/contracts";
import { cn } from "@/lib/utils";

const STATE = {
  disabled: { label: "Disabled", text: "The Operator worker is disabled. This view does not start research.", tone: "text-ink-3", Icon: CirclePause },
  idle: { label: "Active · idle", text: "The worker is observing prepaid orders and waiting within its existing policy.", tone: "text-paid", Icon: Radio },
  working: { label: "Active · working", text: "The last observation shows accepted research in progress.", tone: "text-paid", Icon: Radio },
  held: { label: "Held", text: "New work is held at an operating boundary. Existing obligations remain.", tone: "text-seal", Icon: CirclePause },
  review: { label: "Review required", text: "An original obligation needs human review before the worker proceeds.", tone: "text-seal", Icon: ShieldCheck },
  stale: { label: "Observation stale", text: "The worker observation is out of date. Current activity is unknown.", tone: "text-seal", Icon: CirclePause },
  unavailable: { label: "Unknown", text: "A current worker observation is unavailable. Activity cannot be confirmed.", tone: "text-ink-3", Icon: CirclePause },
} as const;

const WORKFLOW = [
  { title: "Receive prepaid research", text: "A customer chooses a priced package. Verified payment is bound to the original research order." },
  { title: "Assess obligations & capacity", text: "The Operator checks unfinished obligations and available capacity against the existing policy before taking work." },
  { title: "Buy & read under budget", text: "The reading agent discovers sources, explains BUY / SKIP / CACHE decisions, and stays inside the purchased creator cap." },
  { title: "Deliver reviewed research", text: "Evidence checks determine which claims, citations and limitations can appear in the saved result." },
  { title: "Reconcile or escalate", text: "Receipts preserve payment state. Uncertain original jobs are held for review rather than purchased again." },
];

function timestamp(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function count(value: number | null | undefined): string {
  return value == null ? "Unknown" : value.toLocaleString();
}

function elapsed(seconds: number | null | undefined): string {
  if (seconds == null) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds % 3_600 / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds % 86_400 / 3_600)}h`;
}

function networkLabel(network?: string): string {
  if (network === "eip155:5042") return "Arc mainnet";
  if (network === "eip155:5042002") return "Arc testnet";
  return "Network unknown";
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
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">Keryx Operator · business operations</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.05] sm:text-6xl">A research business,<br className="hidden sm:block" /> with its decisions in view.</h1>
          <p className="mt-5 max-w-2xl font-serif text-lg leading-relaxed text-ink-2">Follow the service from a prepaid question to evidence, delivery and reconciliation. The Operator handles existing paid orders inside their agreed limits.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/research#paid-research" className="inline-flex min-h-11 items-center gap-3 border border-ink bg-ink px-5 py-3 font-mono text-xs text-paper transition-colors hover:bg-ink-2">Request research <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link href="/sources" className="inline-flex min-h-11 items-center gap-3 border border-line bg-paper px-5 py-3 font-mono text-xs transition-colors hover:border-ink">Explore creator sources <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
        </div>
        <div className="border border-ink bg-paper p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-3">Operating boundary</p>
          <div className="mt-4 flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-paid" aria-hidden="true" /><p className="font-serif text-base leading-relaxed">Prepaid orders. Original budgets. Human review when evidence or authority is uncertain.</p></div>
          <p className="mt-4 border-t border-line pt-3 font-mono text-[10px] leading-relaxed text-ink-3">A worker observation is not proof of settlement or business acceptance.</p>
        </div>
      </header>

      <section aria-labelledby="operator-state-heading" className="grid border border-ink bg-paper md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="p-6 sm:p-8" aria-live="polite">
          <div className="flex items-center justify-between gap-3"><h2 id="operator-state-heading" className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-3">Current observation</h2><span className="font-mono text-[10px] text-ink-3">{networkLabel(status?.network)}</span></div>
          <div className={cn("mt-6 flex items-center gap-3", appearance.tone)}><Icon className="h-6 w-6 shrink-0" aria-hidden="true" /><p className="font-display text-3xl sm:text-4xl">{loading ? "Reading status…" : appearance.label}</p></div>
          <p className="mt-4 max-w-lg font-serif text-base leading-relaxed text-ink-2">{loading ? "Checking the public operating snapshot. Counts remain unknown until the service responds." : appearance.text}</p>
          {readState === "unavailable" && <p role="status" className="mt-3 font-mono text-xs leading-relaxed text-seal">The status service could not be read. Previous counts are hidden until a fresh response arrives.</p>}
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-ink-3">Observed {timestamp(status?.operator.observedAt)} · this view refreshes about every 30 seconds</p>
        </div>
        <div className="border-t border-line bg-panel p-6 sm:p-8 md:border-l md:border-t-0">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-3">Last observed decision</h2>
          <p className="mt-5 font-display text-2xl">{decision ? ({ idle: "Wait for an order", "run-next": "Proceed within policy", hold: "Hold new work", review: "Escalate for review" }[decision.action]) : "No decision available"}</p>
          <p className="mt-3 font-serif text-base leading-relaxed text-ink-2">{decision ? OPERATOR_REASON_TEXT[decision.reason] : "A decision is shown only after it has been observed by the service."}</p>
          <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div><dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Decision observed</dt><dd className="mt-1 font-mono text-[11px]">{timestamp(decision?.observedAt)}</dd></div>
            <div><dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Audit record</dt><dd className="mt-1 font-mono text-[11px]">{status ? status.operator.auditRecorded ? "Recorded" : "Not recorded" : "Unknown"}</dd></div>
          </dl>
          {status && !status.operator.auditRecorded && <p className="mt-3 font-mono text-[10px] leading-relaxed text-seal">The public observation does not confirm a durable audit entry.</p>}
        </div>
      </section>

      <section aria-labelledby="order-queue-heading">
        <SectionHeading number="01" title="Accepted research queue" id="order-queue-heading" detail="Selected network · current order records" />
        <dl className="mt-5 grid grid-cols-1 border border-line bg-paper sm:grid-cols-3">
          <Metric label="Queued" value={count(jobs?.queued)} detail="Prepaid orders awaiting execution" Icon={Layers3} />
          <Metric label="Processing" value={count(jobs?.processing)} detail="Original jobs already started" Icon={Radio} />
          <Metric label="Needs review" value={count(jobs?.reviewRequired)} detail="Original jobs requiring reconciliation" Icon={ShieldCheck} alert={!!jobs?.reviewRequired} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10px] text-ink-3"><span>Oldest queued: {elapsed(jobs?.oldestQueuedAgeSeconds)}</span><span>Oldest processing: {elapsed(jobs?.oldestProcessingAgeSeconds)}</span>{jobs?.degraded && <span className="text-seal">Queue observation degraded · waiting or review needs attention</span>}</div>
        {!jobs && <p className="mt-3 font-serif text-sm text-ink-3">The queue is unknown. Missing records are not counted as zero.</p>}
      </section>

      <section aria-labelledby="delivery-heading" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
        <div>
          <SectionHeading number="02" title="Recorded delivery outcomes" id="delivery-heading" detail="Terminal orders · last 24 hours" />
          <dl className="mt-5 grid border border-line bg-paper sm:grid-cols-2">
            <Metric label="Completed" value={count(jobs?.completedLast24h)} detail="Orders with a saved completed result" Icon={FileCheck2} />
            <Metric label="Failed" value={count(jobs?.failedLast24h)} detail="Orders recorded as failed" Icon={CirclePause} />
          </dl>
          <p className="mt-3 font-serif text-sm leading-relaxed text-ink-3">{terminal === 0 ? "No terminal order outcomes are recorded in this window. That does not establish demand or a success rate." : "Order completion describes delivery state. It does not prove a useful answer, settled creator payments or independent customer demand."}</p>
        </div>
        <div className="border border-line bg-panel p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-3">Creator catalog</p>
          <p className="mt-4 font-display text-5xl tabular-nums">{count(registered)}</p>
          <p className="mt-2 font-serif text-sm text-ink-2">Registered sources in the selected catalog</p>
          <p className="mt-4 font-serif text-sm leading-relaxed text-ink-3">{registered === 0 ? "No registered creator source is observed. Public-web research can continue; creator access and reward opportunities depend on eligible sources." : registered == null ? "The catalog count is unknown. Registration, payout eligibility and settled earnings are separate states." : "Registration alone does not establish payout eligibility, purchases or settled creator earnings."}</p>
          <Link href="/sources" className="mt-5 inline-flex min-h-11 items-center gap-2 font-mono text-xs text-seal underline underline-offset-4">Visit the source catalog <ArrowRight className="h-3 w-3" aria-hidden="true" /></Link>
        </div>
      </section>

      <section aria-labelledby="workflow-heading">
        <SectionHeading number="03" title="How the business operates" id="workflow-heading" detail="One original order · preserved obligations" />
        <ol className="mt-5 grid border border-line bg-paper md:grid-cols-5">
          {WORKFLOW.map((step, index) => <li key={step.title} className="min-w-0 border-b border-line p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"><span className="flex h-8 w-8 items-center justify-center border border-line font-mono text-[11px] text-seal">{String(index + 1).padStart(2, "0")}</span><h3 className="mt-4 font-display text-xl leading-tight">{step.title}</h3><p className="mt-3 font-serif text-sm leading-relaxed text-ink-3">{step.text}</p></li>)}
        </ol>
      </section>

      <section aria-labelledby="boundaries-heading" className="border-t border-ink pt-7">
        <h2 id="boundaries-heading" className="font-display text-2xl">What this observation establishes</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-paid" aria-hidden="true" /><p className="font-serif text-sm leading-relaxed text-ink-2">This view reports the worker&apos;s observed decisions and aggregate order states. Private questions, receipts and account details remain with their original owners.</p></div>
          <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-seal" aria-hidden="true" /><p className="font-serif text-sm leading-relaxed text-ink-2">A general on-chain business budget wallet and a complete live business acceptance cycle remain separate gates. This page does not certify either.</p></div>
        </div>
        <p className="mt-5 font-mono text-[10px] leading-relaxed text-ink-3">Local Operator desktop and CLI workspaces retain their existing deliberate purchase and recovery flow. Hosted prepaid orders run on the service worker; this status page grants no execution authority.</p>
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
