"use client";

/** Reader question form. A bounded budget and model remain available after the primary ask. */

import { useEffect, useRef, useState } from "react";
// Pure data module (no env imports), so the picker and the server agree on which id is the default.
import { DEFAULT_MODEL_ID } from "@/lib/llm/model-catalog";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";
import type { ResearchMode } from "@/lib/types";
import { currentArcLabel } from "@/lib/arc-network-display";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { useResearchAvailability } from "@/lib/hooks/use-research-availability";
import { RESEARCH_AVAILABILITY_UNKNOWN, RESEARCH_PAUSED_MESSAGE } from "@/lib/research/availability-contract";
import { paperLibraryHref } from "@/lib/papers/handoff";
import { createMessages } from "@/lib/i18n/messages";
import { ProductHuntBadge } from "./product-hunt-badge";

// Catalogue adoption only. Interface locale and request data remain unchanged.
const message = createMessages("en");

interface AskFormProps {
  showLaunchBadge?: boolean;
  disabled?: boolean;
  questionCapUsdc?: number;
  parentId?: string | null;
  conversation?: boolean;
  clearOnSubmit?: boolean;
  restoreQuestion?: { id: number; question: string; researchPaused?: boolean };
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
const MAX_AUTO_SHARED_Q = 500;
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
  // Editable drafts retain the form's full limit. Legacy automatic links keep
  // their existing 500-character ceiling and authorization behavior.
  const q = p.get("q")?.trim().slice(0, p.get("run") === "1" ? MAX_AUTO_SHARED_Q : MAX_ASK_QUESTION_CHARS) || null;
  const b = parseFloat(p.get("budget") ?? "");
  const budget = Number.isFinite(b) && b >= 0 && b <= 0.08 ? b : null;
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
    label: message("researchEntry.sqliteExample"),
    q: "Compare SQLite WAL and rollback journals for a small web application. What are the concurrency and operational tradeoffs?",
  },
  {
    label: message("researchEntry.educationExample"),
    q: "Compare English-language educational YouTube topic ideas for children ages 6–9. Distinguish evidence from assumptions and explain the limits of claims about audience demand.",
  },
];

export function AskForm({ disabled, onAsk, payer = "treasury", parentId, conversation = false, clearOnSubmit = false, questionCapUsdc, restoreQuestion, showLaunchBadge = false }: AskFormProps) {
  const [question, setQuestion] = useState("");
  const { availability, checking, refresh } = useResearchAvailability();
  const [dismissedRejection, setDismissedRejection] = useState<number | null>(null);
  const researchPaused = availability?.state === "paused" ||
    (restoreQuestion !== undefined && restoreQuestion.researchPaused !== false && restoreQuestion.id !== dismissedRejection);
  const checkAvailability = async () => {
    const observed = await refresh();
    if (observed?.state === "not-paused" && restoreQuestion) setDismissedRejection(restoreQuestion.id);
  };
  const restored = useRef<number | null>(null);
  useEffect(() => {
    if (!restoreQuestion || restored.current === restoreQuestion.id) return;
    restored.current = restoreQuestion.id;
    const timer = window.setTimeout(() => setQuestion(current => current.trim() ? current : restoreQuestion.question), 0);
    return () => window.clearTimeout(timer);
  }, [restoreQuestion]);
  const [budget, setBudget] = useState(0.05);
  const maximumBudget = payer === "session" && questionCapUsdc !== undefined && Number.isFinite(questionCapUsdc) && questionCapUsdc > 0
    ? Math.min(0.08, questionCapUsdc) : 0.08;
  const effectiveBudget = Math.min(budget, maximumBudget);
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
  const sharedAutoRef = useRef<ReturnType<typeof readSharedAsk> | null>(null);
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
      if (q && run) sharedAutoRef.current = { q, budget: b, run, parent, model: m, mode };
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const shared = sharedAutoRef.current;
    if (!shared || checking) return;
    sharedAutoRef.current = null;
    if (availability?.state !== "not-paused" || researchPaused || disabled || payer === "paused") return;
    const timer = window.setTimeout(() => {
      onAsk(shared.q!, Math.min(shared.budget ?? 0.05, maximumBudget), shared.parent ?? undefined,
        shared.model ?? undefined, shared.mode);
      if (clearOnSubmit) setQuestion("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [availability, checking, question, researchPaused, disabled, payer, onAsk, maximumBudget, clearOnSubmit]);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled || payer === "paused" || checking || researchPaused) return;
    onAsk(q, effectiveBudget, parentId === undefined ? parentRef.current : parentId ?? undefined, model || undefined, researchMode, scholarly, paidScholarly && payer === "session");
    if (clearOnSubmit) setQuestion("");
  };

  const availabilityPanel = (
    <div className="mt-3 border border-line bg-paper p-3 text-sm text-ink-2" role="status">
      <p>{checking ? message("researchEntry.checking") : researchPaused ? RESEARCH_PAUSED_MESSAGE :
        availability?.message ?? RESEARCH_AVAILABILITY_UNKNOWN}</p>
      <div className="flex flex-wrap gap-x-3">
        <a href="/me/asks" className="inline-flex min-h-11 items-center py-3 underline">{message("researchEntry.savedReports")}</a>
        <button type="button" onClick={() => void checkAvailability()} disabled={checking} className="min-h-11 py-3 underline">{message("researchEntry.checkAvailability")}</button>
      </div>
    </div>
  );

  return (
    <div data-tour="ask-form">
      <div className="border border-ink bg-paper-2">
        <div className="hidden flex-wrap items-center justify-between gap-2 border-b border-ink bg-ink px-4 py-2.5 text-cream sm:flex sm:px-5">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">{message("researchEntry.ask")}</span>
          <span className="font-mono text-[11px]">{message("researchEntry.network", { network: currentArcLabel })}</span>
        </div>
        <div className="p-3.5 sm:p-5">
          <label htmlFor="ask-question" className="block font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2">
            {message("researchEntry.question")}
          </label>
          <textarea
            id="ask-question"
            value={question}
            onChange={(e) => { sharedAutoRef.current = null; setQuestion(e.target.value); }}
            onKeyDown={(e) => {
              if (!e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
            }}
            placeholder={message("researchEntry.placeholder")}
            rows={2}
            maxLength={MAX_ASK_QUESTION_CHARS}
            disabled={disabled}
            className="mt-2 min-h-[76px] w-full resize-y border border-ink bg-paper px-3 py-2 font-serif text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-ink-3">{message("researchEntry.keyboardHint")}</p>
          <a href={paperLibraryHref(question)} aria-label={message("researchEntry.metadataLookupLabel")} className="inline-flex min-h-11 items-center font-serif text-sm text-seal underline" data-testid="paper-metadata-handoff">
            {message("researchEntry.metadataLookup")}
          </a>
          {researchPaused && availabilityPanel}
          <fieldset className="mt-1">
            <legend className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2">{message("researchEntry.depth")}</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["quick", "deep"] as const).map((mode) => (
                <label key={mode} className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 py-2 font-mono text-[12px] font-semibold capitalize focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-seal ${researchMode === mode ? "border-ink bg-ink text-cream" : "border-line bg-paper text-ink"}`}>
                  <input type="radio" name="research-depth" value={mode} checked={researchMode === mode}
                    onChange={() => setResearchMode(mode)} disabled={disabled} className="accent-seal" />
                  {message(mode === "quick" ? "researchEntry.quick" : "researchEntry.deep")}
                </label>
              ))}
            </div>
            <p className="mt-1.5 font-serif text-[13px] leading-snug text-ink-2">
              {researchMode === "quick"
                ? message("researchEntry.quickHint")
                : message("researchEntry.deepHint")}
            </p>
          </fieldset>
          <div className="mt-2 border-t border-line pt-3">
            <p className="mb-2 font-mono text-[11px] leading-snug text-ink-2" data-testid="composer-source-cap">
              {message("researchEntry.sourceCap", { amount: effectiveBudget.toFixed(6), payer: message(payer === "treasury" ? "researchEntry.treasuryPayer" : payer === "session" ? "researchEntry.sessionPayer" : payer === "expired" ? "researchEntry.expiredPayer" : "researchEntry.pausedPayer") })}
            </p>
            <button type="button" onClick={submit} disabled={disabled || payer === "paused" || checking || researchPaused || question.trim().length === 0}
              data-tour="dispatch-btn"
              className="kx-press min-h-12 w-full border border-ink bg-ink px-5 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-cream transition-all hover:bg-paid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-50">
              {message(disabled ? "researchEntry.researching" : researchPaused ? "researchEntry.paused" : "researchEntry.ask")}
            </button>
            {showLaunchBadge && <div className="mt-3 flex justify-center sm:justify-start"><ProductHuntBadge /></div>}
            <p className="mt-2 font-mono text-[11px] leading-snug text-ink-2">
              {payer === "session"
                ? message("researchEntry.sessionNotice", { network: currentArcLabel, amount: effectiveBudget.toFixed(6) })
                : payer === "paused"
                  ? message("researchEntry.unavailableSessionNotice")
                : payer === "expired"
                  ? message("researchEntry.expiredSessionNotice")
                  : message("researchEntry.sponsoredNotice", { network: currentArcLabel })}
            </p>
          </div>
          {!researchPaused && availabilityPanel}
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 font-mono text-xs text-ink">
            <input type="checkbox" checked={scholarly} disabled={disabled} onChange={event => setScholarly(event.target.checked)} />
            {message("researchEntry.scholarly")}
          </label>
          <p className="text-xs text-ink-3">{message("researchEntry.scholarlyNotice")}</p>
          <label className="mt-2 flex min-h-11 items-center gap-2 font-mono text-xs text-ink"><input type="checkbox" checked={paidScholarly} disabled={disabled || payer !== "session" || !browserPaymentProfile().testnet} onChange={event => setPaidScholarly(event.target.checked)} /> {message("researchEntry.paidScholarly")}</label>
          {!browserPaymentProfile().testnet&&<p className="mt-1 text-xs text-ink-3">{message("researchEntry.paidScholarlyMainnetNotice")}</p>}
          <p className="text-xs text-ink-3">{message("researchEntry.paidScholarlyNotice")}</p>
          <details ref={advancedRef} className="mt-3 border-t border-line pt-2">
            <summary className="flex min-h-11 cursor-pointer items-center font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 marker:text-seal hover:text-ink">
              {message("researchEntry.budgetAndModel", { amount: effectiveBudget.toFixed(6) })}
            </summary>
            <div className="pb-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2" data-tour="budget">
                <label htmlFor="ask-budget" className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">{message("researchEntry.maximumBudget")}</label>
                <span className="font-display text-[25px] font-semibold tabular-nums text-seal">${effectiveBudget.toFixed(6)}</span>
              </div>
              <input id="ask-budget" type="range" min={0} max={maximumBudget} step={maximumBudget < 0.01 ? 0.000001 : 0.005} value={effectiveBudget}
                disabled={disabled} onChange={(e) => setBudget(parseFloat(e.target.value))}
                className="mt-2 w-full" aria-label={message("researchEntry.maximumBudgetLabel")} />
              <p className="mt-2 font-serif text-[13px] text-ink-2">{message("researchEntry.budgetNotice")}</p>
              {models.length > 1 && (
                <label className="mt-3 flex flex-col gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                  {message("researchEntry.model")}
                  <select value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)}
                    title={models.find((m) => m.id === model)?.note ?? message("researchEntry.defaultModelNote")}
                    className="min-h-11 w-full border border-ink bg-paper px-3 py-2 text-[12px] font-normal normal-case text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                    <option value="">{message("researchEntry.defaultModel")}</option>
                    {models.filter((m) => m.id !== DEFAULT_MODEL_ID).map((m) => (
                      <option key={m.id} value={m.id} title={m.note}>{m.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
          <p className="mt-2 text-xs text-ink-3">{message("researchEntry.searchNotice")}</p>
          {!conversation && <div className="mt-2 flex flex-wrap gap-2" aria-label={message("researchEntry.examplesLabel")}>
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
