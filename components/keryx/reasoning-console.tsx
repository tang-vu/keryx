"use client";

/**
 * §I · The decision — the live reasoning ledger inside a banknote panel.
 * Auto-scrolls as trace steps stream in; shows a vermillion "deciding" pulse
 * while the agent is still choosing what to buy, plus a live budget meter that
 * fills as tolls/rewards settle so the hard spend cap is visible, not implied.
 */





import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { TraceStep } from "@/lib/types";
import { TraceRow } from "./trace-row";
import { SectionHeading } from "./banknote";
import { BudgetMeter, stepPaymentTotals } from "./budget-meter";
import { fmtUsdc } from "./phase-style";
import { UiMessage, useUiMessages } from "@/lib/i18n/ui-copy";



interface ReasoningConsoleProps {
  steps: TraceStep[];
  streaming: boolean;
  /** Authorized budget for the current run (USDC). 0 = no run yet. */
  budget: number;
}

export function ReasoningConsole({ steps, streaming, budget }: ReasoningConsoleProps) {
  const message = useUiMessages();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [following, setFollowing] = useState(true);
  const [lastReadCount, setLastReadCount] = useState(steps.length);
  const descriptionId = useId();

  const onScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 32;
    const movedUp = container.scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = container.scrollTop;
    // A queued scroll event after a layout/append is not a reader leaving the tail.
    if (!atBottom && followingRef.current && !movedUp) return;
    if (atBottom || followingRef.current) setLastReadCount(steps.length);
    followingRef.current = atBottom;
    setFollowing(atBottom);
  }, [steps.length]);

  const jumpToLatest = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    followingRef.current = true;
    setFollowing(true);
    setLastReadCount(steps.length);
    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
    container.focus({ preventScroll: true });
  }, [steps.length]);

  useLayoutEffect(() => {
    if (followingRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastScrollTopRef.current = scrollRef.current.scrollTop;
    }
  }, [steps.length, streaming]);

  useEffect(() => {
    const container = scrollRef.current, content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) {
        container.scrollTop = container.scrollHeight;
        lastScrollTopRef.current = container.scrollTop;
      }
    });
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const paymentTotals = stepPaymentTotals(steps);
  const spent = paymentTotals.settled;
  const newSteps = following ? 0 : Math.max(0, steps.length - lastReadCount);

  // Once a run is active the heading shows the live spend / cap; before that it
  // falls back to the deciding pulse or step count.
  const right =
    budget > 0 ? (
      <span className="inline-flex max-w-full flex-wrap items-center gap-2">
        {streaming && <ThinkingDots />}
        <span className="tabular-nums tracking-normal">
          <span className="text-paid"><UiMessage messageKey="decisionLog.settledAmount" values={{ amount: fmtUsdc(spent) }} /></span>
          <span className="text-ink-3"> / ${fmtUsdc(budget)}</span>
        </span>
      </span>
    ) : streaming ? (
      <span className="inline-flex items-center gap-2 text-seal">
        <ThinkingDots />
        <UiMessage messageKey="decisionLog.deciding" />
      </span>
    ) : steps.length > 0 ? (
      <UiMessage messageKey={steps.length === 1 ? "decisionLog.steps.one" : "decisionLog.steps.other"} values={{ count: steps.length }} />
    ) : undefined;

  return (
    <div className="flex h-full min-w-0 flex-col [overflow-wrap:anywhere]">
      <SectionHeading numeral="I" label={message("decisionLog.title")} right={right} className="flex-wrap" />
      <BudgetMeter spent={spent} budget={budget} streaming={streaming} pending={paymentTotals.pending + paymentTotals.unverified} />
      {(paymentTotals.pending > 0 || paymentTotals.simulated > 0 || paymentTotals.unverified > 0) && (
        <p className="mb-3 font-mono text-xs text-ink-2">
          {paymentTotals.pending > 0 && <UiMessage messageKey="decisionLog.pendingAmount" values={{ amount: fmtUsdc(paymentTotals.pending) }} />}
          {paymentTotals.pending > 0 && (paymentTotals.simulated > 0 || paymentTotals.unverified > 0) && " · "}
          {paymentTotals.simulated > 0 && <UiMessage messageKey="decisionLog.simulatedAmount" values={{ amount: fmtUsdc(paymentTotals.simulated) }} />}
          {paymentTotals.simulated > 0 && paymentTotals.unverified > 0 && " · "}
          {paymentTotals.unverified > 0 && <UiMessage messageKey="decisionLog.unverifiedAmount" values={{ amount: fmtUsdc(paymentTotals.unverified) }} />}
        </p>
      )}
      <p id={`${descriptionId}-hint`} className="sr-only"><UiMessage messageKey="decisionLog.scrollHint" /></p>
      <div className="flex min-w-0 flex-1 flex-col border border-ink bg-paper">
        <div ref={scrollRef} onScroll={onScroll} role="region" tabIndex={0} aria-label={message("decisionLog.label")} aria-describedby={`${descriptionId}-hint ${descriptionId}-mode`} className="max-h-[60vh] min-h-[320px] min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 [overflow-anchor:none] [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-seal sm:max-h-[68vh] sm:px-5">
          <ol ref={contentRef} role="list" className="relative min-w-0 divide-y divide-line/60">
            {steps.map((step, i) => (
              <li key={`${step.phase}-${step.ts}-${i}`} className={streaming && following && i === steps.length - 1 ? "motion-safe:animate-[kxUp_260ms_cubic-bezier(.16,1,.3,1)_both]" : undefined}>
                <TraceRow step={step} />
              </li>
            ))}
          </ol>
          {streaming && steps.length === 0 && (
              <p className="py-8 text-center font-mono text-[12px] uppercase tracking-[0.1em] text-ink-3">
                <UiMessage messageKey="decisionLog.connecting" />
              </p>
            )}
        </div>
        <div className="flex min-h-[80px] min-w-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-paper-2 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1 basis-40">
            <p id={`${descriptionId}-mode`} className="flex items-start gap-2 font-mono text-[11px] leading-relaxed text-ink-2">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="mt-0.5 shrink-0 text-seal">
                {following ? <path d="M10 3v12m-4-4 4 4 4-4" /> : <path d="M7 4v12m6-12v12" />}
              </svg>
              <span><UiMessage messageKey={following ? "decisionLog.followingLatest" : "decisionLog.readingEarlier"} /></span>
            </p>
            <p role="status" aria-live="polite" aria-atomic="true" className="mt-1 font-mono text-[11px] leading-relaxed text-seal">
              {newSteps > 0 && <span key={newSteps} className="inline-block motion-safe:animate-[kxUp_180ms_ease-out_both]"><UiMessage messageKey={newSteps === 1 ? "decisionLog.newSteps.one" : "decisionLog.newSteps.other"} values={{ count: newSteps }} /></span>}
            </p>
          </div>
          {!following && <button type="button" onClick={jumpToLatest} className="inline-flex min-h-[44px] min-w-0 max-w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 font-mono text-xs text-paper transition-colors duration-180 hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal motion-reduce:transition-none">
            <UiMessage messageKey="decisionLog.jumpToLatest" /><span aria-hidden="true">↓</span>
          </button>}
        </div>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-0.5">
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
