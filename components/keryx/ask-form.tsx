"use client";

/**
 * The dispatch order — the ask, struck as a banknote draft: ink double-frame,
 * an engraved header band, an authorized-budget dial with a Bodoni vermillion
 * denomination, a Bodoni question line, and a tactile letterpress "Dispatch"
 * button. Wires straight into the live agent (onAsk).
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
    <div>
      <div className="border-2 border-ink bg-paper p-[5px]">
        <div className="border border-ink">
          {/* engraved header band */}
          <div className="flex items-center justify-between gap-4 border-b border-ink bg-ink px-5 py-3 text-cream">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
              Dispatch order № 0481
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream/70">
              Payable in USDC on Arc
            </span>
          </div>

          <div className="px-5 py-5 sm:px-6">
            {/* authorized budget */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
                Authorized budget
              </span>
              <div className="flex items-center gap-3.5">
                <input
                  type="range"
                  min={0.01}
                  max={0.08}
                  step={0.005}
                  value={budget}
                  disabled={disabled}
                  onChange={(e) => setBudget(parseFloat(e.target.value))}
                  className="w-36 sm:w-44"
                  aria-label="Authorized budget in USDC"
                />
                <span className="min-w-[92px] text-right font-display text-[30px] font-bold leading-none tracking-tight tabular-nums text-seal">
                  ${budget.toFixed(3)}
                </span>
              </div>
            </div>

            {/* to the herald — */}
            <div className="mb-2 mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              To the herald —
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              placeholder="Ask anything worth paying to read…"
              rows={2}
              disabled={disabled}
              className="w-full resize-none border-0 border-b border-ink bg-transparent pb-3 font-display text-[clamp(22px,2.6vw,30px)] font-medium leading-tight text-ink outline-none placeholder:font-normal placeholder:text-faint focus:border-seal"
            />

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <span className="flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                <span className="h-[7px] w-[7px] rounded-full bg-seal" />
                Drag the budget — watch the decisions change
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={disabled || question.trim().length === 0}
                className="kx-press border border-ink bg-ink px-7 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                Dispatch ▸
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* example dispatches */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={disabled}
            onClick={() => setQuestion(s.q)}
            className="border border-line bg-paper-2 px-3 py-1.5 text-left font-mono text-[11px] text-ink-2 transition-colors hover:border-seal/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
