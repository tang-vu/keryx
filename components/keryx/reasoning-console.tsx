"use client";

/**
 * §I · The decision — the live reasoning ledger. Auto-scrolls as trace steps
 * stream in and shows a "surveying…" pulse while the agent is still deciding.
 */

import { useEffect, useRef } from "react";
import type { TraceStep } from "@/lib/types";
import { TraceRow } from "./trace-row";

interface ReasoningConsoleProps {
  steps: TraceStep[];
  streaming: boolean;
}

export function ReasoningConsole({ steps, streaming }: ReasoningConsoleProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length, streaming]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line-2 px-5 py-3.5">
        <div className="flex items-baseline gap-2.5 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">
          <span className="text-seal">01</span>
          <span>The decision</span>
        </div>
        {streaming ? (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-seal">
            <ThinkingDots />
            deciding
          </span>
        ) : (
          steps.length > 0 && (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {steps.length} steps
            </span>
          )
        )}
      </div>

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
