"use client";

/**
 * The ask form: question textarea + USDC budget control + example chips.
 */

import { useState } from "react";
import { ArrowUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtUsdc } from "./phase-style";

const EXAMPLES = [
  "How do x402 and stablecoins enable autonomous AI agent commerce?",
  "How do nanopayments split a citation reward across multiple authors?",
  "What makes an agent's spending decisions rational under a budget?",
  "Why settle a weighted payment to every source an answer cites?",
];

interface AskFormProps {
  disabled?: boolean;
  onAsk: (question: string, budget: number) => void;
}

export function AskForm({ disabled, onAsk }: AskFormProps) {
  const [question, setQuestion] = useState("");
  const [budget, setBudget] = useState(0.05);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled) return;
    onAsk(q, budget);
  };

  return (
    <Card className="overflow-hidden p-0 shadow-lg shadow-amber-500/[0.04] ring-1 ring-amber-500/[0.06]">
      <div className="p-4 sm:p-5">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder="Ask anything. The agent decides which paid sources are worth buying…"
          rows={3}
          className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/30 px-4 py-3 sm:px-5">
        <BudgetControl value={budget} onChange={setBudget} />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            ⌘↵ to send
          </span>
          <Button
            onClick={submit}
            disabled={disabled || question.trim().length === 0}
            className="gap-1.5 bg-amber-500 text-amber-950 shadow hover:bg-amber-400"
          >
            Ask Keryx
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled}
            onClick={() => setQuestion(ex)}
            className={cn(
              "rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors",
              "hover:border-amber-500/40 hover:bg-amber-500/5 hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {ex}
          </button>
        ))}
      </div>
    </Card>
  );
}

function BudgetControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" />
        Budget
      </span>
      <input
        type="range"
        min={0.01}
        max={0.2}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-border accent-amber-500 sm:w-36"
        aria-label="Budget in USDC"
      />
      <span className="min-w-[64px] rounded-md border border-border bg-background px-2 py-1 text-center font-mono text-xs font-semibold tabular-nums">
        ${fmtUsdc(value)}
      </span>
    </div>
  );
}
