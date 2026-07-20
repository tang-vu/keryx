/**
 * Turning "how does that compare to Solana?" into a question the agent can decompose on its own.
 *
 * A follow-up carries the *parent question* as context and nothing else. It deliberately does not
 * carry the parent's answer: that answer is text Keryx paid sources to produce, and feeding it
 * back in would let a follow-up be answered from it for free — no buy, no citation, no payout.
 * Every dispatch, follow-up or not, is answered from sources bought for that dispatch.
 *
 * The rewrite is deterministic on purpose. An LLM round-trip here would add latency and a failure
 * mode ahead of the agent's own decompose step, which already handles a context-carrying question.
 */

/** Longest parent question carried into the rewrite; longer ones are trimmed on a word boundary. */
const MAX_CONTEXT_CHARS = 240;

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
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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
 * Build the standalone question for a follow-up. Returns the follow-up unchanged when it already
 * stands on its own, so a fully-specified question is never padded with irrelevant context.
 */
export function buildFollowUpQuestion(parentQuestion: string, followUp: string): string {
  const child = followUp.trim();
  const parent = parentQuestion.trim();
  if (!parent || !child) return child;
  if (!needsContext(child)) return child;
  return `Following on from the question "${trimToWord(parent, MAX_CONTEXT_CHARS)}": ${child}`;
}
