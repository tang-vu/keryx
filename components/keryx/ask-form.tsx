"use client";

/** Reader question form. A bounded budget and model remain available after the primary ask. */

import { useEffect, useRef, useState } from "react";
// Pure data module (no env imports), so the picker and the server agree on which id is the default.
import { DEFAULT_MODEL_ID } from "@/lib/llm/model-catalog";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";
import type { ResearchMode } from "@/lib/types";
import { currentArcLabel } from "@/lib/arc-network-display";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

interface AskFormProps {
  disabled?: boolean;
  parentId?: string | null;
  conversation?: boolean;
  clearOnSubmit?: boolean;
  payer?: "treasury" | "session" | "expired" | "paused";
  onAsk: (
    question: string,
    budget: number,
    parentId?: string,
    model?: string,
    researchMode?: ResearchMode,
    scholarly?: boolean,
    paidScholarly?: boolean,
  ) => void;
}

/** Picker entry from GET /api/models — only models the server can actually run. */
interface PickerModel {
  id: string;
  label: string;
  note: string;
}

// Shareable-link prefill: a URL like keryx.cc/?q=...&budget=0.05[&run=1] lands a
// visitor with the question (and budget) already filled — and, with run=1, dispatches
// it automatically so the shared link opens straight onto a live run. Bounds mirror the
// form's own limits so a crafted link can't smuggle an out-of-range budget or huge prompt.
const MAX_SHARED_Q = 500;
/** A dispatch id is a UUID — pin the shape so a crafted link can't put arbitrary text on the wire. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSharedAsk(): {
  q: string | null;
  budget: number | null;
  run: boolean;
  parent: string | null;
  model: string | null;
  mode: ResearchMode;
} {
  if (typeof window === "undefined")
    return { q: null, budget: null, run: false, parent: null, model: null, mode: "quick" };
  const p = new URLSearchParams(window.location.search);
  const q = p.get("q")?.trim().slice(0, MAX_SHARED_Q) || null;
  const b = parseFloat(p.get("budget") ?? "");
  const budget = Number.isFinite(b) && b >= 0.01 && b <= 0.08 ? b : null;
  // Follow-up link from a dispatch permalink: the server re-reads this run and anchors the
  // question to it. An unknown id degrades to a standalone ask server-side.
  const rawParent = p.get("parent")?.trim() ?? "";
  const parent = UUID_RE.test(rawParent) ? rawParent : null;
  // Model pick from a shared link. Server-validated against the catalog (unknown → default),
  // so the raw value is safe to carry; cap the length to keep the wire tidy.
  const model = p.get("model")?.trim().slice(0, 40) || null;
  const mode = p.get("mode") === "deep" ? "deep" : "quick";
  return { q, budget, run: p.get("run") === "1", parent, model, mode };
}

const SUGGESTIONS = [
  {
    label: "Compare SQLite WAL and rollback journals",
    q: "Compare SQLite WAL and rollback journals for a small web application. What are the concurrency and operational tradeoffs?",
  },
  {
    label: "Research children's educational video ideas",
    q: "Compare English-language educational YouTube topic ideas for children ages 6–9. Distinguish evidence from assumptions and explain the limits of claims about audience demand.",
  },
];

export function AskForm({ disabled, onAsk, payer = "treasury", parentId, conversation = false, clearOnSubmit = false }: AskFormProps) {
  const [question, setQuestion] = useState("");
  const [budget, setBudget] = useState(0.05);
  // Reasoning-model pick, chat-app style. "" = server default (DeepSeek). The picker only
  // renders when the server offers more than one model; every pick falls back server-side.
  const [model, setModel] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("quick");
  const [scholarly, setScholarly] = useState(false);
  const [paidScholarly, setPaidScholarly] = useState(false);
  const [models, setModels] = useState<PickerModel[]>([]);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const revealBudget = () => { if (advancedRef.current) advancedRef.current.open = true; };
    document.addEventListener("keryx:tour-budget", revealBudget);
    return () => document.removeEventListener("keryx:tour-budget", revealBudget);
  }, []);
  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { models?: PickerModel[] }) => setModels(data.models ?? []))
      .catch(() => {
        // Non-fatal: without the list the form simply asks with the default model.
      });
  }, []);
  // Seed from a shared link after mount (not in useState initializer) so the server
  // and first client render both start empty — no hydration mismatch on the controlled inputs.
  const prefilled = useRef(false);
  // Survives an edit: a reader can land from a follow-up link, reword the question, and the
  // dispatch still threads onto the parent.
  const parentRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    const timer = window.setTimeout(() => {
      const { q, budget: b, run, parent, model: m, mode } = readSharedAsk();
      if (q) setQuestion(q);
      if (b !== null) setBudget(b);
      if (m) setModel(m);
      setResearchMode(mode);
      parentRef.current = parent ?? undefined;
      // Opt-in auto-dispatch: only when the link explicitly asks for it and a question is present.
      // Treasury free-trial rate limits still apply, so this can't be turned into a spend amplifier.
      if (q && run && !disabled) {
        onAsk(q, b ?? 0.05, parent ?? undefined, m ?? undefined, mode);
        if (clearOnSubmit) setQuestion("");
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled || payer === "paused") return;
    onAsk(q, budget, parentId === undefined ? parentRef.current : parentId ?? undefined, model || undefined, researchMode, scholarly, paidScholarly && payer === "session");
    if (clearOnSubmit) setQuestion("");
  };

  return (
    <div data-tour="ask-form">
      <div className="border border-ink bg-paper-2">
        <div className="hidden flex-wrap items-center justify-between gap-2 border-b border-ink bg-ink px-4 py-2.5 text-cream sm:flex sm:px-5">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">Ask Keryx</span>
          <span className="font-mono text-[11px]">USDC on {currentArcLabel}</span>
        </div>
        <div className="p-3.5 sm:p-5">
          <label htmlFor="ask-question" className="block font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2">
            What do you want to know?
          </label>
          <textarea
            id="ask-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (!e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
            }}
            placeholder="Ask a question worth reading for..."
            rows={2}
            maxLength={MAX_ASK_QUESTION_CHARS}
            disabled={disabled}
            className="mt-2 min-h-[76px] w-full resize-y border border-ink bg-paper px-3 py-2 font-serif text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-ink-3">Enter for a new line · Ctrl/⌘ + Enter to ask</p>
          <fieldset className="mt-3">
            <legend className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2">Research depth</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["quick", "deep"] as const).map((mode) => (
                <label key={mode} className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 py-2 font-mono text-[12px] font-semibold capitalize focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-seal ${researchMode === mode ? "border-ink bg-ink text-cream" : "border-line bg-paper text-ink"}`}>
                  <input type="radio" name="research-depth" value={mode} checked={researchMode === mode}
                    onChange={() => setResearchMode(mode)} disabled={disabled} className="accent-seal" />
                  {mode}
                </label>
              ))}
            </div>
            <p className="mt-1.5 font-serif text-[13px] leading-snug text-ink-2">
              {researchMode === "quick"
                ? "Quick: up to 2 focused reads."
                : "Deep: up to 4 reads, including marketplace discovery and a coverage check."}
            </p>
          </fieldset>
          <div className="mt-2 border-t border-line pt-3">
            <p className="mb-2 font-mono text-[11px] leading-snug text-ink-2" data-testid="composer-source-cap">
              Source cap: {budget.toFixed(3)} USDC · {payer === "treasury" ? "Keryx pays" : payer === "session" ? "Your session" : payer === "expired" ? "Session expired" : "Session paused"}
            </p>
            <button type="button" onClick={submit} disabled={disabled || payer === "paused" || question.trim().length === 0}
              data-tour="dispatch-btn"
              className="kx-press min-h-12 w-full border border-ink bg-ink px-5 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-cream transition-all hover:bg-paid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-50">
              {disabled ? "Researching..." : "Ask Keryx"}
            </button>
            <p className="mt-2 font-mono text-[11px] leading-snug text-ink-2">
              {payer === "session"
                ? `Your funded session pays on ${currentArcLabel}. Question budget: $${budget.toFixed(3)} USDC; your session cap also applies.`
                : payer === "paused"
                  ? "Session status unavailable. Recover your funded session below before another question."
                : payer === "expired"
                  ? "Session expired. Recover it below before another wallet funded question."
                  : `Free trial: Keryx's treasury pays on ${currentArcLabel}. Question budget: up to $${budget.toFixed(3)} USDC.`}
            </p>
          </div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 font-mono text-xs text-ink">
            <input type="checkbox" checked={scholarly} disabled={disabled} onChange={event => setScholarly(event.target.checked)} />
            Search scholarly papers (Crossref and arXiv)
          </label>
          <p className="text-xs text-ink-3">Sends your question to scholarly repositories. DOI lookup works when a DOI is in the question. Public papers cost no source USDC; unavailable papers and abstract-only reads stay visible.</p>
          <label className="mt-2 flex min-h-11 items-center gap-2 font-mono text-xs text-ink"><input type="checkbox" checked={paidScholarly} disabled={disabled || payer !== "session" || !browserPaymentProfile().testnet} onChange={event => setPaidScholarly(event.target.checked)} /> Include reviewed paid manuscripts (experimental testnet rights protocol)</label>
          {!browserPaymentProfile().testnet&&<p className="mt-1 text-xs text-ink-3">Paid manuscript rights are not yet available on mainnet. Ordinary registered articles remain available.</p>}
          <p className="text-xs text-ink-3">Requires your funded browser session. Uses the question budget for access and supported citation rewards. Public scholarly references stay free; only approved exact versions can be paid.</p>
          <details ref={advancedRef} className="mt-3 border-t border-line pt-2">
            <summary className="flex min-h-11 cursor-pointer items-center font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 marker:text-seal hover:text-ink">
              Budget and model: ${budget.toFixed(3)} USDC
            </summary>
            <div className="pb-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2" data-tour="budget">
                <label htmlFor="ask-budget" className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">Maximum budget</label>
                <span className="font-display text-[25px] font-semibold tabular-nums text-seal">${budget.toFixed(3)}</span>
              </div>
              <input id="ask-budget" type="range" min={0.01} max={0.08} step={0.005} value={budget}
                disabled={disabled} onChange={(e) => setBudget(parseFloat(e.target.value))}
                className="mt-2 w-full" aria-label="Maximum budget in USDC" />
              <p className="mt-2 font-serif text-[13px] text-ink-2">The agent cannot spend more than this amount on one question.</p>
              {models.length > 1 && (
                <label className="mt-3 flex flex-col gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                  AI model
                  <select value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)}
                    title={models.find((m) => m.id === model)?.note ?? "Default reasoning model"}
                    className="min-h-11 w-full border border-ink bg-paper px-3 py-2 text-[12px] font-normal normal-case text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                    <option value="">Default: DeepSeek</option>
                    {models.filter((m) => m.id !== DEFAULT_MODEL_ID).map((m) => (
                      <option key={m.id} value={m.id} title={m.note}>{m.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
          <p className="mt-2 text-xs text-ink-3">Research may search the public web; your question is sent to our search provider. The USDC source budget is separate from model and search operating costs.</p>
          {!conversation && <div className="mt-2 flex flex-wrap gap-2" aria-label="Example questions">
            {SUGGESTIONS.map((s) => (
              <button key={s.label} type="button" disabled={disabled} onClick={() => setQuestion(s.q)}
                className="min-h-11 max-w-full border border-line bg-paper px-3 py-2 text-left font-mono text-[11px] leading-snug text-ink-2 transition-colors hover:border-seal hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:opacity-50">
                {s.label}
              </button>
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}
