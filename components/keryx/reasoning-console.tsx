"use client";

/**
 * §I · The decision — the live reasoning ledger inside a banknote panel.
 * Auto-scrolls as trace steps stream in; shows a vermillion "deciding" pulse
 * while the agent is still choosing what to buy.
 */

import { useEffect, useRef } from "react";
import type { TraceStep } from "@/lib/types";
import { TraceRow } from "./trace-row";
import { SectionHeading } from "./banknote";

interface ReasoningConsoleProps {
  steps: TraceStep[];
  streaming: boolean;
}

export function ReasoningConsole({ steps, streaming }: ReasoningConsoleProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length, streaming]);

  const right = streaming ? (
    <span className="inline-flex items-center gap-2 text-seal">
      <ThinkingDots />
      deciding
    </span>
  ) : steps.length > 0 ? (
    `${steps.length} steps`
  ) : undefined;

  return (
    <div className="flex h-full flex-col">
      <SectionHeading numeral="I" label="The decision" right={right} />
      <div className="flex flex-1 flex-col overflow-hidden border border-ink bg-paper">
        <div className="max-h-[60vh] min-h-[320px] flex-1 overflow-y-auto px-5 py-2 sm:max-h-[68vh]">
          <div className="relative">
            {steps.map((step, i) => (
              <TraceRow key={`${step.phase}-${step.ts}-${i}`} step={step} />
            ))}
            {streaming && steps.length === 0 && (
              <p className="py-8 text-center font-mono text-[12px] uppercase tracking-[0.1em] text-ink-3">
                Contacting the herald…
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-seal"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
