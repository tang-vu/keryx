"use client";

/**
 * The dispatch order — the ask, struck as a banknote draft: ink double-frame,
 * an engraved header band, an authorized-budget dial with a Bodoni vermillion
 * denomination, a Bodoni question line, and a tactile letterpress "Dispatch"
 * button. Wires straight into the live agent (onAsk).
 */

import { useEffect, useRef, useState } from "react";

interface AskFormProps {
  disabled?: boolean;
  onAsk: (question: string, budget: number, parentId?: string, model?: string) => void;
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
} {
  if (typeof window === "undefined")
    return { q: null, budget: null, run: false, parent: null, model: null };
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
  return { q, budget, run: p.get("run") === "1", parent, model };
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
  // Reasoning-model pick, chat-app style. "" = server default (DeepSeek). The picker only
  // renders when the server offers more than one model; every pick falls back server-side.
  const [model, setModel] = useState("");
  const [models, setModels] = useState<PickerModel[]>([]);
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
    const { q, budget: b, run, parent, model: m } = readSharedAsk();
    if (q) setQuestion(q);
    if (b !== null) setBudget(b);
    if (m) setModel(m);
    parentRef.current = parent ?? undefined;
    // Opt-in auto-dispatch: only when the link explicitly asks for it and a question is present.
    // Treasury free-trial rate limits still apply, so this can't be turned into a spend amplifier.
    if (q && run && !disabled) onAsk(q, b ?? 0.05, parent ?? undefined, m ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled) return;
    onAsk(q, budget, parentRef.current, model || undefined);
  };

  return (
    <div data-tour="ask-form">
      <div className="border-2 border-ink bg-paper p-[5px]">
        <div className="border border-ink">
          {/* engraved header band */}
          <div className="flex items-center justify-between gap-4 border-b border-ink bg-ink px-5 py-3 text-cream">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
              Dispatch order № 0481
            </span>
            <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream/70">
              <span className="h-[6px] w-[6px] rounded-full bg-paid" />
              Free to try · paid in USDC on Arc
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
                  data-tour="budget"
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
              <div className="flex flex-wrap items-center gap-3">
                {models.length > 1 && (
                  <label className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
                    Counsel
                    <select
                      value={model}
                      disabled={disabled}
                      onChange={(e) => setModel(e.target.value)}
                      title={models.find((m) => m.id === model)?.note ?? "Default reasoning model"}
                      className="max-w-[180px] cursor-pointer border border-ink bg-paper-2 px-2 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-ink outline-none transition-colors hover:border-seal/60 focus:border-seal disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Reasoning model"
                    >
                      <option value="">Default · DeepSeek</option>
                      {models
                        .filter((m) => m.id !== "deepseek-chat")
                        .map((m) => (
                          <option key={m.id} value={m.id} title={m.note}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={submit}
                  disabled={disabled || question.trim().length === 0}
                  className="kx-press border border-ink bg-ink px-7 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  data-tour="dispatch-btn"
                >
                  Dispatch ▸
                </button>
              </div>
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
