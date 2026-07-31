"use client";

/**
 * /status section for what the agent has actually been doing lately: how many dispatches settled in
 * the last window, how many of them were genuinely model-reasoned, and how much reached creators.
 *
 * It exists because "reasoning: deepseek" one row above is a configuration reading, not evidence —
 * it stayed green through a full outage in which every run answered from the deterministic fallback.
 * These figures come from the runs themselves (scripts/check-dispatches.mts, hourly), so a degraded
 * stretch is visible here to anyone, not just to whoever reads the cron log.
 */

/** Mirrors the `dispatches` object /api/health returns (lib/ops/dispatch-health.ts). */
export interface DispatchHealth {
  checkedAt: string;
  windowHours: number;
  runs: number;
  modelReasoned: number;
  partlyHeuristic: number;
  heuristic: number;
  zeroDecision: number;
  paying: number;
  creatorPayoutUsdc: number;
  reasoningAttemptSamples?: number;
  providerFailures?: number;
  circuitOpenSkips?: number;
  providerFailoverSteps?: number;
  servedBy?: Array<{ engine: string; steps: number }>;
  lastDispatchAt: string | null;
  alarms: { code: string; message: string }[];
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function DispatchHealthSection({ dispatches: d }: { dispatches: DispatchHealth }) {
  const unreasoned = d.heuristic > 0;
  // Partial fallbacks still produced a real answer, so they read as a caveat, not a failure.
  const reasonedLabel =
    d.runs === 0
      ? "—"
      : `${d.modelReasoned}/${d.runs}` + (d.partlyHeuristic > 0 ? ` · ${d.partlyHeuristic} partial` : "");

  return (
    <>
      <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
        Agent output — last {d.windowHours}h
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
        <Row k="Dispatches settled" v={String(d.runs)} alert={d.runs === 0} />
        <Row k="Model-reasoned" v={reasonedLabel} alert={unreasoned} />
        <Row
          k="Dispatches that paid"
          v={d.runs === 0 ? "—" : `${d.paying}/${d.runs}`}
          alert={d.runs > 0 && d.paying === 0}
        />
        <Row k="To creators" v={`$${d.creatorPayoutUsdc.toFixed(4)}`} />
        <Row
          k="Cross-provider saves"
          v={d.reasoningAttemptSamples ? String(d.providerFailoverSteps ?? 0) : "collecting"}
        />
        <Row
          k="Provider failures"
          v={
            d.reasoningAttemptSamples
              ? `${d.providerFailures ?? 0}${
                  d.circuitOpenSkips ? ` · ${d.circuitOpenSkips} circuit skips` : ""
                }`
              : "collecting"
          }
        />
        <Row k="Last dispatch" v={d.lastDispatchAt ? ago(d.lastDispatchAt) : "—"} />
        <Row k="Checked" v={ago(d.checkedAt)} />
      </dl>
      {(d.servedBy?.length ?? 0) > 0 && (
        <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">
          Served steps:{" "}
          {d.servedBy!.map((item) => `${item.engine.replace(/^llm:/, "")} ${item.steps}`).join(" · ")}
        </p>
      )}
      {d.alarms.length > 0 && (
        <ul className="mt-4 space-y-1.5 font-mono text-[11px] text-destructive">
          {d.alarms.map((a) => (
            <li key={a.code}>
              <span className="uppercase tracking-[0.12em]">{a.code}</span> — {a.message}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">
        Hourly read of the agent&apos;s own dispatches. A failed provider crosses to another
        configured model before the deterministic heuristic; every attempt and circuit skip is
        carried on the run receipt.
      </p>
    </>
  );
}

function Row({ k, v, alert = false }: { k: string; v: string; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`tabular-nums ${alert ? "text-destructive" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
