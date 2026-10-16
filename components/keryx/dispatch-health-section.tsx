"use client";
import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";

import { DisplayTime } from "@/components/keryx/display-time";


import { createMessages } from "@/lib/i18n/messages";

import { useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";



const message = createMessages("en");


/**
 * /status section for what the agent has actually been doing lately: how many dispatches completed in
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
  activity?: "idle" | "active" | "expected-missing";
  expectDispatches?: boolean;
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

function ago(iso: string) {
  return <DisplayTime value={iso} relative />;
}

export function DispatchHealthSection({ dispatches: d }: { dispatches: DispatchHealth }) {
  const message = useUiMessages();
  const richMessage = useUiRichMessages();
  const unreasoned = d.heuristic > 0;
  // Partial fallbacks still produced a real answer, so they read as a caveat, not a failure.
  const reasonedLabel =
    d.runs === 0
      ? "—"
      : `${d.modelReasoned}/${d.runs}` + (d.partlyHeuristic > 0 ? message(selectPlural(d.partlyHeuristic) === "one" ? "statusDispatch.partial.one" : "statusDispatch.partial.other", { count: d.partlyHeuristic }) : "");

  return (
    <>
      <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{richMessage("statusDispatch.agentOutputLastWindowHoursH", { windowHours: d.windowHours })}</div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
        <Row k={message("statusDispatch.dispatchesCompleted")} v={String(d.runs)} alert={d.alarms.some(a => a.code === "silent")} />
        <Row k={message("statusDispatch.modelReasoned")} v={reasonedLabel} alert={unreasoned} />
        <Row
          k={message("statusDispatch.dispatchesThatPaid")}
          v={d.runs === 0 ? "—" : `${d.paying}/${d.runs}`}
          alert={d.alarms.some(a => a.code === "nothing-bought" || a.code === "payment-unsettled")}
        />
        <Row k={message("statusDispatch.toCreators")} v={formatRecordedUsdc(d.creatorPayoutUsdc, { minimumFractionDigits: 4 })} />
        <Row
          k={message("statusDispatch.crossProviderSaves")}
          v={d.reasoningAttemptSamples ? String(d.providerFailoverSteps ?? 0) : message("statusDispatch.collecting")}
        />
        <Row
          k={message("statusDispatch.providerFailures")}
          v={
            d.reasoningAttemptSamples
              ? `${d.providerFailures ?? 0}${
                  d.circuitOpenSkips ? message(selectPlural(d.circuitOpenSkips) === "one" ? "statusDispatch.circuitSkips.one" : "statusDispatch.circuitSkips.other", { count: d.circuitOpenSkips }) : ""
                }`
              : message("statusDispatch.collecting")
          }
        />
        <Row k={message("statusDispatch.lastDispatch")} v={d.lastDispatchAt ? ago(d.lastDispatchAt) : "—"} />
        <Row k={message("statusDispatch.checked")} v={ago(d.checkedAt)} />
      </dl>
      {d.activity === "idle" && (
        <p className="mt-3 font-mono text-[11px] text-ink-3">{message("statusDispatch.idleNoCompletedCallerRequestsInThisWindow")}</p>
      )}
      {(d.servedBy?.length ?? 0) > 0 && (
        <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">{richMessage("statusDispatch.servedStepsGapValue", { gap: " ", servedSteps: d.servedBy!.map((item) => `${item.engine.replace(/^llm:/, "")} ${item.steps}`).join(" · ") })}</p>
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
      <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">{message("statusDispatch.recordedInspectionOfTheAgentSOwnDispatches")}</p>
    </>
  );
}

function Row({ k, v, alert = false }: { k: string; v: React.ReactNode; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`tabular-nums ${alert ? "text-destructive" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
