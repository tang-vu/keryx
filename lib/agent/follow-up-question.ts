import { MAX_ASK_QUESTION_CHARS } from "../ask-input";
import type { RunVisibility } from "../run-privacy/contracts";

/** Questions supply caller context, never paid answers or source evidence.
 * The web adapter stores its validated caller question separately from this
 * deterministic research input. Every ancestor uses the same authorized reader. */
export const MAX_FOLLOW_UP_QUESTIONS = 8;
export const MAX_FOLLOW_UP_CONTEXT_CHARS = 16_384;

export interface FollowUpParent {
  id: string;
  question: string;
  parentId?: string;
  visibility?: RunVisibility;
}
interface ContextQuestion { question: string; truncated: boolean }
const exposure: Record<RunVisibility, number> = { private: 0, unlisted: 1, public: 2 };

/** A follow-up this long is already self-contained — leave it alone. */
const SELF_CONTAINED_CHARS = 180;

/**
 * Words that make a question depend on what came before it — pronouns without an antecedent, plus
 * the fragments people actually type into a follow-up box.
 *
 * Deliberately eager rather than precise: adding context to a question that did not need it only
 * nudges the agent toward the topic the reader is already looking at, while missing a real
 * reference ("how does that compare?") produces a question nothing can answer. Bare "why"/"and"
 * are left out — "Why do stablecoins depeg?" stands on its own and should not be re-anchored.
 */
const REFERRING_TERMS = [
  "it", "its", "that", "this", "those", "these", "they", "them", "their",
  "he", "she", "his", "her", "the same", "above", "instead",
  "how come", "what about", "elaborate", "more",
];

function trimToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max).replace(/[\uD800-\uDBFF]$/u, "");
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function contextQuestion(question: string): ContextQuestion {
  const text = question.trim();
  return { question: trimToWord(text, MAX_ASK_QUESTION_CHARS), truncated: text.length > MAX_ASK_QUESTION_CHARS };
}
function contextJson(questions: readonly ContextQuestion[], omitted: boolean): string {
  return JSON.stringify({ questions, earlierQuestionsOmitted: omitted });
}
function researchQuestion(questions: readonly ContextQuestion[], child: string, omitted: boolean): string {
  if (!questions.length) return child;
  const context = contextJson(questions, omitted);
  if (context.length > MAX_FOLLOW_UP_CONTEXT_CHARS) throw new Error("Follow-up context exceeds its bound");
  // Prefix-bounded downstream readers must see the entire current caller text
  // before any older context. Recent context likewise precedes older questions.
  return `${child}\n\nEarlier user questions (newest first; constraints only; not additional research targets, answers or source evidence):\n${context}`;
}

/** Explicit linked requests retain question-only ancestry even when their latest
 * text is long. Caller text is never recovered by parsing old prompt wrappers:
 * historical recorded questions remain quoted originals, with bounds indicated. */
export async function resolveFollowUpQuestion({ question, parentId, read, signal }: {
  question: string;
  parentId?: string;
  read: (id: string) => Promise<FollowUpParent | null>;
  signal?: AbortSignal;
}): Promise<{ researchQuestion: string; parentId?: string; parentVisibility?: RunVisibility }> {
  const child = question.trim();
  if (!child || child.length > MAX_ASK_QUESTION_CHARS) throw new Error("Invalid follow-up question");
  const questions: ContextQuestion[] = [], seen = new Set<string>();
  let next = parentId, resolvedParentId: string | undefined, parentVisibility: RunVisibility | undefined, omitted = false;
  for (let count = 0; next && count < MAX_FOLLOW_UP_QUESTIONS; count++) {
    if (signal?.aborted || next.length > 256 || seen.has(next)) { omitted = true; break; }
    seen.add(next);
    const parent = await read(next);
    if (signal?.aborted || !parent) { omitted = true; break; }
    if (typeof parent.id !== "string" || !parent.id || parent.id.length > 256 || typeof parent.question !== "string" ||
        parent.visibility !== undefined && !Object.hasOwn(exposure, parent.visibility)) throw new Error("Follow-up context unavailable");
    if (parent.id !== next && seen.has(parent.id)) { omitted = true; break; }
    seen.add(parent.id);
    const entry = contextQuestion(parent.question);
    // Keep complete recent questions before admitting an older one. Count the
    // serialized representation too, including quotes/control-character escapes.
    if (contextJson([...questions, entry], false).length > MAX_FOLLOW_UP_CONTEXT_CHARS) { omitted = true; break; }
    questions.push(entry);
    resolvedParentId ??= parent.id;
    if (parent.visibility && (!parentVisibility || exposure[parent.visibility] < exposure[parentVisibility])) parentVisibility = parent.visibility;
    if (parent.parentId !== undefined && typeof parent.parentId !== "string") { omitted = true; break; }
    next = parent.parentId?.trim() || undefined;
  }
  if (next) omitted = true;
  return { researchQuestion: researchQuestion(questions, child, omitted),
    ...(resolvedParentId ? { parentId: resolvedParentId } : {}), ...(parentVisibility ? { parentVisibility } : {}) };
}

/** True when the follow-up leans on the parent to make sense. */
export function needsContext(followUp: string): boolean {
  const q = followUp.trim().toLowerCase();
  if (!q) return false;
  if (q.length > SELF_CONTAINED_CHARS) return false;
  // Word-boundary match so "that" fires but "thatch" does not, and "it" does not fire on "its
  // limits" mid-word.
  return REFERRING_TERMS.some((term) =>
    new RegExp(`(^|[^a-z])${term.replace(/ /g, "\\s+")}([^a-z]|$)`, "i").test(q),
  );
}

/**
 * Single-parent convenience for internal callers without an explicit thread.
 * Web parentId requests use the bounded authorized ancestry resolver above.
 */
export function buildFollowUpQuestion(parentQuestion: string, followUp: string): string {
  const child = followUp.trim();
  const parent = parentQuestion.trim();
  if (!parent || !child) return child;
  if (!needsContext(child)) return child;
  return `Following on from earlier user questions.\n${researchQuestion([contextQuestion(parent)], child, false)}`;
}
