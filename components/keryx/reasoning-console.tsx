"use client";

/**
 * §I · The decision — the live reasoning ledger inside a banknote panel.
 * Auto-scrolls as trace steps stream in; shows a vermillion "deciding" pulse
 * while the agent is still choosing what to buy, plus a live budget meter that
 * fills as tolls/rewards settle so the hard spend cap is visible, not implied.
 */

import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceStep } from "@/lib/types";
import { TraceRow } from "./trace-row";
import { SectionHeading } from "./banknote";
import { BudgetMeter, stepPaymentTotals } from "./budget-meter";
import { fmtUsdc } from "./phase-style";

interface ReasoningConsoleProps {
  steps: TraceStep[];
  streaming: boolean;
  /** Authorized budget for the current run (USDC). 0 = no run yet. */
  budget: number;
}

export function ReasoningConsole({ steps, streaming, budget }: ReasoningConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);

  const onScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 32;
    followingRef.current = atBottom;
    setFollowing(atBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    followingRef.current = true;
    setFollowing(true);
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    if (followingRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps.length, streaming]);

  const paymentTotals = stepPaymentTotals(steps);
  const spent = paymentTotals.settled;

  // Once a run is active the heading shows the live spend / cap; before that it
  // falls back to the deciding pulse or step count.
  const right =
    budget > 0 ? (
      <span className="inline-flex items-center gap-2">
        {streaming && <ThinkingDots />}
        <span className="tabular-nums tracking-normal">
          <span className="text-paid">{message("decisionLog.settledAmount", { amount: fmtUsdc(spent) })}</span>
          <span className="text-ink-3"> / ${fmtUsdc(budget)}</span>
        </span>
      </span>
    ) : streaming ? (
      <span className="inline-flex items-center gap-2 text-seal">
        <ThinkingDots />
        {message("decisionLog.deciding")}
      </span>
    ) : steps.length > 0 ? (
      message(steps.length === 1 ? "decisionLog.steps.one" : "decisionLog.steps.other", { count: steps.length })
    ) : undefined;

  return (
    <div className="flex h-full flex-col">
      <SectionHeading numeral="I" label={message("decisionLog.title")} right={right} />
      <BudgetMeter spent={spent} budget={budget} streaming={streaming} pending={paymentTotals.pending + paymentTotals.unverified} />
      {(paymentTotals.pending > 0 || paymentTotals.simulated > 0 || paymentTotals.unverified > 0) && (
        <p className="mb-3 font-mono text-xs text-ink-2">
          {paymentTotals.pending > 0 && message("decisionLog.pendingAmount", { amount: fmtUsdc(paymentTotals.pending) })}
          {paymentTotals.pending > 0 && (paymentTotals.simulated > 0 || paymentTotals.unverified > 0) && " · "}
          {paymentTotals.simulated > 0 && message("decisionLog.simulatedAmount", { amount: fmtUsdc(paymentTotals.simulated) })}
          {paymentTotals.simulated > 0 && paymentTotals.unverified > 0 && " · "}
          {paymentTotals.unverified > 0 && message("decisionLog.unverifiedAmount", { amount: fmtUsdc(paymentTotals.unverified) })}
        </p>
      )}
      <div className="flex flex-1 flex-col overflow-hidden border border-ink bg-paper">
        <div ref={scrollRef} onScroll={onScroll} aria-label={message("decisionLog.label")} className="max-h-[60vh] min-h-[320px] flex-1 overflow-y-auto overscroll-contain px-5 py-2 sm:max-h-[68vh]">
          <div className="relative">
            {steps.map((step, i) => (
              <TraceRow key={`${step.phase}-${step.ts}-${i}`} step={step} />
            ))}
            {streaming && steps.length === 0 && (
              <p className="py-8 text-center font-mono text-[12px] uppercase tracking-[0.1em] text-ink-3">
                {message("decisionLog.connecting")}
              </p>
            )}
          </div>
        </div>
      </div>
      {!following && (
        <button type="button" onClick={jumpToLatest} className="self-end border border-ink bg-paper px-3 py-1.5 font-mono text-xs text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-seal">
          {message("decisionLog.jumpToLatest")}
        </button>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-seal motion-safe:animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
