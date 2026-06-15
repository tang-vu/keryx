"use client";

/**
 * The live reasoning console — the hero of the demo. Auto-scrolls as trace
 * steps stream in and shows an "agent is thinking…" indicator while active.
 */

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { TraceStep } from "@/lib/types";
import { TraceRow } from "./trace-row";
import { Card } from "@/components/ui/card";

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
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold tracking-tight">
            Agent reasoning
          </span>
        </div>
        {streaming && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <ThinkingDots />
            thinking
          </span>
        )}
      </div>

      <div className="max-h-[60vh] min-h-[320px] flex-1 overflow-y-auto px-4 py-2 sm:max-h-[68vh]">
        <div className="relative">
          {steps.map((step, i) => (
            <TraceRow key={`${step.phase}-${step.ts}-${i}`} step={step} />
          ))}
          {streaming && steps.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Contacting the agent…
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </Card>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
