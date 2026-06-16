"use client";

/**
 * The dispatch order: a serif question line + a USDC budget dial + example
 * prompts. Styled as a banknote-card — ivory paper, vermillion seal accents.
 */

import { useState } from "react";

interface AskFormProps {
  disabled?: boolean;
  onAsk: (question: string, budget: number) => void;
}

const SUGGESTIONS = [
  {
    label: "How do x402 + stablecoins enable agent commerce?",
    q: "How do x402 and stablecoins enable autonomous AI agent commerce?",
  },
  {
    label: "How do nanopayments split a reward?",
    q: "How do nanopayments split a citation reward across multiple authors?",
  },
  {
    label: "What makes agent spending rational?",
    q: "What makes an agent's spending decisions rational under a budget?",
  },
];

export function AskForm({ disabled, onAsk }: AskFormProps) {
  const [question, setQuestion] = useState("");
  const [budget, setBudget] = useState(0.05);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled) return;
    onAsk(q, budget);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card shadow-[0_1px_0_rgba(33,30,24,0.04),0_18px_40px_-28px_rgba(33,30,24,0.4)]">
      <div className="flex items-center justify-between gap-3 border-b border-line-2 px-5 py-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
          Ask Keryx
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
            Budget
          </span>
          <input
            type="range"
            min={0.01}
            max={0.08}
            step={0.005}
            value={budget}
            disabled={disabled}
            onChange={(e) => setBudget(parseFloat(e.target.value))}
            className="w-28 cursor-pointer sm:w-32"
            aria-label="Budget in USDC"
          />
          <span className="min-w-[58px] text-right font-mono text-[15px] tabular-nums text-seal">
            ${budget.toFixed(3)}
          </span>
        </div>
      </div>

      <div className="p-5">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder="Ask anything worth paying to read…"
          rows={2}
          disabled={disabled}
          className="w-full resize-none border-0 bg-transparent font-serif text-[21px] leading-snug text-ink outline-none placeholder:text-ink-3"
        />

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={disabled}
                onClick={() => setQuestion(s.q)}
                className="rounded-full border border-line bg-paper-2 px-3 py-1.5 text-left font-mono text-[11px] text-ink-2 transition-colors hover:border-seal/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-none items-center gap-3.5">
            <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">
              ⌘↵ to send
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={disabled || question.trim().length === 0}
              className="rounded-md bg-seal px-5 py-2.5 text-sm font-semibold text-cream shadow-[0_8px_18px_-10px_rgba(197,64,42,0.7)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ask Keryx →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
