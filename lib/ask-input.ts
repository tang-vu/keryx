import { z } from "zod";
import type { ResearchMode } from "./types";

/** Public questions are copied into model prompts, traces, and durable dispatch rows. */
export const MAX_ASK_QUESTION_CHARS = 2_000;

/** Keep public request text representable before any payment. Valid surrogate
 * pairs and all other Unicode stay byte-for-byte unchanged; do not repair input. */
export function isWellFormedAskText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export const AskQuestionSchema = z
  .string({ invalid_type_error: "question must be a string" })
  .trim()
  .min(1, "question is required")
  .max(
    MAX_ASK_QUESTION_CHARS,
    `question must be ${MAX_ASK_QUESTION_CHARS} characters or fewer`,
  )
  .refine(isWellFormedAskText, "question contains an invalid text character");

export function parseAskQuestion(value: unknown):
  | { success: true; question: string }
  | { success: false; error: string } {
  const parsed = AskQuestionSchema.safeParse(value);
  if (parsed.success) return { success: true, question: parsed.data };
  return {
    success: false,
    error: parsed.error.issues[0]?.message ?? "invalid question",
  };
}

const ResearchModeSchema = z.enum(["quick", "deep"]);

/** Missing mode preserves the established API/integration behavior. The web UI sends Quick. */
export function parseResearchMode(value: unknown): ResearchMode {
  const parsed = ResearchModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "deep";
}
