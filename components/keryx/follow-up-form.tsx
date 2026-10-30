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
import { UiMessage, useUiMessages } from "@/lib/i18n/ui-copy";



const MAX_Q = 500;

export function FollowUpForm({ parentId }: { parentId: string }) {
  const message = useUiMessages();
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
            <UiMessage messageKey="followUp.title" />
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream/70">
            <UiMessage messageKey="followUp.paymentNotice" />
          </span>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <label htmlFor="follow-up" className="sr-only">
            <UiMessage messageKey="followUp.questionLabel" />
          </label>
          <textarea
            id="follow-up"
            lang="und"
            dir="auto"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            maxLength={MAX_Q}
            rows={2}
            placeholder={message("followUp.placeholder")}
            className="w-full resize-none border-b border-line bg-transparent pb-2 font-serif text-[clamp(15px,1.4vw,18px)] leading-[1.5] text-ink outline-none placeholder:text-ink-3/60 focus:border-ink"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[46ch] font-mono text-[10px] leading-[1.5] text-ink-3">
              <UiMessage messageKey="followUp.contextNotice" />
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!question.trim()}
              className="border border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream transition-opacity disabled:opacity-40"
            >
              <UiMessage messageKey="followUp.submit" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
