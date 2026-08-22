"use client";

/**
 * Compact ask UI meant to live inside a ~380px iframe on a creator's own site
 * (injected by public/widget.js). Visitors ask with no wallet and no sign-up —
 * the run settles from Keryx's treasury on the anonymous path, IP rate-limited
 * server-side. If the herald cites the host creator, they are paid from their
 * own audience's questions — that is the whole point of the widget.
 *
 * `?source=<id>` names the hosting creator so the surface can say whose desk
 * the visitor is asking from. It does NOT bias the agent: sources win citations
 * only on merit, same as every other dispatch.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { KeryxGlyph } from "@/components/keryx/keryx-mark";
import { TraceRow } from "@/components/keryx/trace-row";
import { AnswerMarkdown } from "@/components/keryx/answer-markdown";
import { fmtUsdc } from "@/components/keryx/phase-style";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import { useBrowserOrigin } from "@/lib/hooks/use-browser-origin";

const CANONICAL = "https://keryx.cc";

export function EmbedClient() {
  const params = useSearchParams();
  const sourceId = params.get("source");

  // Host origin for outbound links — refined on mount so localhost previews work.
  const origin = useBrowserOrigin(CANONICAL);

  // Resolve the hosting source's name from the public listing (best-effort).
  const [sourceName, setSourceName] = useState<string | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    fetch("/api/sources")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { sources?: Array<{ id?: string; name?: string }> }) => {
        const hit = (data.sources ?? []).find((s) => s.id === sourceId);
        if (hit?.name) setSourceName(hit.name);
      })
      .catch(() => {}); // cosmetic only — the ask works without it
  }, [sourceId]);

  const { state, ask } = useAskStream();
  const [question, setQuestion] = useState("");
  const streaming = state.status === "streaming";
  const started = state.status !== "idle";

  // Keep the newest trace line in view as the dispatch streams.
  const traceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight });
  }, [state.steps.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    // budget 0 → the server applies its default, clamped to the anonymous cap
    if (q && !streaming) void ask(q, 0);
  };

  return (
    <div className="flex h-dvh flex-col bg-paper-2">
      {/* Masthead */}
      <header className="flex items-center justify-between border-b border-ink bg-paper px-3.5 py-2.5">
        <a
          href={`${origin}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2"
        >
          <KeryxGlyph size={22} reeded={false} />
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Keryx
          </span>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3 sm:inline">
            citations are currency
          </span>
        </a>
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
          <span className="h-[5px] w-[5px] rounded-full bg-paid" />
          Free · no wallet
        </span>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {sourceName && (
          <p className="font-serif text-[12.5px] leading-snug text-ink-2">
            You&rsquo;re asking from <span className="font-semibold text-ink">{sourceName}</span>
            &rsquo;s desk — if the herald cites them, they&rsquo;re paid for it, instantly.
          </p>
        )}

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question…"
            disabled={streaming}
            className="min-w-0 flex-1 border border-ink bg-paper px-3 py-2 font-serif text-[14px] text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-seal disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || !question.trim()}
            className="shrink-0 border border-ink bg-ink px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-paper transition-opacity disabled:opacity-50"
          >
            {streaming ? "…" : "Ask ▸"}
          </button>
        </form>

        {state.status === "error" &&
          (state.errorKind === "rate-limit" ? (
            <div className="border border-ink bg-paper px-3 py-2.5">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-seal">
                Free trial · limit reached
              </div>
              <p className="mt-1 font-serif text-[12.5px] leading-snug text-ink-2">
                {state.retryAfter && state.retryAfter > 0
                  ? `Try again in ${state.retryAfter}s — or `
                  : "Try again shortly — or "}
                <a
                  href={`${origin}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-seal underline-offset-2"
                >
                  keep going on keryx.cc with your own wallet
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {state.error ?? "Something went wrong — please try again."}
            </div>
          ))}

        {/* Live reasoning trace */}
        {started && state.steps.length > 0 && (
          <div
            ref={traceRef}
            className="max-h-56 overflow-y-auto border border-line bg-paper px-3 py-1"
          >
            {state.steps.map((step, i) => (
              <TraceRow key={i} step={step} />
            ))}
          </div>
        )}

        {/* The answer + who got paid */}
        {state.run && (
          <div className="border-2 border-ink bg-paper p-1">
            <div className="border border-ink p-3">
              <AnswerMarkdown
                text={state.run.answer}
                citations={state.run.citations}
                className="font-serif text-[13.5px] leading-[1.55] text-ink"
              />
              {state.run.citations.length > 0 && (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
                    Creators paid · ${fmtUsdc(state.run.totalToCreators)} USDC
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {state.run.citations.map((c) => (
                      <li
                        key={c.sourceId}
                        className="flex items-baseline justify-between gap-2 font-serif text-[12px] text-ink-2"
                      >
                        <span className="truncate">{c.sourceName}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-paid">
                          ${fmtUsdc(c.reward)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <a
                href={`${origin}/dispatch/${state.run.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-seal hover:underline"
              >
                Full dispatch <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Colophon */}
      <footer className="border-t border-line bg-paper px-3.5 py-1.5">
        <a
          href={`${origin}/register`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink"
        >
          Powered by Keryx — every citation pays its author ↗
        </a>
      </footer>
    </div>
  );
}
