import { z } from "zod";
import type { ResearchMode } from "./types";

/** Public questions are copied into model prompts, traces, and durable dispatch rows. */
export const MAX_ASK_QUESTION_CHARS = 2_000;

export const AskQuestionSchema = z
  .string({ invalid_type_error: "question must be a string" })
  .trim()
  .min(1, "question is required")
  .max(
    MAX_ASK_QUESTION_CHARS,
    `question must be ${MAX_ASK_QUESTION_CHARS} characters or fewer`,
  );

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
