"use client";

/**
 * Onboarding tour — a 4-step guided walkthrough for first-time visitors (judges).
 * Uses localStorage ("keryx-tour-seen") to show once. Finds target elements
 * via data-tour attributes and positions tooltips with getBoundingClientRect.
 * No external libraries — pure DOM + CSS.
 */

import { useState, useEffect, useCallback, useRef } from "react";

const TOUR_KEY = "keryx-tour-seen";

interface TourStep {
  target: string; // data-tour attribute value
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    target: "hero",
    title: "Welcome to Keryx",
    body: "Keryx is a reading agent with a purse. It buys sources, answers with citations, and pays every author it quotes — in the same breath.",
  },
  {
    target: "ask-form",
    title: "Ask a question",
    body: "Type any question and set a budget. The agent decides which sources are worth reading, reads them, and synthesises a grounded answer.",
  },
  {
    target: "budget",
    title: "Set a budget",
    body: "Slide to set how much the agent can spend. Lower = frugal (fewer sources). Higher = thorough (more sources, higher quality). The agent never overspends.",
  },
  {
    target: "dispatch-btn",
    title: "Dispatch the agent",
    body: "Hit Dispatch and watch the agent reason live: which sources to buy, which to skip, when to stop. Every cited source pays its creator in real USDC.",
  },
];

export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);

  // Check localStorage on mount — show tour only for first-time visitors
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(TOUR_KEY)) return;
    // Small delay so the page renders first
    const t = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(t);
  }, []);

  // Position tooltip near the target element
  useEffect(() => {
    if (!visible) return;
    const update = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step]?.target}"]`);
      if (el) {
        setRect(el.getBoundingClientRect());
      }
    };
    update();
    // Re-position on scroll/resize
    const onEvent = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onEvent, true);
    window.addEventListener("resize", onEvent);
    return () => {
      window.removeEventListener("scroll", onEvent, true);
      window.removeEventListener("resize", onEvent);
      cancelAnimationFrame(rafRef.current);
    };
  }, [visible, step]);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(TOUR_KEY, "1");
    }
  }, []);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }, [step, dismiss]);

  const prev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  if (!visible || !rect) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Tooltip position: below the target by default, above if not enough space
  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove = spaceBelow < 200;
  const top = showAbove ? rect.top - 8 : rect.bottom + 8;
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - 360));

  return (
    <>
      {/* Backdrop with spotlight cutout */}
      <div
        className="pointer-events-auto fixed inset-0 z-[9998] bg-ink/60 transition-opacity"
        style={{
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%,
            0% ${rect.top}px,
            ${rect.left}px ${rect.top}px,
            ${rect.left}px ${rect.bottom}px,
            ${rect.right}px ${rect.bottom}px,
            ${rect.right}px ${rect.top}px,
            0% ${rect.top}px
          )`,
        }}
        onClick={dismiss}
      />

      {/* Target highlight ring */}
      <div
        className="pointer-events-none fixed z-[9999] rounded-sm border-2 border-seal shadow-[0_0_0_9999px_transparent]"
        style={{
          top: rect.top - 2,
          left: rect.left - 2,
          width: rect.width + 4,
          height: rect.height + 4,
        }}
      />

      {/* Tooltip */}
      <div
        className="fixed z-[10000] w-[max(280px,min(340px,80vw))] border border-ink bg-paper shadow-lg"
        style={{
          top,
          left,
          transform: showAbove ? "translateY(-100%)" : undefined,
        }}
      >
        <div className="border-b border-line bg-paper-2 px-4 py-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
              Step {step + 1} of {STEPS.length}
            </span>
            <button
              type="button"
              onClick={dismiss}
              className="font-mono text-[11px] text-ink-3 transition-colors hover:text-ink"
            >
              Skip ✕
            </button>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="font-display text-[15px] font-semibold text-ink">
            {s.title}
          </p>
          <p className="mt-1.5 font-serif text-[13px] leading-[1.5] text-ink-2">
            {s.body}
          </p>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2">
          <button
            type="button"
            onClick={prev}
            disabled={step === 0}
            className="font-mono text-[11px] text-ink-3 transition-colors hover:text-ink disabled:opacity-30"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={next}
            className="border border-ink bg-ink px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-paper transition-colors hover:bg-seal hover:border-seal"
          >
            {isLast ? "Got it ✓" : "Next →"}
          </button>
        </div>
      </div>
    </>
  );
}
