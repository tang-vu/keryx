import { createHash } from "node:crypto";
import { z } from "zod";

export const teachingProposalRequestSchema = z.object({
  version: z.literal(1),
  questionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.enum(["vi", "en"]),
  activityCount: z.literal(1),
  durationMinutes: z.number().int().min(1).max(30),
  exampleCount: z.number().int().min(1).max(4),
  exitQuestionCount: z.literal(1),
  explanationMaximumWords: z.number().int().min(1).max(200),
}).strict();
export type TeachingProposalRequest = z.infer<typeof teachingProposalRequestSchema>;
export const teachingQuestionSha256 = (question: string) => createHash("sha256").update(question).digest("hex");

/** Server-only original caller admission. Unsupported scopes stay inactive; a source,
 * model plan, prior turn or public JSON flag must never be passed as the caller here. */
export function parseTeachingProposalRequest(originalQuestion: string): TeachingProposalRequest | undefined {
  if (!originalQuestion.trim() || originalQuestion.length > 30_000) return;
  const question = originalQuestion.normalize("NFC").toLowerCase()
    .replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|"[^"\r\n]*"/gu, " ");
  // This initial natural-language contract deliberately covers the retained
  // Vietnamese task and explicit English equivalents, not arbitrary lessons.
  const languageMatches = [...question.matchAll(/(?<![\p{L}\p{N}_])(?:viết|trả lời|đáp)\s+(?:bằng\s+)?tiếng\s+([\p{L}\p{M}]+)|(?<![\p{L}\p{N}_])(?:write|answer|respond)\s+in\s+([\p{L}\p{M}]+)/gu)];
  if (languageMatches.length !== 1 || negative(question, languageMatches[0].index!)) return;
  const name = languageMatches[0][1] ?? languageMatches[0][2];
  const language = name === "việt" || name === "vietnamese" ? "vi" : name === "anh" || name === "english" ? "en" : undefined;
  if (!language) return;
  const activity = unique(question, /(?:một|1)\s+hoạt động\s+(\d+)\s+phút|(?:a|one|1)\s+(\d+)[- ]minute\s+(?:classroom\s+)?activity/gu);
  const examples = unique(question, /(một|hai|ba|bốn|\d+)\s+ví dụ[^.;\n]{0,70}phân loại|(one|two|three|four|\d+)\s+(?:invented\s+)?classification examples?/gu);
  const exit = unique(question, /(?:một|1)\s+câu hỏi cuối giờ\s+có đáp án|(?:an?|one|1)\s+exit (?:question|ticket)\s+with\s+(?:an?\s+)?answer/gu);
  const explanation = unique(question, /giải thích\s+(dưới|không quá|tối đa)\s+(\d+)\s+từ|explanation\s+(under|at most|up to)\s+(\d+)\s+words/gu);
  // Explicit proposal labeling is required. Historical NASA-tested activity
  // questions cannot activate this contract merely by mentioning the same nouns.
  if (!activity || !examples || !exit || !explanation ||
      ![...question.matchAll(/(?<![\p{L}\p{N}_])(?:đề xuất|proposed|propose|invented)(?![\p{L}\p{N}_])/gu)]
        .some(match => !negative(question, match.index!)) ||
      [...question.matchAll(/(?:nasa|source)\s+(?:đã\s+)?(?:thực nghiệm|tested|performed)\s+(?:the\s+)?(?:activity|hoạt động)/gu)]
        .some(match => !negative(question, match.index!))) return;
  const names: Record<string, number> = { một: 1, hai: 2, ba: 3, bốn: 4, one: 1, two: 2, three: 3, four: 4 };
  const exampleCount = names[examples[1] ?? examples[2]] ?? Number(examples[1] ?? examples[2]);
  const maximum = Number(explanation[2] ?? explanation[4]);
  const exclusive = (explanation[1] ?? explanation[3]) === "dưới" || (explanation[1] ?? explanation[3]) === "under";
  const result = teachingProposalRequestSchema.safeParse({ version: 1, questionSha256: teachingQuestionSha256(originalQuestion),
    language, activityCount: 1, durationMinutes: Number(activity[1] ?? activity[2]), exampleCount,
    exitQuestionCount: 1, explanationMaximumWords: maximum - Number(exclusive) });
  return result.success ? result.data : undefined;
}

function negative(text: string, index: number) {
  // A separate sentence or semicolon ends the prohibition. A line break alone
  // does not: "Do not\npropose" must still refuse the request.
  const clause = text.slice(Math.max(0, index - 55), index).split(/[.!?;]/u).at(-1) ?? "";
  return /(?<![\p{L}\p{M}\p{N}_])(?:không|đừng|do not|don't|cannot|can't|not)\s+(?:\S+\s+){0,3}$/u.test(clause);
}
function unique(text: string, pattern: RegExp) {
  // Match whole phrases, never a suffix such as "one" in "someone" or "2"
  // in "12", a signed number, decimal or fraction. Numeric bounds belong to
  // the schema so an out-of-range whole count cannot become a smaller one.
  const complete = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}_])(?:${pattern.source})(?![\p{L}\p{M}\p{N}_])`, pattern.flags);
  const matches = [...text.matchAll(complete)];
  if (matches.length !== 1) return;
  const match = matches[0];
  if (/^\d/u.test(match[0]) && /[.,/+\-\u2212]/u.test(text[match.index! - 1] ?? "")) return;
  return !negative(text, match.index!) ? match : undefined;
}

export function validTeachingProposalRequest(request: TeachingProposalRequest, originalQuestion: string): boolean {
  const parsed = teachingProposalRequestSchema.safeParse(request);
  return parsed.success && parsed.data.questionSha256 === teachingQuestionSha256(originalQuestion) &&
    JSON.stringify(parseTeachingProposalRequest(originalQuestion)) === JSON.stringify(parsed.data);
}

/** Whitespace-delimited words in admitted explanatory prose only; original
 * quotes, citation controls and separately labeled proposals are not prose. */
export function teachingExplanationWordCount(statements: readonly { text: string }[]): number {
  return statements.reduce((sum, statement) => sum + (statement.text.trim().match(/\S+/gu)?.length ?? 0), 0);
}
