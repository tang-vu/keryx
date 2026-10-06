/**
 * A cited statement is one model-written sentence bound to exactly one verbatim quote.
 * The binding gives delivery an assertion-to-evidence mapping: a sentence can only be
 * shown beside the excerpt it was written from, and only after a separate review judged
 * that excerpt to establish the whole sentence. It is a model assessment, not proof.
 */

/** Stricter than excerpt relevance: the quote must establish everything the sentence asserts. */
export const MIN_STATEMENT_SUPPORT = 0.7;
const MIN_STATEMENT_LENGTH = 12;
const MAX_STATEMENT_LENGTH = 320;

export const STATEMENT_GENERATION_GUIDANCE =
  "In each evidence item also write `statement`: ONE plain sentence, in the language of the question, " +
  "that answers its research question as directly as that single quote allows, in your own concise words " +
  "rather than copying the quote, and asserting nothing the quote does not explicitly establish. " +
  "Keep the quote's numbers, negations, conditions, actors and scope; add no outside knowledge, " +
  "no inference across quotes and no citation markers. Omit `statement` when the quote alone cannot carry a full sentence. ";

export const STATEMENT_REVIEW_GUIDANCE =
  " When a row carries a `statement`, also return statementSupport (0..1) for that row: " +
  "0.7-1 only when the quote, read in its supplied context, explicitly establishes everything the statement asserts; " +
  "below 0.4 when the statement adds, generalizes, strengthens, drops a qualification from, or changes a number, " +
  "negation, actor, condition or scope of the quote. A translation that preserves meaning is acceptable. " +
  "Judge the statement against the quote, never against your prior knowledge.";

/** One bounded single-line sentence without citation controls, or nothing. */
export function normalizeStatement(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s*\[\s*S\d+\s*\]/g, "").replace(/\s+/g, " ").trim();
  if (text.length < MIN_STATEMENT_LENGTH || text.length > MAX_STATEMENT_LENGTH) return undefined;
  return /[.!?…。]$/.test(text) ? text : `${text}.`;
}
