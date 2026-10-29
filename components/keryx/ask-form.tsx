"use client";
import { formatRecordedAmount } from "@/lib/i18n/format";

/** Reader question form. A bounded budget and model remain available after the primary ask. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Zap } from "lucide-react";
// Pure data module (no env imports), so the picker and the server agree on which id is the default.
import { DEFAULT_MODEL_ID } from "@/lib/llm/model-catalog";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";
import type { ResearchMode } from "@/lib/types";
import { currentArcLabel } from "@/lib/arc-network-display";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { useResearchAvailability } from "@/lib/hooks/use-research-availability";
import { RESEARCH_AVAILABILITY_UNKNOWN, RESEARCH_PAUSED_MESSAGE } from "@/lib/research/availability-contract";
import { paperLibraryHref } from "@/lib/papers/handoff";
import { createMessages, englishMessages } from "@/lib/i18n/messages";
import { useLocale } from "@/lib/i18n/locale-context";
import { decisionReviewCopy as reviewCopy } from "@/lib/research/decision-review-copy";
import { useResearchVisibility, type ResearchPublicationSelection } from "@/lib/hooks/use-research-visibility";
import type { RunVisibility } from "@/lib/run-privacy/contracts";
import { ResearchVisibilityPicker } from "./research-visibility-picker";
import { UiText, UiMessage, useUiMessages } from "@/lib/i18n/ui-copy";
import { AnswerLanguageHelp } from "./answer-language-help";



// Catalogue adoption only. Interface locale and request data remain unchanged.
const message = createMessages("en");

interface AskFormProps {
  disabled?: boolean;
  questionCapUsdc?: number;
  parentId?: string | null;
  parentVisibility?: RunVisibility;
  publicationPreference?: ReturnType<typeof useResearchVisibility>;
  conversation?: boolean;
  clearOnSubmit?: boolean;
  allowSharedPrefill?: boolean;
  restoreQuestion?: { id: number; question: string; researchPaused?: boolean; budget?: number; replace?: boolean;
    expectedWallet?: string | null; expectedRevision?: number };
  payer?: "treasury" | "session" | "expired" | "paused";
  onAsk: (
    question: string,
    budget: number,
    parentId?: string,
    model?: string,
    researchMode?: ResearchMode,
    scholarly?: boolean,
    paidScholarly?: boolean,
    reviewFirst?: boolean,
    publication?: ResearchPublicationSelection,
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

export function AskForm({ disabled, onAsk, payer = "treasury", parentId, parentVisibility, publicationPreference, conversation = false, clearOnSubmit = false, allowSharedPrefill = true, questionCapUsdc, restoreQuestion }: AskFormProps) {
  const message = useUiMessages();
  const { locale } = useLocale();
  const ownVisibility = useResearchVisibility(parentVisibility, { enabled: !publicationPreference });
  const visibility = publicationPreference ?? ownVisibility;
  // An unbound draft is editable while the first visibility context is loading.
  // Only the server response can bind it to an owner; it cannot be submitted yet.
  const [draft, setDraft] = useState<{ question: string; wallet: string | null | undefined; revision: number } | null>(null);
  const question = draft && draft.revision === visibility.identityRevision &&
    (draft.wallet === undefined || visibility.ready && draft.wallet === visibility.wallet) ? draft.question : "";
  const setQuestion = useCallback((next: string | ((current: string) => string)) => {
    const publication = visibility.getSelection();
    const revision = visibility.getIdentityRevision();
    const wallet = publication?.expectedWallet;
    setDraft(previous => ({ question: typeof next === "string" ? next : next(previous && (previous.wallet === undefined || previous.wallet === wallet) && previous.revision === revision ? previous.question : ""),
      wallet, revision }));
  }, [visibility.getSelection, visibility.getIdentityRevision]);
  useEffect(() => {
    const publication = visibility.getSelection();
    const revision = visibility.getIdentityRevision();
    setDraft(previous => {
      if (!previous || previous.revision !== revision) return null;
      return publication && previous.wallet === undefined ? { ...previous, wallet: publication.expectedWallet } : previous;
    });
  }, [visibility.ready, visibility.identityRevision, visibility.getSelection, visibility.getIdentityRevision]);
  const { availability, checking, refresh } = useResearchAvailability();
  const [dismissedRejection, setDismissedRejection] = useState<number | null>(null);
  const researchPaused = availability?.state === "paused" ||
    (restoreQuestion !== undefined && restoreQuestion.researchPaused !== false && restoreQuestion.id !== dismissedRejection);
  const checkAvailability = async () => {
    const observed = await refresh();
    if (observed?.state === "not-paused" && restoreQuestion) setDismissedRejection(restoreQuestion.id);
  };
  const [budget, setBudget] = useState(0.05);
  const restored = useRef<number | null>(null);
  useEffect(() => {
    if (!restoreQuestion || restored.current === restoreQuestion.id || !visibility.ready) return;
    const publication = visibility.getSelection(), revision = visibility.getIdentityRevision();
    if (!publication || restoreQuestion.expectedWallet !== undefined && restoreQuestion.expectedWallet !== publication.expectedWallet
      || restoreQuestion.expectedRevision !== undefined && restoreQuestion.expectedRevision !== revision) return;
    const timer = window.setTimeout(() => {
      const current = visibility.getSelection();
      if (!current || current.expectedWallet !== publication.expectedWallet || current.visibility !== publication.visibility
        || visibility.getIdentityRevision() !== revision) return;
      restored.current = restoreQuestion.id;
      setQuestion(current => restoreQuestion.replace || !current.trim() ? restoreQuestion.question : current);
      if (typeof restoreQuestion.budget === "number" && Number.isFinite(restoreQuestion.budget) && restoreQuestion.budget >= 0)
        setBudget(Math.min(0.08, restoreQuestion.budget));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [restoreQuestion, setQuestion, visibility.ready, visibility.getSelection, visibility.getIdentityRevision]);
  const maximumBudget = payer === "session" && questionCapUsdc !== undefined && Number.isFinite(questionCapUsdc) && questionCapUsdc > 0
    ? Math.min(0.08, questionCapUsdc) : 0.08;
  const effectiveBudget = Math.min(budget, maximumBudget);
  // Reasoning-model pick, chat-app style. "" = server default (DeepSeek). The picker only
  // renders when the server offers more than one model; every pick falls back server-side.
  const [model, setModel] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("quick");
  const [scholarly, setScholarly] = useState(false);
  const [paidScholarly, setPaidScholarly] = useState(false);
  const [reviewFirst, setReviewFirst] = useState(false);
  const [models, setModels] = useState<PickerModel[]>([]);
  const testnet = browserPaymentProfile().testnet;
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
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
  const [sharedQuestion, setSharedQuestion] = useState<string | null>(null);
  useEffect(() => {
    if (prefilled.current) return;
    if (!allowSharedPrefill) { prefilled.current = true; return; }
    const timer = window.setTimeout(() => {
      // Strict Mode may clean up the first scheduled effect before it runs.
      // Consume the URL only when its callback actually applies the draft.
      prefilled.current = true;
      const { q, budget: b, run, parent, model: m, mode } = readSharedAsk();
      if (q) setSharedQuestion(q);
      if (b !== null) setBudget(b);
      if (m) setModel(m);
      setResearchMode(mode);
      parentRef.current = parent ?? undefined;
      // Opt-in auto-dispatch: only when the link explicitly asks for it and a question is present.
      // Treasury free-trial rate limits still apply, so this can't be turned into a spend amplifier.
      if (q && run) sharedAutoRef.current = { q, budget: b, run, parent, model: m, mode };
    }, 0);
    return () => window.clearTimeout(timer);
  }, [allowSharedPrefill]);
  useEffect(() => {
    if (!visibility.ready || sharedQuestion === null) return;
    setQuestion(sharedQuestion); setSharedQuestion(null);
  }, [visibility.ready, sharedQuestion, setQuestion]);

  useEffect(() => {
    const shared = sharedAutoRef.current;
    if (!shared || sharedQuestion !== null || checking || !visibility.ready) return;
    const publication = visibility.getSelection();
    if (!publication) return;
    const revision = visibility.getIdentityRevision();
    sharedAutoRef.current = null;
    if (availability?.state !== "not-paused" || researchPaused || disabled || payer === "paused") return;
    const timer = window.setTimeout(() => {
      const current = visibility.getSelection();
      if (!current || revision !== visibility.getIdentityRevision() || current.expectedWallet !== publication.expectedWallet || current.visibility !== publication.visibility) return;
      onAsk(shared.q!, Math.min(shared.budget ?? 0.05, maximumBudget), shared.parent ?? undefined,
        shared.model ?? undefined, shared.mode, undefined, undefined, undefined, publication);
      if (clearOnSubmit) setQuestion("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [availability, checking, question, sharedQuestion, researchPaused, disabled, payer, onAsk, maximumBudget, clearOnSubmit, visibility.ready, visibility.getSelection, visibility.getIdentityRevision, setQuestion]);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled || payer === "paused" || checking || researchPaused) return;
    const publication = visibility.getSelection();
    if (!publication || !draft || draft.revision !== visibility.getIdentityRevision() || draft.wallet !== publication.expectedWallet) return;
    onAsk(q, effectiveBudget, parentId === undefined ? parentRef.current : parentId ?? undefined, model || undefined, researchMode, scholarly, paidScholarly && payer === "session" && testnet, reviewFirst, publication);
    if (clearOnSubmit) setQuestion("");
  };

  const availabilityPanel = (
    <div className="mt-3 border border-line bg-paper p-3 text-sm text-ink-2" role="status">
      <p>{checking ? <UiMessage messageKey="researchEntry.checking" /> : researchPaused ? RESEARCH_PAUSED_MESSAGE :
        availability?.message ?? RESEARCH_AVAILABILITY_UNKNOWN}</p>
      <div className="flex flex-wrap gap-x-3">
        <a href="/me/asks" className="inline-flex min-h-11 items-center py-3 underline"><UiMessage messageKey="researchEntry.savedReports" /></a>
        <button type="button" onClick={() => void checkAvailability()} disabled={checking} className="min-h-11 py-3 underline"><UiMessage messageKey="researchEntry.checkAvailability" /></button>
      </div>
    </div>
  );

  return (
    <div data-tour="ask-form">
      <div className="kx-research-composer border border-line bg-paper shadow-[0_4px_24px_-12px_rgba(27,23,18,0.25)]">
        <div className="p-4 sm:p-6">
          <label htmlFor="ask-question" className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-2">
            <UiMessage messageKey="researchEntry.question" />
          </label>
          <textarea
            id="ask-question"
            ref={questionRef}
            value={question}
            onChange={(e) => { sharedAutoRef.current = null; setSharedQuestion(null); setQuestion(e.target.value); }}
            onKeyDown={(e) => {
              if (!e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
            }}
            placeholder={message("researchEntry.placeholder")}
            rows={2}
            maxLength={MAX_ASK_QUESTION_CHARS}
            disabled={disabled}
            aria-describedby="ask-keyboard-hint"
            className="mt-3 min-h-[88px] w-full resize-y border border-ink-3/75 bg-paper px-3 py-3 font-serif text-lg leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:border-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:opacity-50 sm:min-h-[104px] sm:text-xl"
          />
          <p id="ask-keyboard-hint" className="mt-1 text-xs text-ink-3"><UiMessage messageKey="researchEntry.keyboardHint" /></p>
          {visibility.ready && visibility.visibility === "public" && !conversation && !parentId && !parentRef.current && !paidScholarly && <AnswerLanguageHelp />}
          {(researchPaused || !checking && !availability) && availabilityPanel}

          <div className="mt-4 border-t border-line pt-4">
          <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
          <fieldset className="min-w-0">
            <legend className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2"><UiMessage messageKey="researchEntry.depth" /></legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["quick", "deep"] as const).map((mode) => (
                <label key={mode} className={`kx-research-depth flex min-h-12 cursor-pointer items-center gap-2 border px-3 py-2 font-mono text-xs font-semibold capitalize transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-seal ${researchMode === mode ? "border-paid bg-paid/10 text-paid" : "border-line bg-paper text-ink-2 hover:border-ink-3"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
                  <input type="radio" name="research-depth" value={mode} checked={researchMode === mode}
                    onChange={() => setResearchMode(mode)} disabled={disabled} className="size-3.5 shrink-0 accent-paid" />
                  {mode === "quick" ? <Zap aria-hidden="true" className="size-3.5 shrink-0" /> : <BookOpen aria-hidden="true" className="size-3.5 shrink-0" />}
                  <UiMessage messageKey={mode === "quick" ? "researchEntry.quick" : "researchEntry.deep"} />
                </label>
              ))}
            </div>
            <p className="mt-2 font-serif text-[13px] leading-snug text-ink-2" aria-live="polite">
              <UiMessage messageKey={researchMode === "quick" ? "researchEntry.quickHint" : "researchEntry.deepHint"} />
            </p>
          </fieldset>
            <button type="button" onClick={submit} disabled={disabled || payer === "paused" || checking || researchPaused || !visibility.ready || draft?.wallet === undefined || question.trim().length === 0}
              data-tour="dispatch-btn"
              className="kx-research-submit kx-press flex min-h-12 w-full items-center justify-center gap-4 border border-ink bg-ink px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-cream transition-colors enabled:hover:border-paid enabled:hover:bg-paid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-50 sm:mb-[23px] sm:w-auto sm:min-w-44">
              <UiMessage messageKey={disabled ? "researchEntry.researching" : researchPaused ? "researchEntry.paused" : "researchEntry.ask"} />
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            </button>
          </div>
            {!conversation && <div className="mt-4 flex flex-wrap gap-2" aria-label={message("researchEntry.examplesLabel")}>
              {SUGGESTIONS.map((s) => (
                <button key={s.label} type="button" disabled={disabled} onClick={() => { sharedAutoRef.current = null; setSharedQuestion(null); setQuestion(s.q); questionRef.current?.focus(); }}
                  className="kx-research-example inline-flex min-h-11 max-w-full items-center gap-2 border border-line px-3 py-2 text-left font-mono text-[11px] leading-snug text-ink-2 transition-colors hover:border-seal hover:bg-paper-2/40 hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:opacity-50">
                  <UiText source={s.label} />
                  <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
                </button>
              ))}
            </div>}
            <div className="mt-4 border-l-2 border-brass/60 pl-3">
            <p className="font-mono text-[11px] leading-relaxed text-ink-2" data-testid="composer-payer-notice">
              <UiMessage messageKey={payer === "session" ? "researchEntry.sessionPayerNotice" : payer === "paused"
                ? "researchEntry.unavailableSessionNotice" : payer === "expired" ? "researchEntry.expiredSessionNotice" : "researchEntry.freeTrialNotice"}
                values={payer === "session" ? { network: currentArcLabel } : undefined} />
            </p>
            {visibility.ready && <p className="mt-1 text-xs leading-4 text-ink-3" role="status" data-testid="composer-publication-notice">
              <UiMessage messageKey={visibility.visibility === "public" ? "researchTrial.publicNotice" : `researchVisibility.${visibility.visibility}Notice`} />
            </p>}
            {visibility.status === "error" && <p className="mt-2 text-sm text-seal" role="status">
              <UiMessage messageKey="researchVisibility.unavailable" /> {" "}
              <button type="button" className="min-h-11 underline" onClick={() => { if (advancedRef.current) advancedRef.current.open = true; }}><UiMessage messageKey="researchEntry.moreOptions" /></button>
            </p>}
            </div>
          </div>
          <details ref={advancedRef} className="group/options mt-4 border-t border-line pt-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal [&::-webkit-details-marker]:hidden">
              <UiMessage messageKey="researchEntry.moreOptions" />
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open/options:rotate-180" />
            </summary>
            <div className="pb-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2" data-tour="budget">
                <label htmlFor="ask-budget" className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2"><UiMessage messageKey="researchEntry.maximumBudget" /></label>
                <span className="font-display text-[25px] font-semibold tabular-nums text-seal">${formatRecordedAmount(effectiveBudget, { minimumFractionDigits: 6, useGrouping: false })}</span>
              </div>
              <input id="ask-budget" type="range" min={0} max={maximumBudget} step={maximumBudget < 0.01 ? 0.000001 : 0.005} value={effectiveBudget}
                disabled={disabled} onChange={(e) => setBudget(parseFloat(e.target.value))}
                className="mt-2 w-full" aria-label={message("researchEntry.maximumBudgetLabel")} />
              <p className="mt-2 font-serif text-[13px] text-ink-2"><UiMessage messageKey="researchEntry.budgetNotice" /></p>
              {payer === "session" && <p className="mt-2 text-xs text-ink-2"><UiMessage messageKey="researchEntry.sessionNotice" values={{ network: currentArcLabel, amount: formatRecordedAmount(effectiveBudget, { minimumFractionDigits: 6, useGrouping: false }) }} /></p>}
              {models.length > 1 && (
                <label className="mt-3 flex flex-col gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                  <UiMessage messageKey="researchEntry.model" />
                  <select value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)}
                    title={models.find((m) => m.id === model)?.note ?? message("researchEntry.defaultModelNote")}
                    className="min-h-11 w-full border border-ink bg-paper px-3 py-2 text-[12px] font-normal normal-case text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                    <option value="" lang={message("researchEntry.defaultModel") === englishMessages["researchEntry.defaultModel"] ? "en" : locale}>{message("researchEntry.defaultModel")}</option>
                    {models.filter((m) => m.id !== DEFAULT_MODEL_ID).map((m) => (
                      <option key={m.id} value={m.id} title={m.note}>{m.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <ResearchVisibilityPicker preference={visibility} disabled={disabled} parentVisibility={parentVisibility} compact />
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 font-mono text-xs text-ink">
              <input type="checkbox" checked={scholarly} disabled={disabled} onChange={event => setScholarly(event.target.checked)} />
              <UiMessage messageKey="researchEntry.scholarly" />
            </label>
            <p className="text-xs text-ink-3"><UiMessage messageKey="researchEntry.scholarlyNotice" /></p>
            {testnet && <>
              <label className="mt-2 flex min-h-11 items-center gap-2 font-mono text-xs text-ink"><input type="checkbox" checked={paidScholarly} disabled={disabled || payer !== "session"} onChange={event => setPaidScholarly(event.target.checked)} /> <UiMessage messageKey="researchEntry.paidScholarly" /></label>
              <p className="text-xs text-ink-3"><UiMessage messageKey="researchEntry.paidScholarlyNotice" /></p>
            </>}
            <label className="mt-2 flex min-h-11 items-center gap-2 font-mono text-xs text-ink"><input type="checkbox" checked={reviewFirst} disabled={disabled || payer !== "session" && !reviewFirst} onChange={event => setReviewFirst(event.target.checked)} />{reviewCopy.mode}</label>
            <p className="mt-1 text-xs text-ink-3">{reviewCopy.modeNotice}</p>
            <a href={paperLibraryHref(question)} aria-label={message("researchEntry.metadataLookupLabel")} className="inline-flex min-h-11 items-center font-serif text-sm text-seal underline" data-testid="paper-metadata-handoff">
              <UiMessage messageKey="researchEntry.metadataLookup" />
            </a>
            <p className="mt-2 text-xs text-ink-3"><UiMessage messageKey="researchEntry.searchNotice" /></p>
          </details>
        </div>
      </div>
    </div>
  );
}
