"use client";

/**
 * "Ask a follow-up" on an archived dispatch — a counterfoil torn from the dispatch above it.
 *
 * Deliberately a link, not a second streaming console: it hands off to the main ask flow with
 * `?q=…&parent=…&run=1`, so a follow-up inherits the browser co-sign session, the budget dial and
 * the live trace instead of a thinner copy of them. A follow-up is a full paid dispatch — it buys
 * sources and pays creators again; only the question's context comes from the parent.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_Q = 500;

export function FollowUpForm({ parentId }: { parentId: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");

  const submit = () => {
    const q = question.trim().slice(0, MAX_Q);
    if (!q) return;
    router.push(`/?q=${encodeURIComponent(q)}&parent=${parentId}&run=1`);
  };

  return (
    <div className="mt-8 border-2 border-ink bg-paper p-[5px]">
      <div className="border border-ink">
        <div className="flex items-center justify-between gap-4 border-b border-ink bg-ink px-5 py-3 text-cream">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
            Ask a follow-up
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream/70">
            New dispatch · creators paid again
          </span>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <label htmlFor="follow-up" className="sr-only">
            Your follow-up question
          </label>
          <textarea
            id="follow-up"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            maxLength={MAX_Q}
            rows={2}
            placeholder="How does that compare to…?"
            className="w-full resize-none border-b border-line bg-transparent pb-2 font-serif text-[clamp(15px,1.4vw,18px)] leading-[1.5] text-ink outline-none placeholder:text-ink-3/60 focus:border-ink"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[46ch] font-mono text-[10px] leading-[1.5] text-ink-3">
              Carries this dispatch&rsquo;s question as context — never its answer. The next
              dispatch is read from sources bought for it.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!question.trim()}
              className="border border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream transition-opacity disabled:opacity-40"
            >
              Dispatch follow-up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
